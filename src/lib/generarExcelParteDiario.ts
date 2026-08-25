import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { FAENA_LABELS, HH_TURNO_POR_FAENA, ParteDiario, UserRole } from '@/types/index'

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

// Cuántas anclas de imagen (xdr:oneCellAnchor / xdr:twoCellAnchor) trae la
// hoja "Imágenes" de la PLANTILLA en blanco, antes de que nuestro código
// agregue ninguna foto: los 2 logos del encabezado. ExcelJS conserva esas
// anclas tal cual y solo AGREGA anclas nuevas al final por cada
// hojaImagenes.addImage() que hacemos — por eso, en el XML ya generado,
// las primeras N_ANCLAS_PLANTILLA anclas son siempre esos logos y el resto
// son las fotos del reporte, sin importar si terminamos usando
// oneCellAnchor o twoCellAnchor para insertarlas.
const N_ANCLAS_PLANTILLA_IMAGENES = 2

// Redondea las esquinas de las fotos insertadas (no las del logo): ExcelJS
// no tiene forma de pedir esto por API, así que se edita el XML del dibujo
// directamente después de generarlo (mismo mecanismo que restaurarGraficoOriginal
// usa para el gráfico). El radio es un % (sobre 50000 = 50%) del lado más
// corto del recuadro. Se probó primero en 32000 (32%) pero en fotos
// grandes como estas se veía como una esquina cortada en diagonal, muy
// exagerado — 3000 (3%) da un redondeo sutil, apenas perceptible pero
// presente.
const RADIO_ESQUINA_FOTO = 3000 // 3% del lado más corto

// Fotos de distinto tamaño/proporción en la misma fila de la grilla (ej.
// una foto horizontal 4:3 junto a una vertical) se veían con distinta
// ALTURA en Excel real, aunque el recuadro (xdr:from/xdr:to) de las tres
// fuera idéntico — se verificó con fotos de prueba de proporciones muy
// distintas que el XML generado tenía las mismas coordenadas de recuadro
// para las tres, así que no era un bug de calcularCeldaFoto().
//
// La causa: ExcelJS agrega SIEMPRE <a:picLocks noChangeAspect="1"/> en
// cada foto (no hay forma de pedirle lo contrario por API). Ese atributo
// le dice a Excel "no permitas una escala no-uniforme de esta imagen", y
// Excel real (a diferencia de LibreOffice, que ignoraba esto y siempre
// hacía caso al <a:stretch><a:fillRect/></a:stretch> del blipFill) lo
// respeta incluso en el recuadro inicial: en vez de estirar la foto para
// llenar el recuadro fijo de la grilla, la muestra con SU proporción
// original — de ahí que cada foto saliera de una altura distinta según su
// propia relación ancho/alto, no según el recuadro. Por eso acá se lo
// sacamos (solo a las fotos, no a las firmas, donde sí queremos mantener
// la proporción original — ver CajaFirma más abajo).
//
// numFotos acota ambos ajustes a las anclas que de verdad son fotos: las
// primeras N_ANCLAS_PLANTILLA_IMAGENES son los logos (no se tocan) y todo
// lo que venga después de "logos + fotos" son las firmas digitales que se
// agregan más abajo (tampoco se tocan — deben quedar con esquinas rectas
// y proporción fija).
function corregirAnclasFotos(xmlDrawing: string, numFotos: number): string {
  let contador = 0
  return xmlDrawing.replace(/<xdr:(oneCellAnchor|twoCellAnchor)\b[\s\S]*?<\/xdr:\1>/g, (bloque) => {
    contador += 1
    const esFoto = contador > N_ANCLAS_PLANTILLA_IMAGENES && contador <= N_ANCLAS_PLANTILLA_IMAGENES + numFotos
    if (!esFoto) return bloque
    return bloque
      .replace(
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
        `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${RADIO_ESQUINA_FOTO}"/></a:avLst></a:prstGeom>`
      )
      .replace('<a:picLocks noChangeAspect="1"/>', '<a:picLocks noChangeAspect="0"/>')
  })
}

// ---------- Firmas digitales (hojas "DR" e "Imágenes") ----------
// El bloque de firma de la plantilla (fila "Firma", justo debajo de
// "Nombre:") es igual en las dos hojas — la hoja "Imágenes" lo repite 4
// filas más arriba que la hoja "DR".
//
// "Coordinador de Terreno" es dinámico: se usa el nombre y la firma_url
// de quien creó el reporte (parte.usuario_creador), SOLO si ese usuario
// tiene rol coordinador — así cada coordinador firma con su propio
// nombre e imagen al generar el Excel, en vez del nombre fijo que traía
// la plantilla (antes siempre decía "Ericson Ramirez", venía escrito en
// el archivo de la plantilla, no lo ponía el código). Si el reporte lo
// creó un apr, o el coordinador todavía no tiene firma_url cargada en la
// tabla usuarios (ver add_firma_usuarios.sql), esa celda queda en blanco
// y no se inserta imagen — mejor eso que atribuirle mal una firma.
//
// "Administrador Contrato" (Sara Cofré) sigue fija por ahora — no se
// pidió que varíe por usuario. "Responsable Mandante" queda en blanco
// porque lo firma el mandante por su cuenta, no acá.
//
// La hoja "DR" restaura su drawing completo desde la plantilla (ver
// PARTES_GRAFICO, por el gráfico) — insertar ahí una imagen con la API de
// ExcelJS (workbook.addImage) se perdería en esa restauración. Por eso las
// firmas se inyectan directamente en el XML del drawing de cada hoja, con
// el mismo mecanismo que ya se usa para el gráfico y las esquinas
// redondeadas, en vez de con addImage.
const FIRMA_SARA_URL = '/firmas/sara-cofre.png'
const FIRMA_SARA_MEDIA = 'firma-sara-cofre.png'
const FIRMA_COORDINADOR_MEDIA = 'firma-coordinador.png'

// Celda con el nombre del Coordinador de Terreno en la hoja "DR" — la
// hoja "Imágenes" no necesita que la toquemos: su celda equivalente
// (C90) ya es la fórmula "=+DR!C95" en la plantilla, así que sigue a
// esta automáticamente al recalcular. (Antes era C94: se corrió una fila
// hacia abajo cuando se agregó la fila "Total ... Acumuladas Actual" —
// ver plantilla DR000_12501191.xlsx.)
const CELDA_NOMBRE_COORDINADOR = 'C95'

// Fila (índice 0 de OOXML, o sea fila de Excel menos 1) de la etiqueta
// "Firma" en cada hoja.
const FILA_FIRMA_DR = 95 // fila 96 en Excel (antes fila 95, corrida +1 igual que CELDA_NOMBRE_COORDINADOR)
const FILA_FIRMA_IMAGENES = 90 // fila 91 en Excel (la hoja "Imágenes" no tiene la fila nueva, no se corre)

// Recuadro de cada firma dentro de UNA sola columna (para no invadir la
// celda de al lado ni la de "Firma"/"Nombre" de al lado), en EMU (914400
// EMU = 1 pulgada). Calculado a mano a partir del ancho real de columna
// C/G y el alto de la fila "Firma" en la plantilla (33.6pt ≈ 426720 EMU),
// para centrar la firma verticalmente y mantener su proporción original
// (a diferencia de las fotos, acá no conviene estirarla) — como
// noChangeAspect se deja en "1" para las firmas, Excel escala la imagen
// para que quepa dentro de este recuadro sin deformarla, no la estira a
// la fuerza para llenarlo.
//
// Recuadro agrandado ~30% (pedido explícito: "se ven pequeñas... la idea
// es que se vean más grandes" — ver conversación del 2026-08-24) respecto
// al tamaño original, mantiene el mismo margen izquierdo/superior y sigue
// centrado dentro de la columna C/G y la fila "Firma", sin invadir columnas
// ni filas vecinas: la columna C de la hoja DR (la más angosta de las dos
// hojas donde se inserta esta caja) mide ~857.000 EMU de ancho y acá se
// usan 534.000; la fila "Firma" mide 426.720 EMU de alto y acá se usan
// 390.000 — en ambos casos queda margen de sobra.
interface CajaFirma {
  col: number
  colOffIni: number
  colOffFin: number
  rowOffIni: number
  rowOffFin: number
}
// Columna C (bajo "Firma" del Coordinador de Terreno).
const CAJA_FIRMA_COORDINADOR: CajaFirma = { col: 2, colOffIni: 30000, colOffFin: 534000, rowOffIni: 18360, rowOffFin: 408360 }
// Columna G (bajo "Firma" del Administrador Contrato / Sara Cofré).
const CAJA_FIRMA_SARA: CajaFirma = { col: 6, colOffIni: 30000, colOffFin: 555000, rowOffIni: 18360, rowOffFin: 408360 }

interface FirmaAInsertar {
  caja: CajaFirma
  nombre: string // solo para el name= del shape, no se muestra en pantalla
  mediaFileName: string
  buffer: ArrayBuffer
}

function xmlAnclaFirma(caja: CajaFirma, fila: number, picId: number, nombre: string, rId: string): string {
  return (
    '<xdr:twoCellAnchor editAs="oneCell">' +
    `<xdr:from><xdr:col>${caja.col}</xdr:col><xdr:colOff>${caja.colOffIni}</xdr:colOff><xdr:row>${fila}</xdr:row><xdr:rowOff>${caja.rowOffIni}</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>${caja.col}</xdr:col><xdr:colOff>${caja.colOffFin}</xdr:colOff><xdr:row>${fila}</xdr:row><xdr:rowOff>${caja.rowOffFin}</xdr:rowOff></xdr:to>` +
    '<xdr:pic><xdr:nvPicPr>' +
    `<xdr:cNvPr id="${picId}" name="${nombre}"/>` +
    '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
    `<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
    '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>' +
    '</xdr:pic><xdr:clientData/></xdr:twoCellAnchor>'
  )
}

// Siguiente rId / cNvPr id libre en un drawing/rels ya existente, para no
// chocar con los que ExcelJS (fotos) o la plantilla (logos, gráfico) ya
// hayan usado — el conteo real varía según cuántas fotos tenga el reporte,
// así que no se puede asumir un número fijo.
function siguienteId(xml: string, patron: RegExp): number {
  let max = 0
  for (const m of xml.matchAll(patron)) {
    const n = Number(m[1])
    if (n > max) max = n
  }
  return max + 1
}

// firmas puede traer 1 o 2 elementos: Sara siempre, más el Coordinador
// solo si el reporte tiene un creador coordinador con firma_url cargada
// (ver generarExcelParteDiario). Si viene vacío no se toca el drawing.
function agregarFirmasAlDrawing(xmlDrawing: string, xmlRels: string, fila: number, firmas: FirmaAInsertar[]): { drawing: string; rels: string; media: { nombre: string; buffer: ArrayBuffer }[] } {
  if (firmas.length === 0) return { drawing: xmlDrawing, rels: xmlRels, media: [] }

  let rIdSiguiente = siguienteId(xmlRels, /Id="rId(\d+)"/g)
  let idSiguiente = siguienteId(xmlDrawing, /<xdr:cNvPr id="(\d+)"/g)

  let anclas = ''
  let nuevasRelaciones = ''
  const media: { nombre: string; buffer: ArrayBuffer }[] = []
  for (const firma of firmas) {
    const rId = `rId${rIdSiguiente++}`
    anclas += xmlAnclaFirma(firma.caja, fila, idSiguiente++, firma.nombre, rId)
    nuevasRelaciones += `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${firma.mediaFileName}"/>`
    media.push({ nombre: firma.mediaFileName, buffer: firma.buffer })
  }

  const drawing = xmlDrawing.replace('</xdr:wsDr>', `${anclas}</xdr:wsDr>`)
  const rels = xmlRels.replace('</Relationships>', `${nuevasRelaciones}</Relationships>`)
  return { drawing, rels, media }
}

async function posprocesarExcel(
  bufferGenerado: ArrayBuffer,
  bufferPlantilla: ArrayBuffer,
  numFotosInsertadas: number,
  firmaSaraBuffer: ArrayBuffer,
  firmaCoordinadorBuffer: ArrayBuffer | null
): Promise<Blob> {
  const [zipGenerado, zipPlantilla] = await Promise.all([JSZip.loadAsync(bufferGenerado), JSZip.loadAsync(bufferPlantilla)])

  // ---- 1. Restaurar el gráfico "Programado vs. Real" (hoja DR) ----
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

  // ---- 2. Esquinas redondeadas + tamaño de recuadro fijo en las fotos (hoja Imágenes) ----
  const drawing2Path = 'xl/drawings/drawing2.xml'
  const drawing2 = await zipGenerado.file(drawing2Path)?.async('string')
  if (drawing2) zipGenerado.file(drawing2Path, corregirAnclasFotos(drawing2, numFotosInsertadas))

  // ---- 3. Firmas digitales (hojas DR e Imágenes) ----
  const firmasParaCaja = (cajaCoordinador: CajaFirma, cajaSara: CajaFirma): FirmaAInsertar[] => {
    const firmas: FirmaAInsertar[] = [
      { caja: cajaSara, nombre: 'Firma Administrador Contrato', mediaFileName: FIRMA_SARA_MEDIA, buffer: firmaSaraBuffer },
    ]
    if (firmaCoordinadorBuffer) {
      firmas.push({
        caja: cajaCoordinador,
        nombre: 'Firma Coordinador de Terreno',
        mediaFileName: FIRMA_COORDINADOR_MEDIA,
        buffer: firmaCoordinadorBuffer,
      })
    }
    return firmas
  }

  const drawing1Path = 'xl/drawings/drawing1.xml'
  const drawing1RelsPath = 'xl/drawings/_rels/drawing1.xml.rels'
  const drawing1 = await zipGenerado.file(drawing1Path)?.async('string')
  const drawing1Rels = await zipGenerado.file(drawing1RelsPath)?.async('string')
  if (drawing1 && drawing1Rels) {
    const { drawing, rels, media } = agregarFirmasAlDrawing(drawing1, drawing1Rels, FILA_FIRMA_DR, firmasParaCaja(CAJA_FIRMA_COORDINADOR, CAJA_FIRMA_SARA))
    zipGenerado.file(drawing1Path, drawing)
    zipGenerado.file(drawing1RelsPath, rels)
    for (const m of media) zipGenerado.file(`xl/media/${m.nombre}`, new Uint8Array(m.buffer))
  }

  const drawing2RelsPath = 'xl/drawings/_rels/drawing2.xml.rels'
  const drawing2ConEsquinas = await zipGenerado.file(drawing2Path)?.async('string')
  const drawing2Rels = await zipGenerado.file(drawing2RelsPath)?.async('string')
  if (drawing2ConEsquinas && drawing2Rels) {
    const { drawing, rels, media } = agregarFirmasAlDrawing(drawing2ConEsquinas, drawing2Rels, FILA_FIRMA_IMAGENES, firmasParaCaja(CAJA_FIRMA_COORDINADOR, CAJA_FIRMA_SARA))
    zipGenerado.file(drawing2Path, drawing)
    zipGenerado.file(drawing2RelsPath, rels)
    for (const m of media) zipGenerado.file(`xl/media/${m.nombre}`, new Uint8Array(m.buffer))
  }

  // ---- 4. Forzar recálculo al abrir ----
  // ExcelJS escribe valores nuevos en celdas (ej. las horas por actividad
  // de Fuerza Laboral Directa/Indirecta) pero no actualiza xl/calcChain.xml
  // ni recalcula los <v> ya cacheados de las fórmulas que dependen de esas
  // celdas (ej. "Total ... Turno" en la fila 79, o "Total ... Acumuladas
  // Actual" en la fila 81) — sin este flag, un lector que confíe en el
  // valor cacheado en vez de recalcular mostraría esas filas en 0 hasta
  // que alguien fuerce un recálculo manual. fullCalcOnLoad="1" le pide a
  // cualquier lector (Excel, LibreOffice, Google Sheets) que recalcule
  // todo antes de mostrar el archivo.
  const workbookPath = 'xl/workbook.xml'
  const workbookXml = await zipGenerado.file(workbookPath)?.async('string')
  if (workbookXml && !workbookXml.includes('fullCalcOnLoad')) {
    zipGenerado.file(workbookPath, workbookXml.replace('<calcPr ', '<calcPr fullCalcOnLoad="1" '))
  }

  return zipGenerado.generateAsync({ type: 'blob' })
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

// ---------- Grilla de fotos (hoja "Imágenes") ----------
// Grilla de 3 columnas dentro del rango B8:N88 (fila 7 queda como
// encabezado de la sección, fila 89 es donde arranca "COORDINADOR DE
// TERRENO"). Cada foto usa un twoCellAnchor con offsets en EMU exactos
// (mismo principio que las cajas de firma, CajaFirma más arriba) — NO
// coordenadas fraccionarias tipo "col: 1.15", como se usaba antes.
//
// Se cambió a EMU exactos porque las coordenadas fraccionarias resultaron
// poco confiables para este reclamo puntual: la clase Anchor de ExcelJS
// (node_modules/exceljs/lib/doc/anchor.js) convierte la parte fraccionaria
// de "col"/"row" a colOff/rowOff multiplicándola por el ancho de columna
// o alto de fila EXPRESADO EN "unidad*10000" (ej. 13.67 caracteres ->
// 136700), no en EMU real — así que un margen pensado como "0.15 de una
// celda" terminaba escribiéndose como un offset EMU minúsculo (0.15 *
// 136700 ≈ 20.000 EMU ≈ 1,6pt), casi invisible: por eso las fotos
// quedaban pegadas al borde izquierdo/superior en vez de tener un margen
// simétrico. Además la fila "Firma" original (FILA_FIRMA_IMAGENES) se
// usaba como límite inferior de la grilla, mezclando el reclamo aparte de
// agrandar la firma con el cálculo de cuánto espacio hay para fotos.
//
// Con offsets EMU explícitos (calculados a mano acá con el ancho/alto
// REAL de columnas y filas de la plantilla, vía hoja.getColumn/getRow) el
// resultado es exacto y predecible, igual que con las firmas.
const GRILLA_COL_INICIO_EXCEL = 2 // columna B (1-index, como usa ExcelJS getColumn)
const GRILLA_COL_FIN_EXCEL = 14 // columna N, INCLUSIVE (antes se usaba un límite de 13 en índice 0 que en la práctica dejaba la columna N entera sin usar — el hueco a la derecha del reclamo)
const GRILLA_FILA_INICIO_EXCEL = 8 // primera fila de la grilla (fila 7 = encabezado "IMÁGENES", no se toca)
const GRILLA_FILA_FIN_EXCEL = 88 // última fila de la grilla, justo antes de la fila 89 ("COORDINADOR DE TERRENO") — antes se usaba FILA_FIRMA_IMAGENES (fila 91, la fila "Firma"), que se metía 2 filas de más en la zona de Nombre/encabezado de esa sección
const GRILLA_COLUMNAS = 3
const GRILLA_MARGEN_EMU = 45000 // ~3.5pt — mismo valor para el margen entre tarjetas Y el margen contra el borde del recuadro (mitad de este valor a cada lado de cada tarjeta), para que quede simétrico en las 4 direcciones
const GRILLA_ALTURA_LEYENDA_EMU = 260000 // ~20pt reservados bajo cada foto para el pie de foto
const EMU_POR_PUNTO = 12700
const EMU_POR_PIXEL = 9525 // estándar OOXML para imágenes a 96 DPI (mismo valor que usa anchoColumnaEMU al convertir px→EMU)
const ANCHO_CARACTER_PX = 7 // "Maximum Digit Width" de Calibri 11 — la misma constante que usa Excel para convertir ancho de columna (caracteres) a píxeles

// Lee el ancho/alto REAL (en píxeles) de la foto desde sus propios bytes,
// para poder insertarla respetando su proporción original en vez de
// estirarla para llenar la celda (ver calcularCeldaFoto). Se parsean los
// headers a mano (sin depender de <img>/Image(), que no existe en el
// entorno de pruebas de Node) porque tanto PNG como JPEG traen sus
// dimensiones en un lugar fijo/predecible del archivo.
function dimensionesPng(bytes: Uint8Array): { width: number; height: number } | null {
  // Firma de 8 bytes + chunk IHDR: 4 bytes de largo + "IHDR" (4 bytes) +
  // ancho (4 bytes, big-endian) + alto (4 bytes, big-endian).
  if (bytes.length < 24) return null
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null
  const width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0
  const height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0
  return { width, height }
}

function dimensionesJpeg(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marcador = bytes[offset + 1]
    // Marcadores SOFn (inicio de frame, traen las dimensiones) — se
    // excluyen 0xC4 (DHT), 0xC8 (JPG, reservado) y 0xCC (DAC), que caen en
    // el mismo rango 0xC0–0xCF pero no son SOFn.
    if (marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6]
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8]
      return { width, height }
    }
    const largoSegmento = (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (largoSegmento < 2) return null // segmento inválido, evita loop infinito
    offset += 2 + largoSegmento
  }
  return null
}

function dimensionesImagen(buffer: ArrayBuffer, extension: 'png' | 'jpeg'): { width: number; height: number } {
  const bytes = new Uint8Array(buffer)
  const dim = extension === 'png' ? dimensionesPng(bytes) : dimensionesJpeg(bytes)
  // Si no se pudo leer (archivo corrupto o formato inesperado — no debería
  // pasar en uso normal, GestorFotos solo acepta image/*), se usa un 4:3
  // genérico como respaldo para no romper la generación del Excel.
  return dim && dim.width > 0 && dim.height > 0 ? dim : { width: 1200, height: 900 }
}

function anchoColumnaEMU(hoja: ExcelJS.Worksheet, colExcel: number): number {
  const caracteres = hoja.getColumn(colExcel).width ?? hoja.properties.defaultColWidth ?? 8.43
  const px = Math.round(((256 * caracteres + Math.trunc(128 / ANCHO_CARACTER_PX)) / 256) * ANCHO_CARACTER_PX)
  return px * 9525
}

function altoFilaEMU(hoja: ExcelJS.Worksheet, filaExcel: number): number {
  const puntos = hoja.getRow(filaExcel).height ?? hoja.properties.defaultRowHeight ?? 15
  return Math.round(puntos * EMU_POR_PUNTO)
}

function sumaAnchoColumnasEMU(hoja: ExcelJS.Worksheet, colIniExcel: number, colFinExcel: number): number {
  let total = 0
  for (let c = colIniExcel; c <= colFinExcel; c++) total += anchoColumnaEMU(hoja, c)
  return total
}

function sumaAltoFilasEMU(hoja: ExcelJS.Worksheet, filaIniExcel: number, filaFinExcel: number): number {
  let total = 0
  for (let f = filaIniExcel; f <= filaFinExcel; f++) total += altoFilaEMU(hoja, f)
  return total
}

// Recorre columnas/filas reales desde el inicio de la grilla acumulando
// una distancia en EMU, y devuelve en qué columna/fila (índice 0, como
// espera el anchor de ExcelJS) y a qué offset EMU dentro de ella cae ese
// punto — el mismo cálculo que hace Excel al insertar una imagen a mano
// arrastrándola dentro de un rango de celdas.
function avanzarColumnasEMU(hoja: ExcelJS.Worksheet, colIniExcel: number, distanciaEMU: number) {
  let col = colIniExcel
  let restante = distanciaEMU
  for (;;) {
    const ancho = anchoColumnaEMU(hoja, col)
    if (restante < ancho || col > 16384) return { nativeCol: col - 1, nativeColOff: Math.max(0, Math.round(restante)) }
    restante -= ancho
    col += 1
  }
}

function avanzarFilasEMU(hoja: ExcelJS.Worksheet, filaIniExcel: number, distanciaEMU: number) {
  let fila = filaIniExcel
  let restante = distanciaEMU
  for (;;) {
    const alto = altoFilaEMU(hoja, fila)
    if (restante < alto || fila > 1048576) return { nativeRow: fila - 1, nativeRowOff: Math.max(0, Math.round(restante)) }
    restante -= alto
    fila += 1
  }
}

// Altura de banda a usar para un reporte con numFotos fotos: si con la
// altura de referencia (el recuadro completo dividido en 3 filas, el
// diseño pensado para 9 fotos) las filas necesarias caben dentro del
// espacio disponible, se agranda la banda —hasta el doble de esa
// referencia como tope— para ocupar ese espacio en vez de dejarlo vacío.
// Si no caben (muchas fotos), se usa la altura de referencia sin cambios
// y la grilla sigue agregando filas hacia abajo como siempre.
function altoBandaFotoEMU(hoja: ExcelJS.Worksheet, numFotos: number): number {
  const totalEMU = sumaAltoFilasEMU(hoja, GRILLA_FILA_INICIO_EXCEL, GRILLA_FILA_FIN_EXCEL)
  const referenciaEMU = totalEMU / 3
  if (numFotos <= 0) return referenciaEMU
  const numFilas = Math.ceil(numFotos / GRILLA_COLUMNAS)
  const estiradaEMU = Math.min(referenciaEMU * 2, totalEMU / numFilas)
  return Math.max(referenciaEMU, estiradaEMU)
}

// anchoNaturalEMU/altoNaturalEMU: tamaño real de la foto (en EMU, ver
// dimensionesImagen). La foto se escala manteniendo su proporción original
// — nunca se deforma — y solo se achica lo justo para que quepa dentro del
// espacio disponible de su celda; si ya cabe tal cual, se deja a su tamaño
// natural (no se agranda). El resultado queda centrado horizontal y
// verticalmente dentro del margen de la celda.
function calcularCeldaFoto(
  hoja: ExcelJS.Worksheet,
  index: number,
  alturaBandaEMU: number,
  anchoNaturalEMU: number,
  altoNaturalEMU: number
) {
  const col = index % GRILLA_COLUMNAS
  const fila = Math.floor(index / GRILLA_COLUMNAS)

  const anchoTotalEMU = sumaAnchoColumnasEMU(hoja, GRILLA_COL_INICIO_EXCEL, GRILLA_COL_FIN_EXCEL)
  const anchoBandaEMU = anchoTotalEMU / GRILLA_COLUMNAS

  // Espacio disponible para la foto dentro de su celda (sin contar el
  // margen entre tarjetas ni la banda reservada para el pie de foto).
  const cajaXIni = col * anchoBandaEMU + GRILLA_MARGEN_EMU / 2
  const cajaXFin = (col + 1) * anchoBandaEMU - GRILLA_MARGEN_EMU / 2
  const cajaYIni = fila * alturaBandaEMU + GRILLA_MARGEN_EMU / 2
  const cajaYFin = (fila + 1) * alturaBandaEMU - GRILLA_MARGEN_EMU / 2 - GRILLA_ALTURA_LEYENDA_EMU
  const distYFinLeyenda = (fila + 1) * alturaBandaEMU - GRILLA_MARGEN_EMU / 2

  const anchoDisponibleEMU = cajaXFin - cajaXIni
  const altoDisponibleEMU = cajaYFin - cajaYIni

  const escala = Math.min(1, anchoDisponibleEMU / anchoNaturalEMU, altoDisponibleEMU / altoNaturalEMU)
  const anchoFotoEMU = anchoNaturalEMU * escala
  const altoFotoEMU = altoNaturalEMU * escala

  const distXIni = cajaXIni + (anchoDisponibleEMU - anchoFotoEMU) / 2
  const distXFin = distXIni + anchoFotoEMU
  const distYIniFoto = cajaYIni + (altoDisponibleEMU - altoFotoEMU) / 2
  const distYFinFoto = distYIniFoto + altoFotoEMU

  const tlCol = avanzarColumnasEMU(hoja, GRILLA_COL_INICIO_EXCEL, distXIni)
  const brCol = avanzarColumnasEMU(hoja, GRILLA_COL_INICIO_EXCEL, distXFin)
  const tlRow = avanzarFilasEMU(hoja, GRILLA_FILA_INICIO_EXCEL, distYIniFoto)
  const brRow = avanzarFilasEMU(hoja, GRILLA_FILA_INICIO_EXCEL, distYFinFoto)
  // Fila donde va el pie de foto: justo después del margen inferior de la
  // tarjeta, antes de que empiece la banda siguiente — si no, la foto de
  // abajo tapa visualmente el texto del pie de foto.
  const leyendaRow = avanzarFilasEMU(hoja, GRILLA_FILA_INICIO_EXCEL, distYFinLeyenda)

  return {
    tl: { nativeCol: tlCol.nativeCol, nativeColOff: tlCol.nativeColOff, nativeRow: tlRow.nativeRow, nativeRowOff: tlRow.nativeRowOff },
    br: { nativeCol: brCol.nativeCol, nativeColOff: brCol.nativeColOff, nativeRow: brRow.nativeRow, nativeRowOff: brRow.nativeRowOff },
    filaLeyenda: leyendaRow.nativeRow,
    colLeyenda: tlCol.nativeCol,
  }
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
  // Fila 11 ("Faena :") agregada a la plantilla para la división Las
  // Tórtolas / Los Bronces — ver add_faena_partes_diarios.sql.
  hojaDR.getCell('C11').value = FAENA_LABELS[parte.faena]
  // "HH por Día" (J9): ya no es un valor fijo de la plantilla — de acá
  // dependen tanto las fórmulas de HH Total de Fuerza laboral indirecta
  // ($J$9*E<fila>, ver G64/G65 de la plantilla) como el cálculo de HH
  // Indirectas acumuladas más abajo (hhPorDia). Antes de esta división
  // por faena, J9 quedaba en el 10 fijo de la plantilla.
  hojaDR.getCell('J9').value = HH_TURNO_POR_FAENA[parte.faena]

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

  // ---------- Acumulados de turno: Anterior (fila 80) + Actual (fila 81) ----------
  // parte.hh_directas_acumuladas/hm_acumuladas/hh_indirectas_acumuladas ya
  // vienen desde el formulario como el TOTAL combinado (acumulado anterior
  // + turno de hoy — ver ParteDiarioForm.tsx). La plantilla, en cambio,
  // ahora separa esto en dos filas: "Anterior" (fila 80, un número fijo
  // que escribimos acá) y "Actual" (fila 81, fórmula de la propia
  // plantilla = Total Turno [fila 79, que se autocalcula de las celdas
  // que ya llenamos arriba] + Anterior). Por eso acá solo escribimos
  // "Anterior" = total combinado menos el turno de hoy — "hoy" se
  // recalcula sumando las mismas celdas que la fila 79 de la plantilla
  // suma (columnas Act.1..Act.7 de mano de obra directa/maquinaria, y
  // Operativos × HH por Día de mano de obra indirecta), para que quede
  // consistente con lo que Excel muestra en esa fila sin depender de una
  // fórmula que nosotros mismos tengamos que reproducir en dos lugares.
  const hhPorDia = Number(hojaDR.getCell('J9').value) || 0
  const sumarHoras = (horas: (number | null | undefined)[] | undefined) => (horas ?? []).reduce((acc: number, h) => acc + (h ?? 0), 0)

  const hoyDirectas = parte.mano_obra_directa.reduce((acc, linea) => acc + sumarHoras(linea.horas_por_actividad), 0)
  const hoyHm = parte.maquinaria.reduce((acc, linea) => acc + sumarHoras(linea.horas_por_actividad), 0)
  const hoyIndirectas = parte.mano_obra_indirecta.reduce((acc, linea) => acc + hhPorDia * (linea.operativos ?? 0), 0)

  if (parte.hh_directas_acumuladas != null) hojaDR.getCell('D80').value = parte.hh_directas_acumuladas - hoyDirectas
  if (parte.hm_acumuladas != null) hojaDR.getCell('I80').value = parte.hm_acumuladas - hoyHm
  if (parte.hh_indirectas_acumuladas != null) hojaDR.getCell('N80').value = parte.hh_indirectas_acumuladas - hoyIndirectas

  // ---------- Comentarios ----------
  if (parte.comentario_contratista_autor) hojaDR.getCell('B84').value = parte.comentario_contratista_autor
  if (parte.comentario_contratista) hojaDR.getCell('D84').value = parte.comentario_contratista
  if (parte.comentario_mandante_autor) hojaDR.getCell('B89').value = parte.comentario_mandante_autor
  if (parte.comentario_mandante) hojaDR.getCell('D89').value = parte.comentario_mandante

  // ---------- Coordinador de Terreno (nombre) ----------
  // La plantilla trae "Ericson Ramirez" fijo en esta celda; se sobrescribe
  // acá con quien de verdad creó el reporte, SI es coordinador — si lo
  // creó un apr, se deja en blanco (nadie ha firmado como coordinador
  // todavía). La firma (imagen) se resuelve más abajo junto con la de
  // Sara Cofré, y se inserta en posprocesarExcel().
  const creador = parte.usuario_creador
  const creadorEsCoordinador = creador?.rol === UserRole.COORDINADOR
  hojaDR.getCell(CELDA_NOMBRE_COORDINADOR).value = creadorEsCoordinador ? creador!.nombre : ''

  // ---------- Fotos (hoja "Imágenes") ----------
  // Grilla de 3 columnas repartida simétricamente en B7:N90 — ver
  // calcularCeldaFoto() más arriba. Las esquinas redondeadas se agregan
  // después, en posprocesarExcel(), porque ExcelJS no expone esa opción
  // en su API de addImage.
  //
  // Se descargan TODAS las fotos primero (sin insertarlas todavía) para
  // saber cuántas se lograron descargar de verdad antes de calcular la
  // altura de la banda — si se calculara con fotosValidas.length y alguna
  // foto fallara al descargarse, la grilla quedaría con una fila de menos
  // fotos de lo esperado y un hueco vacío abajo (el mismo problema que se
  // está corrigiendo, pero por otra causa).
  const fotosValidas = parte.fotos.slice(0, GRILLA_COLUMNAS * 20) // límite defensivo, no debería alcanzarse en uso normal
  const fotosDescargadas: { buffer: ArrayBuffer; extension: 'png' | 'jpeg'; caption?: string }[] = []
  for (const foto of fotosValidas) {
    try {
      const respFoto = await fetch(foto.url)
      if (!respFoto.ok) continue
      const bufferFoto = await respFoto.arrayBuffer()
      const urlSinQuery = foto.url.split('?')[0].toLowerCase()
      const extension = urlSinQuery.endsWith('.png') ? 'png' : 'jpeg'
      fotosDescargadas.push({ buffer: bufferFoto, extension, caption: foto.caption })
    } catch (err) {
      console.error('No se pudo descargar una foto para el Excel:', err)
    }
  }

  const alturaBandaGrilla = altoBandaFotoEMU(hojaImagenes, fotosDescargadas.length)

  // No siempre coincide con fotosValidas.length: si alguna foto falla al
  // descargarse (catch más arriba) se salta y no se inserta ningún ancla
  // para ella — hay que contar solo las que de verdad se insertaron, para
  // que el redondeo de esquinas en posprocesarExcel() no se desalinee.
  let fotosInsertadas = 0
  for (const foto of fotosDescargadas) {
    const imageId = workbook.addImage({ buffer: foto.buffer as any, extension: foto.extension })

    const dimensiones = dimensionesImagen(foto.buffer, foto.extension)
    const anchoNaturalEMU = dimensiones.width * EMU_POR_PIXEL
    const altoNaturalEMU = dimensiones.height * EMU_POR_PIXEL
    const celda = calcularCeldaFoto(hojaImagenes, fotosInsertadas, alturaBandaGrilla, anchoNaturalEMU, altoNaturalEMU)
    // Los tipos de ExcelJS piden una instancia completa de su clase Anchor
    // (con nativeCol/nativeRow/etc.), pero en tiempo de ejecución acepta
    // objetos planos {nativeCol, nativeColOff, nativeRow, nativeRowOff} sin
    // problema — es un typing de ExcelJS más estricto que su propio
    // comportamiento real. Se usa nativeCol/nativeColOff/nativeRow/nativeRowOff
    // (EMU exactos, calculados a mano más arriba) en vez de {col, row}
    // fraccionarios — ver la nota junto a GRILLA_COL_INICIO_EXCEL sobre por
    // qué {col, row} fraccionario no daba un resultado confiable acá.
    // editAs: 'twoCell' es a propósito — ExcelJS por defecto usa 'oneCell'
    // ("mover pero no cambiar tamaño con las celdas"), que es lo pensado
    // para una imagen normal pegada en una celda, NO para esta grilla de
    // fotos con recuadro fijo. Ver nota junto a corregirAnclasFotos() más
    // abajo sobre por qué esto importaba (fotos de tamaños distintos en
    // Excel real).
    hojaImagenes.addImage(imageId, { tl: celda.tl, br: celda.br, editAs: 'twoCell' } as any)

    if (foto.caption) {
      hojaImagenes.getRow(celda.filaLeyenda + 1).getCell(celda.colLeyenda + 1).value = foto.caption
    }
    fotosInsertadas += 1
  }

  // ---------- Firmas digitales (Administrador Contrato / Coordinador de
  // Terreno) — se insertan en posprocesarExcel(), ver comentario ahí. La
  // de Sara Cofré (Administrador Contrato) es fija y siempre se agrega; la
  // del Coordinador de Terreno depende de si el creador del reporte es
  // coordinador y ya tiene firma_url cargada (ver arriba).
  const respFirmaSara = await fetch(FIRMA_SARA_URL)
  if (!respFirmaSara.ok) throw new Error('No se pudo cargar la imagen de firma de Administrador Contrato')
  const firmaSaraBuffer = await respFirmaSara.arrayBuffer()

  let firmaCoordinadorBuffer: ArrayBuffer | null = null
  if (creadorEsCoordinador && creador?.firma_url) {
    const respFirmaCoordinador = await fetch(creador.firma_url)
    if (respFirmaCoordinador.ok) {
      firmaCoordinadorBuffer = await respFirmaCoordinador.arrayBuffer()
    } else {
      console.error('No se pudo cargar la imagen de firma del coordinador:', creador.firma_url)
    }
  }

  const bufferGenerado = await workbook.xlsx.writeBuffer()
  return posprocesarExcel(bufferGenerado, buffer, fotosInsertadas, firmaSaraBuffer, firmaCoordinadorBuffer)
}

export function nombreArchivoParteDiario(parte: ParteDiario): string {
  const fecha = parte.fecha.replace(/-/g, '.')
  return `DR${String(parte.numero_reporte).padStart(3, '0')}_12501191_${fecha}_${parte.faena}.xlsx`
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
