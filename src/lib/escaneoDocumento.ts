// Escaneo estilo CamScanner: recorte + enderezado de perspectiva + mejora de
// color. El recorte/enderezado/mejora es Canvas2D puro; la detección
// automática de esquinas usa OpenCV.js (ver detectarEsquinasAutomaticas más
// abajo) — se probó primero una heurística hecha a mano para evitar los ~8MB
// de esa librería, pero fallaba en fotos reales con poca luz o fondo con
// textura, así que se reemplazó por detección de contornos real.
import { obtenerOpenCV } from '@lib/opencv'

export interface Punto {
  x: number
  y: number
}

export interface EsquinasDocumento {
  tl: Punto
  tr: Punto
  br: Punto
  bl: Punto
}

// Posición inicial razonable para las 4 esquinas: un inset del 8% en cada
// eje, asumiendo que el usuario ya encuadró el documento razonablemente bien.
export function esquinasPorDefecto(anchoImg: number, altoImg: number): EsquinasDocumento {
  const insetX = anchoImg * 0.08
  const insetY = altoImg * 0.08
  return {
    tl: { x: insetX, y: insetY },
    tr: { x: anchoImg - insetX, y: insetY },
    br: { x: anchoImg - insetX, y: altoImg - insetY },
    bl: { x: insetX, y: altoImg - insetY },
  }
}

// --- Detección automática de bordes ("smart scan") ---
//
// Primero se probó una heurística hecha a mano (gradiente de Sobel + Otsu +
// cierre convexo) para evitar los ~8MB de OpenCV.js — funcionaba bien en
// pruebas sintéticas, pero falló en fotos reales con poca luz y fondo con
// textura (encontraba un cuadrilátero cercano a los bordes de toda la foto,
// no del documento). Se reemplazó por detección de contornos real con
// OpenCV.js, cargado de forma perezosa (ver @lib/opencv) para que ese peso
// solo lo paguen Supervisor/APR al abrir el modal de escaneo, nunca el resto
// de la app. Es un "mejor esfuerzo": si no encuentra un cuadrilátero
// confiable, devuelve null y quien llama debe usar `esquinasPorDefecto` — el
// usuario siempre puede corregir arrastrando las esquinas en el modal.

// Ordena 4 puntos como TL/TR/BR/BL vía la técnica estándar suma/diferencia:
// TL tiene la menor (x+y), BR la mayor; TR tiene la menor (y-x), BL la mayor.
function ordenarEsquinas(puntos: Punto[]): EsquinasDocumento {
  const porSuma = [...puntos].sort((a, b) => a.x + a.y - (b.x + b.y))
  const porDiferencia = [...puntos].sort((a, b) => a.y - a.x - (b.y - b.x))
  return {
    tl: porSuma[0],
    br: porSuma[porSuma.length - 1],
    tr: porDiferencia[0],
    bl: porDiferencia[porDiferencia.length - 1],
  }
}

// Mediana de brillo de una imagen en escala de grises (histograma de 256
// valores) — se usa para calcular umbrales de Canny automáticos ("auto
// Canny"), que se adaptan a la iluminación real de cada foto en vez de un
// umbral fijo que funciona en unas fotos y falla en otras más oscuras.
function medianaGrises(mat: any): number {
  const datos: Uint8Array = mat.data
  const hist = new Uint32Array(256)
  for (let i = 0; i < datos.length; i++) hist[datos[i]]++
  const mitad = datos.length / 2
  let acumulado = 0
  for (let v = 0; v < 256; v++) {
    acumulado += hist[v]
    if (acumulado >= mitad) return v
  }
  return 128
}

// Intenta detectar automáticamente las 4 esquinas del documento fotografiado
// vía OpenCV.js: gris -> desenfoque -> Canny (umbrales automáticos según el
// brillo de la foto) -> dilatación (cierra pequeños huecos en el borde) ->
// contornos -> el cuadrilátero convexo de mayor área. Devuelve null si no
// hay suficiente confianza (contorno muy chico, o ninguno de 4 lados) — en
// ese caso quien llama debe usar `esquinasPorDefecto` como respaldo.
export async function detectarEsquinasAutomaticas(img: HTMLImageElement): Promise<EsquinasDocumento | null> {
  const LADO_TRABAJO = 800
  const lado = Math.max(img.naturalWidth, img.naturalHeight)
  const factor = lado > LADO_TRABAJO ? LADO_TRABAJO / lado : 1
  const w = Math.round(img.naturalWidth * factor)
  const h = Math.round(img.naturalHeight * factor)
  if (w < 20 || h < 20) return null

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // Único drawImage plano del original: el navegador ya aplicó la corrección
  // EXIF al decodificar `img` — no se toca ninguna rotación manual aquí.
  ctx.drawImage(img, 0, 0, w, h)

  let cv: any
  try {
    cv = await obtenerOpenCV()
  } catch {
    return null // sin OpenCV disponible (ej. sin red la primera vez) -> respaldo
  }

  const src = cv.imread(canvas)
  const gray = new cv.Mat()
  const blurred = new cv.Mat()
  const edges = new cv.Mat()
  const dilated = new cv.Mat()
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()

  let resultado: EsquinasDocumento | null = null

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0)

    // Umbrales de Canny automáticos ("auto Canny") según la mediana de
    // brillo de esta foto en particular, en vez de un umbral fijo.
    const mediana = medianaGrises(blurred)
    const sigma = 0.33
    const inferior = Math.max(0, (1 - sigma) * mediana)
    const superior = Math.min(255, (1 + sigma) * mediana)
    cv.Canny(blurred, edges, inferior, superior)
    cv.dilate(edges, dilated, kernel)

    cv.findContours(dilated, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)

    let mejorArea = w * h * 0.15 // mismo umbral de confianza que el algoritmo anterior
    let mejorPuntos: Punto[] | null = null

    for (let i = 0; i < contours.size(); i++) {
      const contorno = contours.get(i)
      const area = cv.contourArea(contorno)

      if (area > mejorArea) {
        const perimetro = cv.arcLength(contorno, true)
        const approx = new cv.Mat()
        cv.approxPolyDP(contorno, approx, 0.02 * perimetro, true)

        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          mejorArea = area
          mejorPuntos = [
            { x: approx.data32S[0], y: approx.data32S[1] },
            { x: approx.data32S[2], y: approx.data32S[3] },
            { x: approx.data32S[4], y: approx.data32S[5] },
            { x: approx.data32S[6], y: approx.data32S[7] },
          ]
        }
        approx.delete()
      }
      contorno.delete()
    }

    if (mejorPuntos) {
      const ordenado = ordenarEsquinas(mejorPuntos)
      const inv = 1 / factor
      resultado = {
        tl: { x: ordenado.tl.x * inv, y: ordenado.tl.y * inv },
        tr: { x: ordenado.tr.x * inv, y: ordenado.tr.y * inv },
        br: { x: ordenado.br.x * inv, y: ordenado.br.y * inv },
        bl: { x: ordenado.bl.x * inv, y: ordenado.bl.y * inv },
      }
    }
  } finally {
    // Las Mat de OpenCV.js viven en memoria WASM y no tienen recolector de
    // basura automático — hay que liberarlas explícitamente o se acumulan.
    src.delete()
    gray.delete()
    blurred.delete()
    edges.delete()
    dilated.delete()
    kernel.delete()
    contours.delete()
    hierarchy.delete()
  }

  return resultado
}

// Igual patrón que girarArchivo.ts/usePDFGenerator.ts: FileReader -> Image.
// El navegador aplica la corrección EXIF al decodificar/renderizar la imagen
// — no se parsea ningún tag EXIF a mano en ningún punto de este archivo.
export async function cargarImagenDesdeBlob(blob: Blob): Promise<HTMLImageElement> {
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
  return img
}

// Área de un cuadrilátero (fórmula del "shoelace") — usada para rechazar
// selecciones degeneradas (esquinas casi colineales o cruzadas).
export function areaCuadrilatero(e: EsquinasDocumento): number {
  const pts = [e.tl, e.tr, e.br, e.bl]
  let area = 0
  for (let i = 0; i < 4; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % 4]
    area += a.x * b.y - b.x * a.y
  }
  return Math.abs(area) / 2
}

// Reduce la imagen fuente a un máximo de `maxLado` px de lado largo antes de
// procesarla (las fotos de celular llegan a 3000-4000px; no hace falta esa
// resolución para una sola página Letter, y mantiene la grilla de warp
// rápida). Único drawImage plano del original: es lo que "hornea" la
// corrección EXIF ya aplicada por el navegador al decodificar la imagen.
function downscalarSiEsNecesario(
  img: HTMLImageElement,
  maxLado: number
): { canvas: HTMLCanvasElement; factor: number } {
  const lado = Math.max(img.naturalWidth, img.naturalHeight)
  const factor = lado > maxLado ? maxLado / lado : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * factor)
  canvas.height = Math.round(img.naturalHeight * factor)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo preparar el lienzo para procesar la foto')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return { canvas, factor }
}

// Resuelve un sistema lineal cuadrado A*x = b por eliminación gaussiana con
// pivoteo parcial. Usado para la homografía (sistema 8x8).
function resolverSistemaLineal(A: number[][], b: number[]): number[] {
  const n = A.length
  const M = A.map((fila, i) => [...fila, b[i]])

  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    }
    if (Math.abs(M[piv][col]) < 1e-10) {
      throw new Error('Selección de esquinas inválida (puntos casi colineales)')
    }
    ;[M[col], M[piv]] = [M[piv], M[col]]

    const pivotVal = M[col][col]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = M[r][col] / pivotVal
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c]
    }
  }

  return M.map((fila, i) => fila[n] / fila[i])
}

// Homografía 3x3 (8 incógnitas, h33=1) que mapea 4 puntos `src` -> 4 puntos
// `dst`, resuelta vía DLT clásico (4 correspondencias -> sistema lineal 8x8).
type Homografia = number[] // 9 valores, fila por fila, [8] siempre 1

function calcularHomografia(src: Punto[], dst: Punto[]): Homografia {
  const A: number[][] = []
  const b: number[] = []

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u])
    b.push(u)
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v])
    b.push(v)
  }

  const h = resolverSistemaLineal(A, b)
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

function aplicarHomografia(h: Homografia, x: number, y: number): Punto {
  const w = h[6] * x + h[7] * y + h[8]
  return {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w,
  }
}

// Tamaño del rectángulo destino: promedio de los anchos/altos que implican
// las 4 esquinas ajustadas. No se fuerza ninguna proporción — el hook que
// arma el PDF (usePDFGenerator.ts) ya escala y centra cualquier proporción
// sobre la página Letter.
function tamanioDestino(e: EsquinasDocumento): { W: number; H: number } {
  const dist = (a: Punto, b: Punto) => Math.hypot(a.x - b.x, a.y - b.y)
  const anchoTop = dist(e.tl, e.tr)
  const anchoBottom = dist(e.bl, e.br)
  const altoLeft = dist(e.tl, e.bl)
  const altoRight = dist(e.tr, e.br)
  const W = Math.round((anchoTop + anchoBottom) / 2)
  const H = Math.round((altoLeft + altoRight) / 2)
  return { W: Math.max(W, 50), H: Math.max(H, 50) }
}

// Dibuja un triángulo "texturizado" con la porción correspondiente de
// `source`: técnica estándar en Canvas2D (que solo soporta transformaciones
// afines) para lograr un warp perspectivo — se recorta al triángulo destino
// y se dibuja la imagen fuente completa bajo la transformación afín que
// mapea el triángulo fuente al triángulo destino.
function dibujarTrianguloAfin(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  s0: Punto,
  s1: Punto,
  s2: Punto,
  d0: Punto,
  d1: Punto,
  d2: Punto
) {
  ctx.save()

  ctx.beginPath()
  ctx.moveTo(d0.x, d0.y)
  ctx.lineTo(d1.x, d1.y)
  ctx.lineTo(d2.x, d2.y)
  ctx.closePath()
  ctx.clip()

  const denom = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y)
  if (Math.abs(denom) > 1e-8) {
    const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denom
    const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denom
    const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denom
    const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denom
    const e =
      (d0.x * (s1.x * s2.y - s2.x * s1.y) +
        d1.x * (s2.x * s0.y - s0.x * s2.y) +
        d2.x * (s0.x * s1.y - s1.x * s0.y)) /
      denom
    const f =
      (d0.y * (s1.x * s2.y - s2.x * s1.y) +
        d1.y * (s2.x * s0.y - s0.x * s2.y) +
        d2.y * (s0.x * s1.y - s1.x * s0.y)) /
      denom

    ctx.setTransform(a, b, c, d, e, f)
    ctx.drawImage(source, 0, 0)
  }

  ctx.restore()
}

// Recorta+endereza la imagen fuente según las 4 esquinas ajustadas por el
// usuario, subdividiendo el rectángulo destino en una grilla fina de
// triángulos (cada uno, al ser pequeño, se ve indistinguible de su
// aproximación afín aunque el mapeo real sea proyectivo).
function renderizarWarp(
  sourceCanvas: HTMLCanvasElement,
  esquinasSrc: EsquinasDocumento,
  destino: { W: number; H: number },
  cols = 24,
  rows = 24
): HTMLCanvasElement {
  const outCanvas = document.createElement('canvas')
  outCanvas.width = destino.W
  outCanvas.height = destino.H
  const ctx = outCanvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo preparar el lienzo para el escaneo')

  const dstCorners = [
    { x: 0, y: 0 },
    { x: destino.W, y: 0 },
    { x: destino.W, y: destino.H },
    { x: 0, y: destino.H },
  ]
  const srcCorners = [esquinasSrc.tl, esquinasSrc.tr, esquinasSrc.br, esquinasSrc.bl]
  // Homografía destino->fuente: para cada punto de la grilla destino
  // obtenemos directamente su punto correspondiente en la imagen fuente.
  const Hinv = calcularHomografia(dstCorners, srcCorners)

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const du0 = (destino.W * i) / cols
      const du1 = (destino.W * (i + 1)) / cols
      const dv0 = (destino.H * j) / rows
      const dv1 = (destino.H * (j + 1)) / rows

      const dTL = { x: du0, y: dv0 }
      const dTR = { x: du1, y: dv0 }
      const dBR = { x: du1, y: dv1 }
      const dBL = { x: du0, y: dv1 }

      const sTL = aplicarHomografia(Hinv, dTL.x, dTL.y)
      const sTR = aplicarHomografia(Hinv, dTR.x, dTR.y)
      const sBR = aplicarHomografia(Hinv, dBR.x, dBR.y)
      const sBL = aplicarHomografia(Hinv, dBL.x, dBL.y)

      dibujarTrianguloAfin(ctx, sourceCanvas, sTL, sTR, sBL, dTL, dTR, dBL)
      dibujarTrianguloAfin(ctx, sourceCanvas, sTR, sBR, sBL, dTR, dBR, dBL)
    }
  }

  return outCanvas
}

// Mejora "color mejorado": stretch lineal de histograma con recorte por
// percentiles 1%/99% (robusto a sombras y reflejos de flash), aplicado por
// canal RGB — mantiene el color, no convierte a blanco y negro — más un
// pequeño lift de brillo.
function mejorarColor(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = imgData.data
  const totalPixels = d.length / 4

  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) {
    const lum = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
    hist[lum]++
  }

  const lowCut = totalPixels * 0.01
  const highCut = totalPixels * 0.01
  let acc = 0
  let lo = 0
  let hi = 255
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= lowCut) {
      lo = v
      break
    }
  }
  acc = 0
  for (let v = 255; v >= 0; v--) {
    acc += hist[v]
    if (acc >= highCut) {
      hi = v
      break
    }
  }
  if (hi <= lo) {
    hi = 255
    lo = 0
  }

  const range = hi - lo
  const contrastGain = 255 / range
  const brightnessLift = 8
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = (d[i + c] - lo) * contrastGain + brightnessLift
      d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v
    }
  }

  ctx.putImageData(imgData, 0, 0)
}

export interface OpcionesEscaneo {
  maxLado?: number
  mejorarColor?: boolean
}

// Punto de entrada: recorta+endereza+mejora una imagen ya cargada según las
// esquinas ajustadas por el usuario (en el espacio de píxeles ORIGINAL,
// naturalWidth/naturalHeight, no el reducido). Devuelve un JPEG sin EXIF.
export async function escanearDocumento(
  img: HTMLImageElement,
  esquinasOriginal: EsquinasDocumento,
  opciones: OpcionesEscaneo = {}
): Promise<Blob> {
  const { canvas: sourceCanvas, factor } = downscalarSiEsNecesario(img, opciones.maxLado ?? 2000)

  const escalar = (p: Punto): Punto => ({ x: p.x * factor, y: p.y * factor })
  const esquinasSrc: EsquinasDocumento = {
    tl: escalar(esquinasOriginal.tl),
    tr: escalar(esquinasOriginal.tr),
    br: escalar(esquinasOriginal.br),
    bl: escalar(esquinasOriginal.bl),
  }

  const destino = tamanioDestino(esquinasSrc)
  const warped = renderizarWarp(sourceCanvas, esquinasSrc, destino)

  if (opciones.mejorarColor !== false) mejorarColor(warped)

  return new Promise<Blob>((resolve, reject) => {
    warped.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen escaneada'))),
      'image/jpeg',
      0.92
    )
  })
}
