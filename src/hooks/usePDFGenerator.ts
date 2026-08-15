import { useCallback, useState } from 'react'
import jsPDF from 'jspdf'

export const usePDFGenerator = () => {
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generatePDFFromImage = useCallback(
    async (imageBlob: Blob, nombreUsuario?: string, cargoUsuario?: string): Promise<Blob> => {
      setIsGenerating(true)
      setError(null)

      try {
        // Convertir imagen a data URL
        const reader = new FileReader()
        const imageDataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(new Error('No se pudo leer la imagen capturada'))
          reader.readAsDataURL(imageBlob)
        })

        // Cargar imagen para conocer sus dimensiones reales
        const img = new Image()
        const imgLoaded = new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('La imagen capturada está dañada o no se pudo decodificar'))
        })
        img.src = imageDataUrl
        await imgLoaded

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
        const imgAspectRatio = img.width / img.height
        let imgWidth = availableWidth
        let imgHeight = imgWidth / imgAspectRatio

        if (imgHeight > availableHeight) {
          imgHeight = availableHeight
          imgWidth = imgHeight * imgAspectRatio
        }

        const imgLeft = (pageWidth - imgWidth) / 2
        pdfDoc.addImage(imageDataUrl, 'JPEG', imgLeft, marginTop, imgWidth, imgHeight)

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
