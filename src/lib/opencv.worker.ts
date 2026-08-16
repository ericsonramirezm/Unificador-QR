// Worker dedicado: corre OpenCV.js (WASM) fuera del hilo principal.
//
// La inicialización del WASM (~10MB) y el análisis de contornos de una foto
// son pesados — corriéndolos en el hilo principal, en algunos celulares
// bloquean la pestaña por completo durante la inicialización (confirmado en
// un dispositivo real: el modal quedaba en "Analizando documento..." sin
// responder a nada, ni siquiera a los botones). Acá, el hilo principal
// siempre queda libre para seguir respondiendo.
//
// IMPORTANTE — nada de async/await ni .then() en este archivo, a propósito:
// se comprobó con pruebas aisladas que, una vez que OpenCV.js termina de
// inicializar su runtime WASM (cv.calledRun se vuelve true), las
// continuaciones de Promise dejan de dispararse en este worker — código
// idéntico funciona perfecto si corre de forma síncrona (o encadenado con
// setTimeout) justo cuando se detecta que el runtime ya está listo, pero un
// simple `await cargarCV()` o `.then(...)` nunca continúa después de que
// OpenCV termina de cargar (su propio runtime rompe el microtask queue del
// worker al terminar — un problema conocido en builds de Emscripten de este
// tamaño). Por eso todo acá es por callbacks planos, nunca por await/then.
//
// Es un worker "clásico" (no de módulo) a propósito: importScripts() es la
// forma más simple y confiable de cargar el UMD de OpenCV.js acá, igual que
// el <script> que se usa en el hilo principal (ver opencv.ts) — la propia
// librería detecta "importScripts" disponible y expone self.cv (su rama
// "Web worker" del UMD). vite.config.ts fija worker.format='iife' para que
// el bundle de este archivo sea un worker clásico y no uno de módulo.

declare function importScripts(...urls: string[]): void

import opencvUrl from '@techstark/opencv-js/dist/opencv.js?url'

interface Punto {
  x: number
  y: number
}

let cvListo: any = null
let cargando = false

// Llama a `callback(cv)` en cuanto OpenCV esté listo — de inmediato si ya lo
// estaba, o sondeando con setTimeout hasta que `calledRun` se vuelva true.
function conCV(callback: (cv: any) => void) {
  if (cvListo) {
    callback(cvListo)
    return
  }
  if (!cargando) {
    cargando = true
    importScripts(opencvUrl)
  }
  const cv = (self as any).cv
  const revisar = () => {
    if (cv.calledRun) {
      cvListo = cv
      callback(cv)
    } else {
      setTimeout(revisar, 50)
    }
  }
  revisar()
}

// Mediana de brillo (histograma de 256 valores) — para calcular umbrales de
// Canny automáticos ("auto Canny") que se adaptan a la iluminación real de
// cada foto en vez de un umbral fijo que funciona en unas y falla en otras.
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

// Ordena 4 puntos como TL/TR/BR/BL vía la técnica estándar suma/diferencia.
function ordenarEsquinas(puntos: Punto[]) {
  const porSuma = [...puntos].sort((a, b) => a.x + a.y - (b.x + b.y))
  const porDiferencia = [...puntos].sort((a, b) => a.y - a.x - (b.y - b.x))
  return {
    tl: porSuma[0],
    br: porSuma[porSuma.length - 1],
    tr: porDiferencia[0],
    bl: porDiferencia[porDiferencia.length - 1],
  }
}

// Todo síncrono a propósito (ver nota al inicio del archivo) — se llama
// desde dentro del callback de `conCV`, nunca detrás de un await/then.
function detectarSync(cv: any, imageData: ImageData) {
  const w = imageData.width
  const h = imageData.height

  const src = cv.matFromImageData(imageData)
  const gray = new cv.Mat()
  const blurred = new cv.Mat()
  const edges = new cv.Mat()
  const dilated = new cv.Mat()
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()

  let resultado: ReturnType<typeof ordenarEsquinas> | null = null

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0)

    const mediana = medianaGrises(blurred)
    const sigma = 0.33
    const inferior = Math.max(0, (1 - sigma) * mediana)
    const superior = Math.min(255, (1 + sigma) * mediana)
    cv.Canny(blurred, edges, inferior, superior)
    cv.dilate(edges, dilated, kernel)
    cv.findContours(dilated, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)

    let mejorArea = w * h * 0.15
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
          mejorPuntos = [0, 1, 2, 3].map((j) => ({
            x: approx.data32S[j * 2],
            y: approx.data32S[j * 2 + 1],
          }))
        }
        approx.delete()
      }
      contorno.delete()
    }

    if (mejorPuntos) resultado = ordenarEsquinas(mejorPuntos)
  } finally {
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

self.onmessage = (e: MessageEvent) => {
  const { id, imageData } = e.data as { id: number; imageData: ImageData }
  conCV((cv) => {
    try {
      const esquinas = detectarSync(cv, imageData)
      ;(self as any).postMessage({ id, esquinas })
    } catch (err) {
      ;(self as any).postMessage({ id, error: err instanceof Error ? err.message : String(err) })
    }
  })
}
