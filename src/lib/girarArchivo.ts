import { PDFDocument, degrees } from 'pdf-lib'

// Gira TODAS las páginas de un PDF (puede tener más de una si es un PDF real
// adjuntado, no una foto convertida) sumando los grados indicados a la
// rotación que ya tuviera cada página.
export async function girarPaginasPDF(pdfUrl: string, gradosAdicionales: number): Promise<Blob> {
  const res = await fetch(pdfUrl)
  if (!res.ok) throw new Error('No se pudo descargar el PDF para girarlo')
  const bytes = await res.arrayBuffer()
  const pdf = await PDFDocument.load(bytes)

  for (const pagina of pdf.getPages()) {
    const actual = pagina.getRotation().angle
    const nuevo = ((actual + gradosAdicionales) % 360 + 360) % 360
    pagina.setRotation(degrees(nuevo))
  }

  const outBytes = await pdf.save()
  return new Blob([outBytes as BlobPart], { type: 'application/pdf' })
}

// Gira la miniatura/foto (una imagen, no un PDF) el mismo ángulo, para que la
// vista previa siga coincidiendo con el PDF ya girado.
export async function girarImagen(imagenUrl: string, gradosAdicionales: number): Promise<Blob> {
  const res = await fetch(imagenUrl)
  if (!res.ok) throw new Error('No se pudo descargar la imagen para girarla')
  const blob = await res.blob()

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'))
    reader.readAsDataURL(blob)
  })

  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('No se pudo decodificar la imagen'))
    img.src = dataUrl
  })

  const esNoventaOTrescientos = (((gradosAdicionales % 180) + 180) % 180) !== 0
  const canvas = document.createElement('canvas')
  canvas.width = esNoventaOTrescientos ? img.naturalHeight : img.naturalWidth
  canvas.height = esNoventaOTrescientos ? img.naturalWidth : img.naturalHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo preparar el lienzo para girar la imagen')

  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((gradosAdicionales * Math.PI) / 180)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen girada'))),
      'image/jpeg',
      0.9
    )
  })
}
