import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { ParteDiario } from '@/types/index'

// Genera el Daily Report en Excel EXACTAMENTE con el formato original: se
// abre la plantilla en blanco (public/plantillas/DR000_12501191.xlsx, la
// misma que se cargó al analizar el formato) y se escriben los valores
// celda por celda, sin tocar el resto del archivo (logos, celdas
// combinadas, bordes, fórmulas). Mismo principio que el prototipo en
// Python/openpyxl ya validado — ver MAPEO_CAMPOS.md para el detalle
// celda por celda de cada sección.
//
// ExcelJS NO sabe leer/escribir gráficos: al hacer xlsx.load() + writeBuffer()
// descarta silenciosamente el gráfico "Programado vs. Real" que trae la
// plantilla (xl/charts/chart1.xml, anclado en xl/drawings/drawing1.xml de la
// hoja "DR"), aunque no lo hayamos tocado. Por eso, después de que ExcelJS
// genera el archivo, lo reabrimos como zip (JSZip) y le devolvemos esas
// piezas tal cual estaban en la plantilla original — ver
// restaurarGraficoOriginal() más abajo. El gráfico referencia celdas por
// rango (DR!$L$63, $I$64:$I$65, etc.), así que toma los valores nuevos que
// ya escribimos solo con que esas celdas conserven su misma posición, que es
// el caso.

const PLANTILLA_URL = '/plantillas/DR000_12501191.xlsx'

// Piezas del paquete .xlsx (formato ZIP/OOXML) que ExcelJS pierde al
// reserializar y que hay que restaurar desde la plantilla original.
const PARTES_GRAFICO = [
  'xl/charts/chart1.xml',
  'xl/drawings/drawing1.xml',
  'xl/drawings/_rels/drawing1.xml.rels',
]

async function restaurarGraficoOriginal(bufferGenerado: ArrayBuffer, bufferPlantilla: ArrayBuffer): Promise<Blob> {
  const [zipGenerado, zipPlantilla] = await Promise.all([JSZip.loadAsync(bufferGenerado), JSZip.loadAsync(bufferPlantilla)])

  for (const parte of PARTES_GRAFICO) {
    const original = zipPlantilla.file(parte)
    if (original) zipGenerado.file(parte, await original.async('uint8array'))
  }

  // El Content_Types.xml que arma ExcelJS ya no declara chart1.xml (lo quitó
  // junto con el resto) — sin esa declaración Excel no reconoce la pieza como
  // un gráfico y la ignora o pide "reparar". Se la agregamos de vuelta si
  // falta.
  const contentTypesPath = '[Content_Types].xml'
  const contentTypes = await zipGenerado.file(contentTypesPath)?.async('string')
  if (contentTypes && !contentTypes.includes('charts/chart1.xml')) {
    const override = '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>'
    zipGenerado.file(contentTypesPath, contentTypes.replace('</Types>', `${override}</Types>`))
  }

  const bufferFinal = await zipGenerado.generateAsync({ type: 'blob' })
  return bufferFinal
}

// Filas fijas en la hoja "DR", en el mismo orden que CARGOS_DIRECTOS /
// CARGOS_INDIRECTOS / EQUIPOS_MAQUINARIA (src/types/index.ts) — si esas
// listas cambian de orden, hay que actualizar esto también.
const FILA_INICIO_ACTIVIDADES = 14
const FILA_INICIO_DIRECTA = 24
const FILA_INICIO_MAQUINARIA = 45
const FILA_INICIO_INDIRECTA = 64
const COLUMNAS_HORAS = ['H', 'I', 'J', 'K', 'L', 'M', 'N'] // Act.1..Act.7

// Las celdas de hora en el Excel usan el "epoch" de Excel (30-dic-1899);
// solo importa la hora/minuto, no la fecha.
function horaATiempoExcel(hora: string | null | undefined): Date | null {
  if (!hora) return null
  const [h, m] = hora.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return new Date(Date.UTC(1899, 11, 30, h, m))
}

export async function generarExcelParteDiario(parte: ParteDiario): Promise<Blob> {
  const respuesta = await fetch(PLANTILLA_URL)
  if (!respuesta.ok) throw new Error('No se pudo cargar la plantilla del Excel')
  const buffer = await respuesta.arrayBuffer()

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const hojaDR = workbook.getWorksheet('DR')
  const hojaImagenes = workbook.getWorksheet('Imágenes')
  if (!hojaDR || !hojaImagenes) {
    throw new Error('La plantilla no tiene las hojas esperadas ("DR" e "Imágenes")')
  }

  // ---------- Encabezado ----------
  hojaDR.getCell('C5').value = String(parte.numero_reporte).padStart(3, '0')
  hojaDR.getCell('J5').value = new Date(`${parte.fecha}T00:00:00`)
  if (parte.condicion_climatica) hojaDR.getCell('K10').value = parte.condicion_climatica

  // ---------- Actividades ejecutadas (máx. 7, mismo límite que el formulario) ----------
  parte.actividades.slice(0, 7).forEach((actividad, i) => {
    const fila = FILA_INICIO_ACTIVIDADES + i
    hojaDR.getCell(`C${fila}`).value = actividad.area
    hojaDR.getCell(`E${fila}`).value = actividad.descripcion
    if (actividad.cantidad != null) hojaDR.getCell(`N${fila}`).value = actividad.cantidad
  })

  // ---------- Fuerza laboral directa ----------
  parte.mano_obra_directa.forEach((linea, i) => {
    const fila = FILA_INICIO_DIRECTA + i
    hojaDR.getCell(`D${fila}`).value = linea.contratados
    hojaDR.getCell(`E${fila}`).value = linea.operativos
    ;(linea.horas_por_actividad ?? []).forEach((horas, actIndex) => {
      const col = COLUMNAS_HORAS[actIndex]
      if (col) hojaDR.getCell(`${col}${fila}`).value = horas
    })
  })

  // ---------- Maquinaria ----------
  parte.maquinaria.forEach((linea, i) => {
    const fila = FILA_INICIO_MAQUINARIA + i
    hojaDR.getCell(`C${fila}`).value = linea.cantidad
    hojaDR.getCell(`D${fila}`).value = linea.mantencion
    hojaDR.getCell(`E${fila}`).value = linea.standby
    ;(linea.horas_por_actividad ?? []).forEach((horas, actIndex) => {
      const col = COLUMNAS_HORAS[actIndex]
      if (col) hojaDR.getCell(`${col}${fila}`).value = horas
    })
  })

  // ---------- Fuerza laboral indirecta ----------
  parte.mano_obra_indirecta.forEach((linea, i) => {
    const fila = FILA_INICIO_INDIRECTA + i
    hojaDR.getCell(`D${fila}`).value = linea.contratados
    hojaDR.getCell(`E${fila}`).value = linea.operativos
  })

  // ---------- Jornada ----------
  if (parte.jornada) {
    const { inicio, fin, horas_efectivas, horas_perdidas } = parte.jornada
    if (inicio) hojaDR.getCell('D40').value = horaATiempoExcel(inicio)
    if (fin) hojaDR.getCell('E40').value = horaATiempoExcel(fin)
    if (horas_efectivas?.entrada) hojaDR.getCell('G40').value = horaATiempoExcel(horas_efectivas.entrada)
    if (horas_efectivas?.salida) hojaDR.getCell('G41').value = horaATiempoExcel(horas_efectivas.salida)
    if (horas_perdidas?.entrada) hojaDR.getCell('I40').value = horaATiempoExcel(horas_perdidas.entrada)
    if (horas_perdidas?.salida) hojaDR.getCell('I41').value = horaATiempoExcel(horas_perdidas.salida)
  }

  // ---------- Resumen HH Programado vs. Real ----------
  hojaDR.getCell('L64').value = parte.hh_directas_programado
  hojaDR.getCell('L65').value = parte.hh_indirectas_programado

  // ---------- Acumulados de turno ----------
  // Ya vienen calculados (acumulado anterior + turno actual) desde el
  // formulario — se escriben como número, no como fórmula (ver decisión
  // en MAPEO_CAMPOS.md: acumulados automáticos).
  if (parte.hh_directas_acumuladas != null) hojaDR.getCell('D80').value = parte.hh_directas_acumuladas
  if (parte.hm_acumuladas != null) hojaDR.getCell('I80').value = parte.hm_acumuladas
  if (parte.hh_indirectas_acumuladas != null) hojaDR.getCell('N80').value = parte.hh_indirectas_acumuladas

  // ---------- Comentarios ----------
  if (parte.comentario_contratista_autor) hojaDR.getCell('B83').value = parte.comentario_contratista_autor
  if (parte.comentario_contratista) hojaDR.getCell('D83').value = parte.comentario_contratista
  if (parte.comentario_mandante_autor) hojaDR.getCell('B88').value = parte.comentario_mandante_autor
  if (parte.comentario_mandante) hojaDR.getCell('D88').value = parte.comentario_mandante

  // ---------- Fotos (hoja "Imágenes") ----------
  // Grilla simple, una foto por bloque de filas — no reproduce un layout
  // manual, solo deja las fotos del día insertadas y legibles con su pie
  // de foto. Se puede refinar el layout más adelante.
  let filaFoto = 8
  for (const foto of parte.fotos) {
    try {
      const respFoto = await fetch(foto.url)
      if (!respFoto.ok) continue
      const bufferFoto = await respFoto.arrayBuffer()
      const urlSinQuery = foto.url.split('?')[0].toLowerCase()
      const extension = urlSinQuery.endsWith('.png') ? 'png' : 'jpeg'
      const imageId = workbook.addImage({ buffer: bufferFoto as any, extension })

      hojaImagenes.addImage(imageId, {
        tl: { col: 1, row: filaFoto - 1 },
        ext: { width: 320, height: 220 },
      })

      if (foto.caption) {
        hojaImagenes.getCell(`B${filaFoto + 11}`).value = foto.caption
      }
    } catch (err) {
      console.error('No se pudo insertar una foto en el Excel:', err)
    } finally {
      filaFoto += 13
    }
  }

  const bufferGenerado = await workbook.xlsx.writeBuffer()
  return restaurarGraficoOriginal(bufferGenerado, buffer)
}

export function nombreArchivoParteDiario(parte: ParteDiario): string {
  const fecha = parte.fecha.replace(/-/g, '.')
  return `DR${String(parte.numero_reporte).padStart(3, '0')}_12501191_${fecha}_LT.xlsx`
}

export function descargarBlob(blob: Blob, nombreArchivo: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nombreArchivo
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
