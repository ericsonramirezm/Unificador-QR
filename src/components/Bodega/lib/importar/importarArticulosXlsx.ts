import * as XLSX from 'xlsx'
import type { TipoArticulo } from '../../tipos'
// Sin extensión `.ts`, a diferencia del original de Bodega: el tsconfig de
// Unificador-QR no tiene `allowImportingTsExtensions` habilitado (esa flag
// existía en Bodega solo para que `verificar-lector.mjs` pudiera ejecutar
// este módulo directamente desde Node, sin Vite — ese script no se portó).
import { normalizarCodigo } from '../codigos'
// Solo el tipo: importarlo como valor arrastraría el cliente de Supabase y
// dejaría este módulo imposible de ejercitar desde Node.
import type { DatosArticulo } from '../servicios/catalogos'

/**
 * Lectura de una planilla de artículos para la carga inicial del catálogo.
 *
 * Lee la hoja como matriz, ubica las columnas por su encabezado normalizado y
 * cae a un error explícito si no aparecen. No es una integración con
 * Defontana — es pegar una planilla que el usuario ya tiene.
 */

export interface FilaImportada {
  fila: number
  datos: DatosArticulo
}

export interface ResultadoLectura {
  /** Códigos que no existen en el catálogo ni se repiten en la planilla. */
  nuevos: FilaImportada[]
  /** Ya existen en el catálogo: no se tocan (nada de sobrescribir en silencio). */
  yaExisten: FilaImportada[]
  /** Aparecen más de una vez dentro del propio archivo. Se conserva la primera. */
  repetidosEnArchivo: FilaImportada[]
  /** Filas sin código o sin descripción. */
  descartadas: number
  hoja: string
  columnasDetectadas: Record<string, number>
}

function txt(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).replace(/\s+/g, ' ').trim()
}

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  // Formato chileno: "1.234,5" → 1234.5
  const limpio = txt(v).replace(/\./g, '').replace(',', '.')
  const n = Number.parseFloat(limpio)
  return Number.isFinite(n) ? n : 0
}

/** Sin acentos y en mayúsculas. Para comparar valores de celda (tipo, serie). */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .trim()
}

/**
 * Normalización específica de encabezados: además de acentos y mayúsculas,
 * **descarta toda la puntuación y los espacios**.
 *
 * Sin esto, `Cod. Defontana` no coincide con `COD DEFONTANA` por culpa del punto,
 * la columna del código no se encuentra, y el lector cae al respaldo por posición
 * importando basura. Las planillas reales escriben `Cod.`, `Und.`, `U. Medida`
 * — la puntuación es la norma, no la excepción.
 */
function normEnc(s: string): string {
  return norm(s).replace(/[^A-Z0-9]/g, '')
}

const SI = new Set(['SI', 'S', 'X', 'TRUE', 'VERDADERO', '1', 'SERIE'])

/**
 * Interpreta la columna de tipo. Se compara por prefijo porque las planillas
 * escriben cosas como «EPP - Protección» o «Activo fijo», no el valor del enum.
 * Lo que no se reconoce cae en MATERIAL, que es la inmensa mayoría del catálogo.
 */
function interpretarTipo(crudo: string): TipoArticulo {
  const v = norm(crudo)
  if (v.startsWith('EPP') || v.startsWith('PROTECCION')) return 'EPP'
  if (v.startsWith('ACTIVO') || v.startsWith('MOBILIARIO') || v.startsWith('OFICINA')) return 'ACTIVO'
  return 'MATERIAL'
}

/** Sinónimos aceptados para cada columna, ya normalizados. */
const ENCABEZADOS: Record<string, string[]> = {
  codigo: ['CODIGO DEFONTANA', 'CODIGO', 'COD', 'COD DEFONTANA', 'DEFONTANA', 'SKU'],
  descripcion: ['DESCRIPCION', 'DENOMINACION', 'DETALLE', 'NOMBRE', 'ARTICULO', 'MATERIAL'],
  tipo: ['TIPO', 'CLASE', 'CATEGORIA'],
  unidad: ['UNIDAD', 'UND', 'UND.', 'UM', 'U MEDIDA', 'UNIDAD DE MEDIDA'],
  marca: ['MARCA'],
  familia: ['FAMILIA', 'GRUPO', 'RUBRO'],
  controlaSerie: ['SERIE', 'CONTROLA SERIE', 'N SERIE', 'NUMERO DE SERIE'],
  stockMinimo: ['STOCK MINIMO', 'MINIMO', 'MIN', 'STOCK MIN'],
}

/** Sinónimos ya normalizados, una sola vez. */
const ENCABEZADOS_NORM: Record<string, string[]> = Object.fromEntries(
  Object.entries(ENCABEZADOS).map(([clave, lista]) => [clave, lista.map(normEnc)]),
)

function ubicarColumnas(filas: unknown[][]) {
  const limite = Math.min(filas.length, 15)
  for (let r = 0; r < limite; r++) {
    const fila = filas[r] ?? []
    const encontradas: Record<string, number> = {}
    for (let c = 0; c < fila.length; c++) {
      const v = normEnc(txt(fila[c]))
      if (!v) continue
      for (const [clave, sinonimos] of Object.entries(ENCABEZADOS_NORM)) {
        if (encontradas[clave] === undefined && sinonimos.includes(v)) encontradas[clave] = c
      }
    }
    // Se acepta la fila como encabezado solo si trae lo indispensable: sin código
    // y descripción no hay nada que importar.
    if (encontradas.codigo !== undefined && encontradas.descripcion !== undefined) {
      return { col: encontradas, filaEncabezado: r }
    }
  }

  // Antes esto caía a "columna A = código, columna B = descripción". Era peor que
  // fallar: leía la fila de título como si fuera un artículo y ofrecía importar
  // basura con aspecto de dato bueno. Es mejor decir exactamente qué falta.
  return null
}

export async function leerArticulosXlsx(archivo: File | Blob, codigosExistentes: Set<string>): Promise<ResultadoLectura> {
  const buf = await archivo.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const hoja = wb.SheetNames[0]
  const ws = wb.Sheets[hoja]
  const filas = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null })

  const ubicacion = ubicarColumnas(filas)
  if (!ubicacion) {
    throw new Error(
      `No se reconocieron las columnas en la hoja «${hoja}». La planilla necesita una fila de ` +
        'encabezados con al menos una columna de código (Código, Cod. Defontana, SKU…) y otra de ' +
        'descripción (Descripción, Denominación, Detalle…).',
    )
  }
  const { col, filaEncabezado } = ubicacion

  const nuevos: FilaImportada[] = []
  const yaExisten: FilaImportada[] = []
  const repetidosEnArchivo: FilaImportada[] = []
  const vistosEnArchivo = new Set<string>()
  let descartadas = 0

  for (let r = filaEncabezado + 1; r < filas.length; r++) {
    const fila = filas[r]
    if (!fila) continue

    const codigoCrudo = txt(fila[col.codigo])
    const descripcion = txt(fila[col.descripcion])

    if (!codigoCrudo || !descripcion) {
      if (fila.some((c) => txt(c))) descartadas++
      continue
    }

    // La MISMA normalización que aplica el trigger de Postgres. Si divergen, la
    // vista previa mentiría sobre qué está duplicado.
    const codigo = normalizarCodigo(codigoCrudo)

    const tipo = interpretarTipo(txt(fila[col.tipo]))

    const datos: DatosArticulo = {
      codigo_defontana: codigo,
      descripcion,
      tipo,
      unidad: txt(fila[col.unidad]).toUpperCase() || 'UN',
      marca: txt(fila[col.marca]) || null,
      familia: txt(fila[col.familia]) || null,
      controla_serie: SI.has(norm(txt(fila[col.controlaSerie]))),
      stock_minimo: num(fila[col.stockMinimo]),
      activo: true,
    }

    const entrada: FilaImportada = { fila: r + 1, datos }

    if (vistosEnArchivo.has(codigo)) repetidosEnArchivo.push(entrada)
    else if (codigosExistentes.has(codigo)) {
      yaExisten.push(entrada)
      vistosEnArchivo.add(codigo)
    } else {
      nuevos.push(entrada)
      vistosEnArchivo.add(codigo)
    }
  }

  return { nuevos, yaExisten, repetidosEnArchivo, descartadas, hoja, columnasDetectadas: col }
}
