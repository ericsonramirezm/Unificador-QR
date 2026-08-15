import { useCallback, useState } from 'react'
import jsPDF from 'jspdf'

// Lee el tag EXIF "Orientation" (1-8) de un JPEG. Las fotos de celular casi
// siempre lo traen: la cámara guarda los píxeles "acostados" y este tag le
// dice a cualquier visor cuánto rotarlos al mostrarlos. El navegador lo
// respeta solo, pero jsPDF NO — por eso hay que corregirlo nosotros antes de
// insertar la imagen en el PDF, o sale de lado. Sin EXIF (u otro formato),
// devuelve 1 (sin rotación).
function leerOrientacionEXIF(buffer: ArrayBuffer): number {
  const view = new DataView(buffer)
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return 1

  let offset = 2
  const length = view.byteLength

  while (offset + 4 <= length) {
    const marker = view.getUint16(offset, false)
    offset += 2

    if (marker === 0xffe1) {
      // Segmento APP1 (EXIF)
      if (view.getUint32(offset + 2, false) !== 0x45786966) return 1 // "Exif"
      const tiffOffset = offset + 8
      const little = view.getUint16(tiffOffset, false) === 0x4949
      const firstIFDOffset = view.getUint32(tiffOffset + 4, little)
      const dirStart = tiffOffset + firstIFDOffset
      const numEntries = view.getUint16(dirStart, little)

      for (let i = 0; i < numEntries; i++) {
        const entryOffset = dirStart + 2 + i * 12
        const tag = view.getUint16(entryOffset, little)
        if (tag === 0x0112) {
          return view.getUint16(entryOffset + 8, little)
        }
      }
      return 1
    }

    if ((marker & 0xff00) !== 0xff00) break
    offset += view.getUint16(offset, false)
  }

  return 1
}

// Redibuja la imagen en un canvas aplicando la rotación/espejo que indique el
// tag EXIF, "quemándola" en los píxeles — el JPEG resultante ya no depende de
// que nadie lea esa etiqueta para verse bien.
function normalizarOrientacion(img: HTMLImageElement, orientacion: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const w = img.naturalWidth
  const h = img.naturalHeight
  const rotado90 = orientacion >= 5 && orientacion <= 8
  canvas.width = rotado90 ? h : w
  canvas.height = rotado90 ? w : h

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo preparar el lienzo para corregir la orientación')

  switch (orientacion) {
    case 2:
      ctx.transform(-1, 0, 0, 1, w, 0)
      break
    case 3:
      ctx.transform(-1, 0, 0, -1, w, h)
      break
    case 4:
      ctx.transform(1, 0, 0, -1, 0, h)
      break
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0)
      break
    case 6:
      ctx.transform(0, 1, -1, 0, h, 0)
      break
    case 7:
      ctx.transform(0, -1, -1, 0, h, w)
      break
    case 8:
      ctx.transform(0, -1, 1, 0, 0, w)
      break
    default:
      break // 1: sin cambios
  }

  ctx.drawImage(img, 0, 0)
  return canvas
}

export const usePDFGenerator = () => {
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generatePDFFromImage = useCallback(
    async (imageBlob: Blob, nombreUsuario?: string, cargoUsuario?: string): Promise<Blob> => {
      setIsGenerating(true)
      setError(null)

      try {
        const buffer = await imageBlob.arrayBuffer()
        const orientacion = leerOrientacionEXIF(buffer)

        // Convertir imagen a data URL
        const imageDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(new Error('No se pudo leer la imagen capturada'))
          reader.readAsDataURL(new Blob([buffer], { type: imageBlob.type }))
        })

        // Cargar imagen para conocer sus dimensiones reales
        const img = new Image()
        const imgLoaded = new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('La imagen capturada está dañada o no se pudo decodificar'))
        })
        img.src = imageDataUrl
        await imgLoaded

        // Si la foto trae rotación EXIF (casi siempre, en fotos de celular en
        // vertical), se corrige quemándola en los píxeles antes de insertarla
        // — jsPDF ignora el tag EXIF y la insertaría "acostada".
        let imagenFinalUrl = imageDataUrl
        let anchoImg = img.width
        let altoImg = img.height

        if (orientacion !== 1) {
          const canvasCorregido = normalizarOrientacion(img, orientacion)
          imagenFinalUrl = canvasCorregido.toDataURL('image/jpeg', 0.92)
          anchoImg = canvasCorregido.width
          altoImg = canvasCorregido.height
        }

        // PDF en tamaño Letter (8.5 x 11 pulgadas)
        const pdfDoc = new jsPDF({
          orientation: 'portrait',
          unit: 'in',
          format: 'letter',
        })

        const pageWidth = pdfDoc.internal.pageSize.getWidth()
        const pageHeight = pdfDoc.internal.pageSize.getHeight()

        const marginLeft = 0.5
        const marginRight = 0.5
        const marginBottom = 0.5

        // Encabezado: nombre de quien carga, con su cargo debajo
        let marginTop = 0.5
        if (nombreUsuario) {
          pdfDoc.setFontSize(13)
          pdfDoc.setFont('helvetica', 'bold')
          pdfDoc.text(nombreUsuario, marginLeft, 0.5)
          marginTop = 0.7

          if (cargoUsuario) {
            pdfDoc.setFontSize(10)
            pdfDoc.setFont('helvetica', 'normal')
            pdfDoc.setTextColor(100, 100, 100)
            pdfDoc.text(cargoUsuario, marginLeft, 0.72)
            pdfDoc.setTextColor(0, 0, 0)
            marginTop = 0.9
          }
        }

        const availableWidth = pageWidth - marginLeft - marginRight
        const availableHeight = pageHeight - marginTop - marginBottom

        // Escalar imagen manteniendo proporción, centrada horizontalmente
        const imgAspectRatio = anchoImg / altoImg
        let imgWidth = availableWidth
        let imgHeight = imgWidth / imgAspectRatio

        if (imgHeight > availableHeight) {
          imgHeight = availableHeight
          imgWidth = imgHeight * imgAspectRatio
        }

        const imgLeft = (pageWidth - imgWidth) / 2
        pdfDoc.addImage(imagenFinalUrl, 'JPEG', imgLeft, marginTop, imgWidth, imgHeight)

        return pdfDoc.output('blob')
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Error desconocido al generar el PDF'
        setError(errorMsg)
        throw err instanceof Error ? err : new Error(errorMsg)
      } finally {
        setIsGenerating(false)
      }
    },
    []
  )

  return {
    generatePDFFromImage,
    isGenerating,
    error,
  }
}

// Utilidad: nombre de archivo PDF. La secuencia debe venir de
// db.obtenerSiguienteSecuenciaPDF() para ser única entre usuarios/días — ver supabase.ts
export const generatePDFFilename = (fecha: Date, secuencia: number): string => {
  const fechaStr = fecha.toLocaleDateString('es-CL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return `${fechaStr}_${String(secuencia).padStart(3, '0')}.pdf`
}
