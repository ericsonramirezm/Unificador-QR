// OpenCV.js corre dentro de un Web Worker (ver opencv.worker.ts), no en el
// hilo principal — la inicialización del WASM (~10MB) y el análisis de la
// foto son pesados, y en pruebas en un celular real, corriéndolo en el hilo
// principal dejaba el modal de escaneo completamente congelado (ni los
// botones respondían) mientras cargaba. Con el worker, el hilo principal
// nunca se bloquea, y si el worker se demora demasiado se cancela de verdad
// con worker.terminate() — un timeout normal no alcanza a proteger contra
// esto si lo que se cuelga es el propio hilo principal.
let worker: Worker | null = null
let siguienteId = 0

function obtenerWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./opencv.worker.ts', import.meta.url))
  }
  return worker
}

export interface EsquinasDetectadas {
  tl: { x: number; y: number }
  tr: { x: number; y: number }
  br: { x: number; y: number }
  bl: { x: number; y: number }
}

// Envía la foto (ya reducida) al worker y espera el resultado. Si no
// responde dentro de `timeoutMs`, se da por perdido: se termina el worker
// (para que la próxima foto arranque una instancia nueva y limpia, no una a
// medio inicializar) y se resuelve con null — quien llama debe usar el
// recuadro por defecto como respaldo.
export function detectarEnWorker(imageData: ImageData, timeoutMs = 20000): Promise<EsquinasDetectadas | null> {
  return new Promise((resolve) => {
    const w = obtenerWorker()
    const id = ++siguienteId

    const temporizador = setTimeout(() => {
      w.removeEventListener('message', onMessage)
      w.terminate()
      worker = null
      resolve(null)
    }, timeoutMs)

    function onMessage(e: MessageEvent) {
      if (e.data?.id !== id) return
      clearTimeout(temporizador)
      w.removeEventListener('message', onMessage)
      resolve(e.data.esquinas ?? null)
    }

    w.addEventListener('message', onMessage)
    w.postMessage({ id, imageData })
  })
}
