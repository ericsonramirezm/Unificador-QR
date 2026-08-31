/**
 * Encoge y comprime una foto **en el navegador**, antes de subirla.
 *
 * Sin este paso el sistema no es viable: una foto de cámara de celular pesa 3–5 MB,
 * y 500 artículos serían ~2 GB contra una cuota mensual de tráfico de 10 GB en el
 * plan gratuito de Supabase. Comprimidas, esos mismos 500 artículos ocupan ~70 MB
 * y la lista de Stock carga con señal mala en faena.
 *
 * No usa ninguna librería: `createImageBitmap` + `canvas` vienen en el navegador.
 */

/** Lado mayor de cada salida, en píxeles. */
const LADO_FOTO = 1200
const LADO_MINIATURA = 300

/** Calidad de compresión. 0.82 es el punto donde dejan de notarse los artefactos. */
const CALIDAD = 0.82

export interface FotoPreparada {
  /** Para la ficha del artículo. */
  foto: Blob
  /** Para las listas. Un décimo del peso. */
  miniatura: Blob
  /** Extensión real del blob (`webp` o `png`). Ver la nota sobre `toBlob`. */
  extension: string
}

/** Los formatos que `createImageBitmap` no sabe decodificar en ningún navegador. */
function pareceHeic(archivo: File): boolean {
  return /heic|heif/i.test(archivo.type) || /\.(heic|heif)$/i.test(archivo.name)
}

export async function prepararFoto(archivo: File): Promise<FotoPreparada> {
  if (!archivo.type.startsWith('image/') && !pareceHeic(archivo)) {
    throw new Error('Ese archivo no es una imagen.')
  }
  if (pareceHeic(archivo)) {
    // Mensaje explícito en vez de un fallo mudo: convertir HEIC exigiría una
    // librería de cientos de kB para un caso de borde que tiene salida fácil.
    throw new Error(
      'Esa foto está en formato HEIC, que el navegador no sabe abrir. Tómala con el botón de cámara, ' +
        'o cámbiale el formato a JPEG en los ajustes del teléfono.',
    )
  }

  let bitmap: ImageBitmap
  try {
    // `imageOrientation: 'from-image'` NO es opcional: el celular no rota los
    // píxeles al tomar una foto vertical, escribe la orientación en los metadatos
    // EXIF. Sin esto, `canvas` los ignora y todas las fotos verticales quedan
    // acostadas.
    bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('No se pudo leer la imagen. Puede estar dañada o en un formato que el navegador no abre.')
  }

  try {
    const foto = await redimensionar(bitmap, LADO_FOTO)
    const miniatura = await redimensionar(bitmap, LADO_MINIATURA)
    return { foto, miniatura, extension: foto.type === 'image/png' ? 'png' : 'webp' }
  } finally {
    bitmap.close()
  }
}

async function redimensionar(bitmap: ImageBitmap, ladoMayor: number): Promise<Blob> {
  const escala = Math.min(1, ladoMayor / Math.max(bitmap.width, bitmap.height))
  // Nunca se agranda: estirar una foto pequeña solo suma peso sin sumar detalle.
  const ancho = Math.max(1, Math.round(bitmap.width * escala))
  const alto = Math.max(1, Math.round(bitmap.height * escala))

  const lienzo = document.createElement('canvas')
  lienzo.width = ancho
  lienzo.height = alto

  const ctx = lienzo.getContext('2d')
  if (!ctx) throw new Error('El navegador no permitió procesar la imagen.')
  ctx.drawImage(bitmap, 0, 0, ancho, alto)

  return new Promise<Blob>((resolver, rechazar) => {
    lienzo.toBlob(
      (blob) => (blob ? resolver(blob) : rechazar(new Error('No se pudo comprimir la imagen.'))),
      'image/webp',
      CALIDAD,
    )
  })
}

/**
 * `toBlob` **cae a PNG en silencio** si el navegador no sabe codificar WebP: no
 * lanza error ni avisa, simplemente devuelve otro formato. Por eso el tipo que se
 * manda a Storage sale siempre de `blob.type`, nunca de una constante — si no, el
 * archivo quedaría guardado con un `content-type` que no le corresponde y el
 * navegador que lo descargue no sabría mostrarlo.
 */
export const tipoDe = (blob: Blob): string => blob.type || 'application/octet-stream'
