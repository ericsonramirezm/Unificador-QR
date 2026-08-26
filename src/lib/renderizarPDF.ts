import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Renderiza la primera página de un PDF a imagen, para usarla como miniatura
 * cuando el Coordinador adjunta un documento PDF ya existente (no una foto).
 */
export async function generarMiniaturaPDF(file: File): Promise<{ previewDataUrl: string; miniaturaBlob: Blob }> {
  const bytes = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
  const pagina = await pdf.getPage(1)
  const viewport = pagina.getViewport({ scale: 1.5 })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo preparar el lienzo para la miniatura')

  await pagina.render({ canvasContext: ctx, viewport }).promise

  const previewDataUrl = canvas.toDataURL('image/jpeg', 0.85)
  const miniaturaBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo generar la miniatura'))),
      'image/jpeg',
      0.85
    )
  })

  return { previewDataUrl, miniaturaBlob }
}

/**
 * Renderiza todas las páginas de un PDF a imágenes, para el modal de
 * "Ver Previa" del documento de respaldo en Nueva Solicitud de Compra (ver
 * NuevaSolicitudCompraModal.tsx) — a diferencia de generarMiniaturaPDF()
 * (arriba), que solo renderiza la página 1 para una miniatura chica.
 * maxPaginas es un límite de seguridad para PDFs muy largos: es una vista
 * previa rápida, no un lector de documentos completo.
 */
export async function renderizarPaginasPDF(file: File, maxPaginas = 20): Promise<string[]> {
  const bytes = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
  const totalPaginas = Math.min(pdf.numPages, maxPaginas)

  const paginas: string[] = []
  for (let i = 1; i <= totalPaginas; i++) {
    const pagina = await pdf.getPage(i)
    const viewport = pagina.getViewport({ scale: 1.3 })

    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    if (!ctx) continue

    await pagina.render({ canvasContext: ctx, viewport }).promise
    paginas.push(canvas.toDataURL('image/jpeg', 0.85))
  }

  return paginas
}
