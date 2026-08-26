// Lectura rápida de un Excel (.xlsx) en el navegador, para el modal de
// "Ver Previa" del documento de respaldo de una Solicitud de Compra — ver
// NuevaSolicitudCompraModal.tsx. Reutiliza ExcelJS (ya es dependencia del
// proyecto, la usa generarExcelParteDiario.ts) en vez de sumar una librería
// nueva (sheetjs/xlsx) solo para esto.
//
// Límite importante: ExcelJS solo sabe leer el formato moderno .xlsx (Open
// XML). El formato binario antiguo .xls (BIFF, antes de Excel 2007) no lo
// soporta ninguna librería puramente JS liviana — leerExcelParaPreview()
// lanza un error controlado en ese caso, que el modal muestra como aviso
// ("no se pudo generar la vista previa") en vez de una previsualización.
// El archivo .xls igual queda adjunto a la solicitud, solo no se puede
// previsualizar.
import ExcelJS from 'exceljs'

export interface HojaPreview {
  nombre: string
  filas: string[][]
}

// Vista previa rápida: no hace falta cargar hojas enormes completas, así
// que se corta en un límite generoso de filas/columnas.
const MAX_FILAS = 200
const MAX_COLUMNAS = 40

function celdaATexto(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return ''
  if (valor instanceof Date) return valor.toLocaleDateString('es-CL')
  if (typeof valor === 'object') {
    if ('richText' in (valor as any)) {
      return (valor as any).richText.map((r: any) => r.text ?? '').join('')
    }
    if ('result' in (valor as any)) {
      // Celda con fórmula: se muestra el resultado ya calculado.
      return celdaATexto((valor as any).result)
    }
    if ('text' in (valor as any)) {
      return String((valor as any).text ?? '')
    }
    if ('error' in (valor as any)) {
      return String((valor as any).error ?? '#ERROR')
    }
    return ''
  }
  return String(valor)
}

export async function leerExcelParaPreview(file: File): Promise<HojaPreview[]> {
  const nombreMin = file.name.toLowerCase()
  if (!nombreMin.endsWith('.xlsx')) {
    throw new Error(
      'Este archivo es .xls (formato antiguo de Excel) — la vista previa solo funciona con .xlsx. El archivo igual queda adjunto a la solicitud.'
    )
  }

  const buffer = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const hojas: HojaPreview[] = []
  workbook.eachSheet((worksheet) => {
    const filas: string[][] = []
    const columnas = Math.min(worksheet.columnCount || MAX_COLUMNAS, MAX_COLUMNAS)
    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (rowNumber > MAX_FILAS) return
      const filaTexto: string[] = []
      for (let c = 1; c <= columnas; c++) {
        filaTexto.push(celdaATexto(row.getCell(c).value))
      }
      filas.push(filaTexto)
    })
    hojas.push({ nombre: worksheet.name, filas })
  })

  if (hojas.length === 0) {
    throw new Error('El archivo no tiene hojas para mostrar.')
  }

  return hojas
}
