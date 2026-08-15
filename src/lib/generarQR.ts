import QRCode from 'qrcode'

/**
 * Genera un QR con un texto (ej. la fecha) superpuesto en el centro.
 * Usa nivel de corrección de errores "H" (tolera ~30% de la imagen cubierta),
 * y la caja de texto ocupa una fracción bastante menor que ese margen, así el
 * QR sigue siendo escaneable sin problema.
 */
export async function generarQRConFecha(valor: string, textoCentral: string, size = 300): Promise<string> {
  const qrDataUrl = await QRCode.toDataURL(valor, {
    errorCorrectionLevel: 'H',
    width: size,
    margin: 1,
  })

  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('No se pudo generar la imagen del QR'))
    img.src = qrDataUrl
  })

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo preparar el lienzo para el QR')

  ctx.drawImage(img, 0, 0, size, size)

  // Caja blanca centrada para el texto — pequeña respecto al QR completo,
  // muy por debajo del margen de tolerancia del nivel de corrección "H".
  const boxWidth = size * 0.4
  const boxHeight = size * 0.15
  const boxX = (size - boxWidth) / 2
  const boxY = (size - boxHeight) / 2
  const radius = size * 0.02

  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#1e293b'
  ctx.lineWidth = Math.max(1, size * 0.006)
  ctx.beginPath()
  ctx.moveTo(boxX + radius, boxY)
  ctx.arcTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + boxHeight, radius)
  ctx.arcTo(boxX + boxWidth, boxY + boxHeight, boxX, boxY + boxHeight, radius)
  ctx.arcTo(boxX, boxY + boxHeight, boxX, boxY, radius)
  ctx.arcTo(boxX, boxY, boxX + boxWidth, boxY, radius)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = '#1e293b'
  ctx.font = `bold ${Math.round(size * 0.045)}px Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(textoCentral, size / 2, size / 2 + 1)

  return canvas.toDataURL('image/png')
}
