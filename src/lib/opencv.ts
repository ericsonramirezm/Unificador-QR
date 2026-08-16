// Carga perezosa de OpenCV.js (WASM, ~10MB) — solo se descarga cuando
// alguien realmente abre el modal de escaneo (Supervisor/APR), nunca en la
// carga inicial de la app (Coordinador y Consultor jamás la descargan).
//
// Se carga como <script> global (no como import de módulo ES) a propósito:
// el archivo que genera este paquete trae un UMD con dos capas de detección
// module.exports/exports anidadas (boilerplate típico de Emscripten), y el
// interop CommonJS->ESM de Rollup/Vite lo interpreta mal en el build de
// producción — el `import cv from '@techstark/opencv-js'` que sugiere la
// documentación del paquete queda con un export renombrado e impredecible
// (comprobado: en un build terminó siendo `mod.o` en vez de `mod.default`).
// Cargándolo como script de toda la vida se evita ese problema por completo:
// el propio archivo, al no detectar un sistema de módulos, cae en su rama
// "Browser globals" y expone `window.cv` de forma confiable — el mismo
// patrón `?url` que ya usa este proyecto para el worker de pdfjs-dist.
import opencvUrl from '@techstark/opencv-js/dist/opencv.js?url'

let cargaOpenCV: Promise<any> | null = null

function inyectarScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('No se pudo cargar OpenCV.js'))
    document.head.appendChild(script)
  })
}

// Se espera explícitamente `onRuntimeInitialized` (el mecanismo estándar y
// documentado de Emscripten) en vez del objeto "thenable" que expone el
// propio `cv` — en pruebas, awaitear ese thenable una segunda vez (ej. si
// algo más en la página también espera a `window.cv`) se quedó colgado sin
// error ni timeout. `onRuntimeInitialized` es más predecible y esta función
// además encadena cualquier callback que ya hubiera (por si algo más lo usa).
function esperarListo(cv: any): Promise<any> {
  if (cv.calledRun) return Promise.resolve(cv)
  return new Promise((resolve) => {
    const anterior = cv.onRuntimeInitialized
    cv.onRuntimeInitialized = () => {
      if (typeof anterior === 'function') anterior()
      resolve(cv)
    }
  })
}

// Nunca dejar que un problema de carga/inicialización (red lenta, un WASM
// que no arranca, lo que sea) bloquee el modal de escaneo indefinidamente —
// pasado este tiempo se da por fallida la detección automática y quien llama
// (detectarEsquinasAutomaticas) cae al recuadro por defecto, que el usuario
// puede ajustar a mano igual.
function conTimeout<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const temporizador = setTimeout(() => reject(new Error('OpenCV.js no respondió a tiempo')), ms)
    promesa.then(
      (v) => {
        clearTimeout(temporizador)
        resolve(v)
      },
      (e) => {
        clearTimeout(temporizador)
        reject(e)
      }
    )
  })
}

export function obtenerOpenCV(): Promise<any> {
  if (!cargaOpenCV) {
    cargaOpenCV = conTimeout(
      (async () => {
        await inyectarScript(opencvUrl)
        return esperarListo((window as any).cv)
      })(),
      20000
    )
  }
  return cargaOpenCV
}
