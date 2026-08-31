import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Menú de un clic derecho (escritorio) o mantener presionado ~500 ms (celular).
 *
 * Se construye a mano en vez de agregar `@radix-ui/react-context-menu`: solo hay
 * uno o dos ítems por menú, y una librería no resuelve la parte difícil — el
 * long-press en touch hay que escribirlo igual — así que solo agregaría peso.
 */
export interface ItemMenuContextual {
  etiqueta: string
  tono?: 'normal' | 'peligro'
  onSeleccionar: () => void
}

interface Posicion {
  x: number
  y: number
}

const DURACION_LONG_PRESS = 500
/** Algunos navegadores emiten un `click` sintético tras el `touchend` de un
 * long-press; durante esta ventana se ignora para no disparar además `onFila`. */
const SUPRESION_CLIC_MS = 350

export function useMenuContextual(items: ItemMenuContextual[], activo = true) {
  const [posicion, setPosicion] = useState<Posicion | null>(null)
  const suprimirClicRef = useRef(false)
  const temporizadorRef = useRef<number | null>(null)

  function limpiarTemporizador() {
    if (temporizadorRef.current !== null) {
      window.clearTimeout(temporizadorRef.current)
      temporizadorRef.current = null
    }
  }

  function abrirEn(x: number, y: number) {
    // Clamp aproximado al viewport: el menú real mide su alto/ancho recién al
    // pintarse, así que se estima con margen generoso en vez de medirlo.
    const ANCHO = 200
    const ALTO = items.length * 38 + 16
    const clampX = Math.min(Math.max(8, x), window.innerWidth - ANCHO - 8)
    const clampY = Math.min(Math.max(8, y), window.innerHeight - ALTO - 8)
    setPosicion({ x: clampX, y: clampY })
  }

  function onContextMenu(e: React.MouseEvent) {
    if (!activo || items.length === 0) return
    e.preventDefault()
    abrirEn(e.clientX, e.clientY)
  }

  function onTouchStart(e: React.TouchEvent) {
    if (!activo || items.length === 0) return
    const toque = e.touches[0]
    limpiarTemporizador()
    temporizadorRef.current = window.setTimeout(() => {
      suprimirClicRef.current = true
      window.setTimeout(() => {
        suprimirClicRef.current = false
      }, SUPRESION_CLIC_MS)
      abrirEn(toque.clientX, toque.clientY)
    }, DURACION_LONG_PRESS)
  }

  function onTouchMove() {
    limpiarTemporizador()
  }

  function onTouchEnd() {
    limpiarTemporizador()
  }

  useEffect(() => {
    if (!posicion) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPosicion(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [posicion])

  // Portal a `document.body`: la tabla de escritorio vive dentro de un
  // contenedor `overflow-x-auto`, donde un menú `absolute` quedaría recortado o
  // desplazado por el scroll horizontal. `position: fixed` + portal lo evita.
  const menu =
    posicion && items.length > 0
      ? createPortal(
          <>
            <div
              className="fixed inset-0 z-[90]"
              onClick={() => setPosicion(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                setPosicion(null)
              }}
            />
            <div
              role="menu"
              className="fixed z-[91] min-w-[180px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
              style={{ left: posicion.x, top: posicion.y }}
            >
              {items.map((it) => (
                <button
                  key={it.etiqueta}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPosicion(null)
                    it.onSeleccionar()
                  }}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                    it.tono === 'peligro' ? 'text-red-600' : 'text-slate-700'
                  }`}
                >
                  {it.etiqueta}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )
      : null

  return {
    manejadores: { onContextMenu, onTouchStart, onTouchMove, onTouchEnd },
    menu,
    /** El `onClick` de la fila debe llamar esto antes de abrir `onFila`. */
    debeIgnorarClic: () => suprimirClicRef.current,
  }
}
