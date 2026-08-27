// Compresión de imágenes antes de subirlas a Storage.
//
// Antes, las fotos viajaban intactas: 3 a 5 MB cada una salidas de la
// cámara del celular. Un Daily Report con doce fotos son unos 48 MB por un
// enlace intermitente, y en el flujo de documentos QR se subía además un
// PDF con la misma imagen a resolución natural — unos 7,5 MB por documento.
// Cada megabyte de más es una oportunidad de que se corte la señal a mitad
// de la subida.
//
// Se usan dos presets distintos a propósito: un escaneo de una guía de
// despacho tiene texto que hay que poder leer al imprimir el compilado, y
// una foto de avance de obra no.

export interface OpcionesCompresion {
  /** Lado mayor máximo, en píxeles. Si la imagen ya es menor, no se agranda. */
  ladoMayorMax: number
  /** Calidad JPEG, de 0 a 1. */
  calidad: number
}

/**
 * Documentos escaneados (guías, certificados, protocolos). Conservador a
 * propósito: 2000 px de lado mayor mantiene legible la letra chica y los
 * sellos, y aun así baja de ~4 MB a ~1,5 MB.
 */
export const DOCUMENTO_ESCANEADO: OpcionesCompresion = { ladoMayorMax: 2000, calidad: 0.85 }

/**
 * Fotos de avance en terreno (Daily Report). Son ilustrativas, no se les
 * lee texto, así que admiten más compresión: de ~4 MB a ~350 kB.
 */
export const FOTO_TERRENO: OpcionesCompresion = { ladoMayorMax: 1600, calidad: 0.8 }

function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('La imagen está dañada o no se pudo decodificar'))
    img.src = src
  })
}

function leerComoDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Redimensiona y recomprime una imagen. Devuelve un Blob JPEG.
 *
 * Dibujar en un <canvas> también normaliza la orientación EXIF: los
 * navegadores ya aplican la rotación al renderizar, así que lo que sale del
 * canvas queda derecho y sin tag EXIF (mismo razonamiento que en
 * usePDFGenerator).
 *
 * Si algo falla, devuelve el original sin comprimir en vez de reventar: es
 * preferible subir una foto pesada a perder la evidencia del turno.
 */
export async function comprimirImagen(entrada: Blob, opciones: OpcionesCompresion): Promise<Blob> {
  try {
    const dataUrl = await leerComoDataUrl(entrada)
    const img = await cargarImagen(dataUrl)

    const ladoMayor = Math.max(img.naturalWidth, img.naturalHeight)
    const escala = ladoMayor > opciones.ladoMayorMax ? opciones.ladoMayorMax / ladoMayor : 1

    const ancho = Math.round(img.naturalWidth * escala)
    const alto = Math.round(img.naturalHeight * escala)

    const canvas = document.createElement('canvas')
    canvas.width = ancho
    canvas.height = alto
    const ctx = canvas.getContext('2d')
    if (!ctx) return entrada

    // Mejora notablemente el texto de los escaneos al reducir de tamaño.
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, ancho, alto)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', opciones.calidad)
    )

    if (!blob) return entrada
    // Si comprimir no ayudó (por ejemplo, una imagen ya pequeña y muy
    // optimizada), se queda con la original.
    return blob.size < entrada.size ? blob : entrada
  } catch {
    return entrada
  }
}

/**
 * Igual que comprimirImagen, pero conservando el nombre del archivo — para
 * cuando lo que se sube es un File y no un Blob suelto.
 */
export async function comprimirArchivo(archivo: File, opciones: OpcionesCompresion): Promise<File> {
  // Los PDF y cualquier cosa que no sea imagen pasan de largo.
  if (!archivo.type.startsWith('image/')) return archivo

  const blob = await comprimirImagen(archivo, opciones)
  if (blob === archivo) return archivo

  const nombreBase = archivo.name.replace(/\.[^.]+$/, '')
  return new File([blob], `${nombreBase}.jpg`, { type: 'image/jpeg', lastModified: archivo.lastModified })
}
