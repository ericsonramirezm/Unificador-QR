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
