// Escaneo estilo CamScanner: recorte + enderezado de perspectiva + mejora de
// color, todo en Canvas2D puro (sin opencv.js ni ninguna librería de visión
// por computador — ver contexto en el plan de esta funcionalidad).

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
// Sin librería de visión por computador (ver contexto: opencv.js pesa ~8MB y
// no conviene para uso en terreno). En su lugar: gradiente de Sobel + umbral
// adaptativo para encontrar píxeles de borde, un muestreo por sector angular
// (para acotar cuántos puntos entran al cierre convexo sin importar cuántos
// píxeles de borde haya), cierre convexo (monotone chain), reducción del
// cierre convexo a 4 vértices (eliminando iterativamente el vértice que
// menos área aporta, estilo Visvalingam-Whyatt), y ordenamiento de esquinas
// por la técnica estándar suma/diferencia. Es un "mejor esfuerzo": si la
// imagen no tiene suficiente contraste entre el papel y el fondo, devuelve
// null y quien llama debe usar `esquinasPorDefecto` como respaldo — el
// usuario siempre puede corregir arrastrando las esquinas en el modal.

interface PuntoConDistancia extends Punto {
  dist: number
}

function aGrises(canvas: HTMLCanvasElement): Float32Array {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo preparar el lienzo para detectar bordes')
  const { width: w, height: h } = canvas
  const datosImagen = ctx.getImageData(0, 0, w, h).data
  const gris = new Float32Array(w * h)
  for (let i = 0, p = 0; i < datosImagen.length; i += 4, p++) {
    gris[p] = 0.299 * datosImagen[i] + 0.587 * datosImagen[i + 1] + 0.114 * datosImagen[i + 2]
  }
  return gris
}

// Desenfoque de caja separable (horizontal + vertical), O(w*h) sin importar
// el radio. Se aplica antes del Sobel para que texturas de fondo (madera,
// tela, ruido del sensor) no generen gradientes tan fuertes como el borde
// real del documento — sin este paso, un fondo con textura puede "ganarle"
// al borde de la hoja y arruinar la detección.
function desenfoqueCaja(datos: Float32Array, w: number, h: number, radio: number): Float32Array {
  const temp = new Float32Array(w * h)
  const salida = new Float32Array(w * h)
  const norm = 2 * radio + 1

  for (let y = 0; y < h; y++) {
    let suma = 0
    for (let x = -radio; x <= radio; x++) {
      const xx = Math.min(w - 1, Math.max(0, x))
      suma += datos[y * w + xx]
    }
    for (let x = 0; x < w; x++) {
      temp[y * w + x] = suma / norm
      const xxOut = Math.min(w - 1, Math.max(0, x - radio))
      const xxIn = Math.min(w - 1, Math.max(0, x + radio + 1))
      suma += datos[y * w + xxIn] - datos[y * w + xxOut]
    }
  }

  for (let x = 0; x < w; x++) {
    let suma = 0
    for (let y = -radio; y <= radio; y++) {
      const yy = Math.min(h - 1, Math.max(0, y))
      suma += temp[yy * w + x]
    }
    for (let y = 0; y < h; y++) {
      salida[y * w + x] = suma / norm
      const yyOut = Math.min(h - 1, Math.max(0, y - radio))
      const yyIn = Math.min(h - 1, Math.max(0, y + radio + 1))
      suma += temp[yyIn * w + x] - temp[yyOut * w + x]
    }
  }

  return salida
}

function magnitudSobel(gris: Float32Array, w: number, h: number): Float32Array {
  const mag = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx =
        -gris[i - w - 1] +
        gris[i - w + 1] -
        2 * gris[i - 1] +
        2 * gris[i + 1] -
        gris[i + w - 1] +
        gris[i + w + 1]
      const gy =
        -gris[i - w - 1] -
        2 * gris[i - w] -
        gris[i - w + 1] +
        gris[i + w - 1] +
        2 * gris[i + w] +
        gris[i + w + 1]
      mag[i] = Math.abs(gx) + Math.abs(gy)
    }
  }
  return mag
}

function cruz(o: Punto, a: Punto, b: Punto): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

// Cierre convexo por "monotone chain" (Andrew), O(n log n).
function cierreConvexo(puntos: Punto[]): Punto[] {
  const pts = [...puntos].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
  const n = pts.length
  if (n < 3) return pts

  const inferior: Punto[] = []
  for (const p of pts) {
    while (
      inferior.length >= 2 &&
      cruz(inferior[inferior.length - 2], inferior[inferior.length - 1], p) <= 0
    ) {
      inferior.pop()
    }
    inferior.push(p)
  }

  const superior: Punto[] = []
  for (let i = n - 1; i >= 0; i--) {
    const p = pts[i]
    while (
      superior.length >= 2 &&
      cruz(superior[superior.length - 2], superior[superior.length - 1], p) <= 0
    ) {
      superior.pop()
    }
    superior.push(p)
  }

  inferior.pop()
  superior.pop()
  return inferior.concat(superior)
}

function areaTriangulo(a: Punto, b: Punto, c: Punto): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2
}

// Reduce un polígono convexo a 4 vértices eliminando repetidamente el que
// menos área "recorta" (el de menor triángulo con sus 2 vecinos) — conserva
// mejor la forma original que quedarse con 4 puntos arbitrarios.
function reducirACuadrilatero(hull: Punto[]): Punto[] {
  const puntos = [...hull]
  while (puntos.length > 4) {
    let idxMenor = 0
    let areaMenor = Infinity
    const n = puntos.length
    for (let i = 0; i < n; i++) {
      const prev = puntos[(i - 1 + n) % n]
      const actual = puntos[i]
      const next = puntos[(i + 1) % n]
      const area = areaTriangulo(prev, actual, next)
      if (area < areaMenor) {
        areaMenor = area
        idxMenor = i
      }
    }
    puntos.splice(idxMenor, 1)
  }
  return puntos
}

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

// Intenta detectar automáticamente las 4 esquinas del documento fotografiado.
// Devuelve null si no hay suficiente confianza (imagen plana/sin contraste,
// muy pocos bordes detectados, o el área resultante es demasiado pequeña) —
// en ese caso quien llama debe usar `esquinasPorDefecto`.
export function detectarEsquinasAutomaticas(img: HTMLImageElement): EsquinasDocumento | null {
  const LADO_TRABAJO = 500
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

  const gris = aGrises(canvas)
  // Radio 3 (caja 7x7) probado contra fondos con textura fuerte — buen
  // equilibrio entre suprimir ruido y no perder el borde real del documento.
  const grisSuavizado = desenfoqueCaja(gris, w, h, 3)
  const mag = magnitudSobel(grisSuavizado, w, h)

  let maxMag = 0
  for (let i = 0; i < mag.length; i++) if (mag[i] > maxMag) maxMag = mag[i]
  if (maxMag < 5) return null // imagen prácticamente plana, sin bordes detectables

  // Umbral automático por el método de Otsu (maximiza la varianza entre las
  // dos clases "fondo" vs "borde" del histograma de magnitudes). Es más
  // robusto que un percentil fijo: la proporción real de píxeles de borde
  // varía mucho según cuánto del encuadre ocupa el documento — un percentil
  // fijo (ej. "top 8%") falla cuando los bordes reales son una fracción
  // mucho menor de la imagen (el umbral termina cerca de 0 y "detecta" el
  // borde del lienzo completo en vez del documento).
  const bins = 256
  const hist = new Uint32Array(bins)
  for (let i = 0; i < mag.length; i++) {
    hist[Math.min(bins - 1, Math.floor((mag[i] / maxMag) * (bins - 1)))]++
  }
  const total = mag.length
  let sumaTotal = 0
  for (let b = 0; b < bins; b++) sumaTotal += b * hist[b]

  let sumaFondo = 0
  let pesoFondo = 0
  let mejorVarianza = -1
  let binUmbral = 0
  for (let b = 0; b < bins; b++) {
    pesoFondo += hist[b]
    if (pesoFondo === 0) continue
    const pesoBorde = total - pesoFondo
    if (pesoBorde === 0) break
    sumaFondo += b * hist[b]
    const mediaFondo = sumaFondo / pesoFondo
    const mediaBorde = (sumaTotal - sumaFondo) / pesoBorde
    const varianza = pesoFondo * pesoBorde * (mediaFondo - mediaBorde) ** 2
    if (varianza > mejorVarianza) {
      mejorVarianza = varianza
      binUmbral = b
    }
  }
  const umbral = (binUmbral / (bins - 1)) * maxMag

  // Un punto por sector angular (el más lejano del centro) — acota el cierre
  // convexo a como mucho `SECTORES` puntos sin importar cuántos píxeles de
  // borde haya, y se aproxima bien a la silueta exterior del documento.
  const cx = w / 2
  const cy = h / 2
  const SECTORES = 120
  const mejores = new Array<PuntoConDistancia | null>(SECTORES).fill(null)

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (mag[i] < umbral) continue
      const dx = x - cx
      const dy = y - cy
      const dist = dx * dx + dy * dy
      const angulo = Math.atan2(dy, dx) + Math.PI
      const sector = Math.min(SECTORES - 1, Math.floor((angulo / (2 * Math.PI)) * SECTORES))
      const actual = mejores[sector]
      if (!actual || dist > actual.dist) {
        mejores[sector] = { x, y, dist }
      }
    }
  }

  const puntos: Punto[] = mejores.filter((p): p is PuntoConDistancia => p !== null)
  if (puntos.length < 8) return null // muy pocos bordes detectados, sin confianza

  const hull = cierreConvexo(puntos)
  if (hull.length < 4) return null

  const cuadrilatero = reducirACuadrilatero(hull)
  const ordenado = ordenarEsquinas(cuadrilatero)

  if (areaCuadrilatero(ordenado) < w * h * 0.15) return null // área poco confiable

  const inv = 1 / factor
  const reescalar = (p: Punto): Punto => ({ x: p.x * inv, y: p.y * inv })
  return {
    tl: reescalar(ordenado.tl),
    tr: reescalar(ordenado.tr),
    br: reescalar(ordenado.br),
    bl: reescalar(ordenado.bl),
  }
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
