import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  EsquinasDocumento,
  Punto,
  areaCuadrilatero,
  cargarImagenDesdeBlob,
  escanearDocumento,
  esquinasPorDefecto,
} from '@lib/escaneoDocumento'

interface AjustarEsquinasModalProps {
  open: boolean
  imagenFile: File | null
  restantes?: number
  onAplicar: (blobProcesado: Blob, nombreOriginal: string) => void
  onCancelar: () => void
}

type NombreEsquina = keyof EsquinasDocumento

const ORDEN_ESQUINAS: NombreEsquina[] = ['tl', 'tr', 'br', 'bl']

export const AjustarEsquinasModal = ({
  open,
  imagenFile,
  restantes = 0,
  onAplicar,
  onCancelar,
}: AjustarEsquinasModalProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const [imagenCargada, setImagenCargada] = useState<HTMLImageElement | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [esquinas, setEsquinas] = useState<EsquinasDocumento | null>(null)
  const [arrastrando, setArrastrando] = useState<NombreEsquina | null>(null)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Al recibir una foto nueva: cargarla, calcular esquinas por defecto y
  // preparar su preview para mostrarla en el contenedor.
  useEffect(() => {
    if (!imagenFile) {
      setImagenCargada(null)
      setPreviewUrl(null)
      setEsquinas(null)
      setError(null)
      return
    }

    let cancelado = false
    setError(null)
    cargarImagenDesdeBlob(imagenFile)
      .then((img) => {
        if (cancelado) return
        setImagenCargada(img)
        setPreviewUrl(img.src)
        setEsquinas(esquinasPorDefecto(img.naturalWidth, img.naturalHeight))
      })
      .catch(() => {
        if (!cancelado) setError('No se pudo cargar la foto capturada')
      })

    return () => {
      cancelado = true
    }
  }, [imagenFile])

  // Convierte coordenadas de pantalla (clientX/Y) a píxeles naturales de la
  // imagen, usando el tamaño real renderizado del <img> en este instante.
  const aCoordenadasNaturales = (clientX: number, clientY: number): Punto | null => {
    const img = imgRef.current
    const naturalImg = imagenCargada
    if (!img || !naturalImg) return null
    const rect = img.getBoundingClientRect()
    const escalaX = naturalImg.naturalWidth / rect.width
    const escalaY = naturalImg.naturalHeight / rect.height
    const x = Math.min(Math.max((clientX - rect.left) * escalaX, 0), naturalImg.naturalWidth)
    const y = Math.min(Math.max((clientY - rect.top) * escalaY, 0), naturalImg.naturalHeight)
    return { x, y }
  }

  const aCoordenadasPantalla = (p: Punto): Punto => {
    const img = imgRef.current
    const naturalImg = imagenCargada
    if (!img || !naturalImg) return { x: 0, y: 0 }
    const rect = img.getBoundingClientRect()
    const container = containerRef.current?.getBoundingClientRect()
    const offsetX = container ? rect.left - container.left : 0
    const offsetY = container ? rect.top - container.top : 0
    return {
      x: offsetX + (p.x / naturalImg.naturalWidth) * rect.width,
      y: offsetY + (p.y / naturalImg.naturalHeight) * rect.height,
    }
  }

  const handlePointerDown = (esquina: NombreEsquina) => (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setArrastrando(esquina)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!arrastrando) return
    const punto = aCoordenadasNaturales(e.clientX, e.clientY)
    if (!punto) return
    setEsquinas((prev) => (prev ? { ...prev, [arrastrando]: punto } : prev))
  }

  const handlePointerUp = () => setArrastrando(null)

  const handleAplicar = async () => {
    if (!imagenCargada || !esquinas) return

    const areaImagen = imagenCargada.naturalWidth * imagenCargada.naturalHeight
    if (areaCuadrilatero(esquinas) < areaImagen * 0.05) {
      setError('Las esquinas seleccionadas son muy pequeñas o inválidas. Ajústalas sobre el documento.')
      return
    }

    setProcesando(true)
    setError(null)
    try {
      const blob = await escanearDocumento(imagenCargada, esquinas, { mejorarColor: true })
      onAplicar(blob, imagenFile?.name ?? 'documento.jpg')
    } catch {
      setError('No se pudo procesar el documento. Intenta ajustar las esquinas nuevamente.')
    } finally {
      setProcesando(false)
    }
  }

  const puntosPoligono = esquinas
    ? ORDEN_ESQUINAS.map((n) => {
        const p = aCoordenadasPantalla(esquinas[n])
        return `${p.x},${p.y}`
      }).join(' ')
    : ''

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onCancelar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-lg shadow-xl z-50 p-6">
          <div className="flex items-center justify-between mb-2">
            <Dialog.Title className="text-lg font-bold text-slate-900">Ajustar documento</Dialog.Title>
            <button
              type="button"
              onClick={onCancelar}
              className="text-slate-400 hover:text-slate-700 text-2xl leading-none"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Arrastra las esquinas para que coincidan con los bordes del documento.
            {restantes > 0 && ` Quedan ${restantes} foto${restantes > 1 ? 's' : ''} más por ajustar.`}
          </p>

          {previewUrl && esquinas ? (
            <div
              ref={containerRef}
              className="relative bg-slate-100 rounded-lg overflow-hidden select-none p-6"
              style={{ touchAction: 'none' }}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <img
                ref={imgRef}
                src={previewUrl}
                alt="Documento capturado"
                className="w-full h-auto block max-h-[60vh] object-contain mx-auto"
                draggable={false}
              />
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                <polygon points={puntosPoligono} className="fill-blue-500/20 stroke-blue-500" strokeWidth={2} />
              </svg>
              {ORDEN_ESQUINAS.map((n) => {
                const p = aCoordenadasPantalla(esquinas[n])
                return (
                  <div
                    key={n}
                    onPointerDown={handlePointerDown(n)}
                    className="absolute w-11 h-11 rounded-full bg-blue-600 border-2 border-white shadow-lg touch-none cursor-grab active:cursor-grabbing"
                    style={{ left: p.x, top: p.y, marginLeft: -22, marginTop: -22 }}
                  />
                )
              })}
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
              Cargando foto...
            </div>
          )}

          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={onCancelar}
              disabled={procesando}
              className="flex-1 bg-slate-600 text-white font-semibold py-3 rounded-lg hover:bg-slate-700 disabled:bg-slate-300"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleAplicar}
              disabled={procesando || !esquinas}
              className="flex-1 bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 disabled:bg-slate-400"
            >
              {procesando ? 'Procesando...' : '✓ Aplicar'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
