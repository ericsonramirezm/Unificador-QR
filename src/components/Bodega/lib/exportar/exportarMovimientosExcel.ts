import { ETIQUETA_MOVIMIENTO, SIGNO_MOVIMIENTO, type FilaMovimiento } from '../../tipos'

/**
 * Exporta a Excel exactamente las filas que están en pantalla.
 *
 * **ExcelJS se carga con `import()` dentro de la función**, no arriba del
 * módulo: pesa cientos de kB y solo se usa al exportar. Importarlo de forma
 * estática castigaría el arranque de todos los días —el de quien abre la app en
 * el celular en faena— por una función ocasional. El bundler lo deja en su
 * propio trozo.
 */
export async function exportarMovimientosExcel(filas: FilaMovimiento[], descripcionFiltro: string) {
  const ExcelJS = (await import('exceljs')).default

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Bodega WILUG'
  wb.created = new Date()
  const ws = wb.addWorksheet('Movimientos')

  // Ojo con el patrón: NO se declara `header` en las columnas. Hacerlo crea una
  // sola fila de encabezado, y meter un título encima obliga a pelear con la
  // relocación de estilos de `insertRow`. Es más simple declarar solo key/width
  // y escribir título y encabezado a mano, en orden.
  ws.columns = [
    { key: 'folio', width: 9 },
    { key: 'fecha', width: 12 },
    { key: 'tipo', width: 17 },
    { key: 'detalle', width: 34 },
    { key: 'guia', width: 12 },
    { key: 'origen', width: 24 },
    { key: 'lineas', width: 9 },
    { key: 'unidades', width: 11 },
    { key: 'diferencia', width: 12 },
    { key: 'usuario', width: 20 },
    { key: 'observacion', width: 40 },
  ]

  const titulo = ws.addRow([`Movimientos de bodega — ${descripcionFiltro}`])
  titulo.font = { bold: true, size: 13 }
  ws.mergeCells(1, 1, 1, ws.columns.length)

  const encabezado = ws.addRow([
    'N°',
    'Fecha',
    'Tipo',
    'Destino / origen',
    'Guía',
    'Procedencia',
    'Líneas',
    'Unidades',
    'Diferencia',
    'Registró',
    'Observación',
  ])
  encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  encabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }

  for (const [i, m] of filas.entries()) {
    const fila = ws.addRow({
      folio: m.folio,
      fecha: m.fecha,
      tipo: `${SIGNO_MOVIMIENTO[m.tipo]} ${ETIQUETA_MOVIMIENTO[m.tipo]}`,
      detalle: detalleDe(m),
      guia: m.documento_folio ?? '',
      origen: m.proveedor ?? m.origen_nombre ?? '',
      lineas: Number(m.n_lineas),
      unidades: Number(m.total_unidades),
      diferencia: m.tiene_diferencia ? 'Sí' : '',
      usuario: m.registrado_por ?? '',
      observacion: m.observacion ?? m.motivo ?? '',
    })
    if (i % 2 === 1) {
      fila.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
    }
    if (m.tiene_diferencia) {
      fila.getCell('diferencia').font = { bold: true, color: { argb: 'FFB45309' } }
    }
  }

  // Congela el título y el encabezado para que no se pierdan al desplazarse.
  ws.views = [{ state: 'frozen', ySplit: 2 }]

  const blob = new Blob([await wb.xlsx.writeBuffer()], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  descargar(blob, `movimientos-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

/** A qué se asoció el movimiento, según su tipo. */
export function detalleDe(m: FilaMovimiento): string {
  switch (m.tipo) {
    case 'ENTRADA':
      return m.proveedor ?? m.origen_nombre ?? 'Recepción'
    case 'SALIDA_SALA':
      return m.sala ? `${m.sala}${m.retirado_por_nombre ? ` — retira ${m.retirado_por_nombre}` : ''}` : ''
    case 'ENTREGA_EPP':
      return m.trabajador ?? ''
    case 'DEVOLUCION':
      return m.sala ?? m.trabajador ?? ''
    case 'TRASLADO':
      return `${m.bodega} → ${m.bodega_destino ?? ''}`
    case 'AJUSTE':
      return m.motivo ?? ''
  }
}

function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  // Sin esto el Blob queda retenido en memoria mientras viva la pestaña.
  URL.revokeObjectURL(url)
}
