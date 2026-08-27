import { useRef, useState } from 'react'
import { comprimirArchivo, FOTO_TERRENO } from '@lib/comprimirImagen'

// Cuántos píxeles hay que arrastrar antes de que se active el reordenamiento.
// Sin este umbral, cualquier toque iniciaba un arrastre: como las fotos
// ocupan media pantalla en celular, deslizar el dedo para hacer scroll
// terminaba reordenando las fotos — y ese orden es el que define cómo
// entran al Excel.
const UMBRAL_ARRASTRE = 10

export interface FotoPendiente {
  // Una de las dos, según si es una foto nueva (recién elegida en este
  // formulario, todavía no subida) o una ya existente (al editar un
  // Daily Report que ya tenía fotos guardadas en Storage).
  file?: File
  url?: string
  caption: string
  preview: string // <img src> — blob: para nuevas, la URL real para existentes
}

interface GestorFotosProps {
  fotos: FotoPendiente[]
  onChange: (fotos: FotoPendiente[]) => void
}

// Módulo de carga y organización de fotos del Daily Report, separado del
// resto del formulario. Arrastra una tarjeta sobre otra para reordenarlas
// (funciona con mouse y con el dedo en tablet/celular) o usa las flechas
// ‹ › si prefieres no arrastrar. El orden que quede acá es el mismo con el
// que las fotos se insertan en la hoja "Imágenes" del Excel al generarlo
// (ver generarExcelParteDiario.ts, que recorre parte.fotos en orden).
export const GestorFotos = ({ fotos, onChange }: GestorFotosProps) => {
  const gridRef = useRef<HTMLDivElement>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  // Dónde empezó el gesto actual, para distinguir un scroll de un arrastre.
  const origenRef = useRef<{ x: number; y: number; index: number; capturado: boolean } | null>(null)
  // Confirmación antes de quitar: la foto todavía no está subida a ninguna
  // parte, así que borrarla por error significa volver a caminar al punto.
  const [porQuitar, setPorQuitar] = useState<number | null>(null)

  const [comprimiendo, setComprimiendo] = useState(false)

  const agregarFotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    // Se comprimen acá, al elegirlas, y no al guardar: así el usuario ve la
    // vista previa de inmediato y la subida posterior mueve ~350 kB por foto
    // en vez de los 3-5 MB que salen de la cámara. Con doce fotos, eso es la
    // diferencia entre 48 MB y 4 MB por un enlace intermitente.
    setComprimiendo(true)
    try {
      const nuevas: FotoPendiente[] = await Promise.all(
        Array.from(files).map(async (file) => {
          const comprimido = await comprimirArchivo(file, FOTO_TERRENO)
          return {
            file: comprimido,
            caption: '',
            preview: URL.createObjectURL(comprimido),
          }
        })
      )
      onChange([...fotos, ...nuevas])
    } finally {
      setComprimiendo(false)
    }
  }

  const actualizarCaption = (index: number, caption: string) => {
    onChange(fotos.map((f, i) => (i === index ? { ...f, caption } : f)))
  }

  const quitar = (index: number) => onChange(fotos.filter((_, i) => i !== index))

  const mover = (index: number, destino: number) => {
    if (destino < 0 || destino >= fotos.length || destino === index) return
    const next = [...fotos]
    const [item] = next.splice(index, 1)
    next.splice(destino, 0, item)
    onChange(next)
  }

  const finalizarArrastre = () => {
    if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      mover(dragIndex, overIndex)
    }
    setDragIndex(null)
    setOverIndex(null)
    origenRef.current = null
  }

  // Al tocar solo se anota dónde empezó el gesto — todavía NO se arrastra.
  // Recién si el dedo se mueve más de UMBRAL_ARRASTRE píxeles se toma como
  // reordenamiento; si se mueve poco o se levanta, era un toque o un scroll
  // y la página se comporta con normalidad.
  const iniciarGesto = (e: React.PointerEvent, index: number) => {
    origenRef.current = { x: e.clientX, y: e.clientY, index, capturado: false }
  }

  // Snap por cercanía: mientras arrastras, la tarjeta que "gana" es la que
  // tiene el centro más cercano al dedo/cursor — no hace falta soltar
  // exactamente encima, el resto de la grilla (simétrica, tamaño fijo por
  // celda) se reacomoda sola alrededor de esa posición.
  const handlePointerMove = (e: React.PointerEvent) => {
    const origen = origenRef.current
    if (!origen) return

    if (dragIndex === null) {
      const recorrido = Math.hypot(e.clientX - origen.x, e.clientY - origen.y)
      if (recorrido < UMBRAL_ARRASTRE) return
      // Superado el umbral: ahora sí es un arrastre. Se captura el puntero
      // para seguir recibiendo eventos aunque el dedo salga de la tarjeta.
      e.currentTarget.setPointerCapture(e.pointerId)
      origen.capturado = true
      setDragIndex(origen.index)
    }

    if (!gridRef.current) return
    const tarjetas = gridRef.current.querySelectorAll<HTMLElement>('[data-foto-index]')
    let masCercano: number | null = null
    let distanciaMin = Infinity
    tarjetas.forEach((el) => {
      const rect = el.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const distancia = Math.hypot(e.clientX - cx, e.clientY - cy)
      if (distancia < distanciaMin) {
        distanciaMin = distancia
        masCercano = Number(el.dataset.fotoIndex)
      }
    })
    if (masCercano !== null) setOverIndex(masCercano)
  }

  return (
    <div>
      <label className="flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-2xl px-4 py-6 text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 cursor-pointer transition-colors">
        <span>{comprimiendo ? 'Preparando fotos…' : '📷 Toca para agregar fotos, o arrastra varias aquí'}</span>
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={comprimiendo}
          onChange={(e) => agregarFotos(e.target.files)}
          className="hidden"
        />
      </label>

      {fotos.length > 0 && (
        <>
          <p className="text-xs text-slate-500 mt-3 mb-2">
            {fotos.length} foto{fotos.length === 1 ? '' : 's'} — mantén y arrastra una tarjeta sobre otra para
            reordenar, o usa las flechas. Este es el orden con el que quedarán en el Excel.
          </p>

          <div ref={gridRef} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {fotos.map((foto, index) => {
              const arrastrandoEsta = dragIndex === index
              const objetivoArrastre = overIndex === index && dragIndex !== null && dragIndex !== index
              return (
                <div
                  key={foto.preview}
                  data-foto-index={index}
                  className={`group relative rounded-2xl border bg-white overflow-hidden shadow-sm transition-all duration-150
                    ${arrastrandoEsta ? 'opacity-40 scale-95 border-slate-200' : 'border-slate-200'}
                    ${objetivoArrastre ? 'ring-2 ring-blue-500 ring-offset-2 border-blue-300' : ''}
                  `}
                >
                  <span className="absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] font-semibold flex items-center justify-center">
                    {index + 1}
                  </span>
                  {/* 44x44 px reales: antes eran 20x20 y estaba a 6 px del
                      borde donde cae el pulgar al sostener el teléfono. */}
                  <button
                    type="button"
                    onClick={() => setPorQuitar(index)}
                    className="absolute top-1 right-1 z-10 w-11 h-11 rounded-full text-white text-lg leading-none flex items-center justify-center hover:bg-red-600/80 active:bg-red-600"
                    aria-label={`Quitar foto ${index + 1}`}
                  >
                    <span className="w-7 h-7 rounded-full bg-black/60 flex items-center justify-center">×</span>
                  </button>

                  {/* touch-pan-y (no touch-none): el scroll vertical con el
                      dedo sigue funcionando sobre la foto; el arrastre solo
                      se activa tras superar UMBRAL_ARRASTRE. */}
                  <div
                    className="aspect-square touch-pan-y cursor-grab active:cursor-grabbing"
                    onPointerDown={(e) => iniciarGesto(e, index)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={finalizarArrastre}
                    onPointerCancel={() => {
                      setDragIndex(null)
                      setOverIndex(null)
                      origenRef.current = null
                    }}
                  >
                    <img src={foto.preview} alt="" draggable={false} className="w-full h-full object-cover pointer-events-none" />
                  </div>

                  {porQuitar === index && (
                    <div className="absolute inset-0 z-20 bg-black/75 flex flex-col items-center justify-center gap-2 p-2">
                      <p className="text-white text-xs text-center">¿Quitar esta foto?</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setPorQuitar(null)}
                          className="px-3 py-2 text-xs font-semibold text-white bg-white/20 rounded-lg min-h-[36px]"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            quitar(index)
                            setPorQuitar(null)
                          }}
                          className="px-3 py-2 text-xs font-semibold text-white bg-red-600 rounded-lg min-h-[36px]"
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="p-2 space-y-1.5">
                    <input
                      type="text"
                      placeholder="Pie de foto"
                      value={foto.caption}
                      onChange={(e) => actualizarCaption(index, e.target.value)}
                      className="w-full text-xs px-2 py-1 border border-slate-200 rounded-lg"
                    />
                    {/* Estas flechas son la alternativa para quien no quiera
                        arrastrar, así que deben ser MÁS fáciles de tocar que
                        el arrastre, no menos: antes daban un objetivo de
                        ~8x16 px. Ahora ocupan la mitad del ancho cada una. */}
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        onClick={() => mover(index, index - 1)}
                        disabled={index === 0}
                        className="flex-1 min-h-[36px] text-base text-slate-500 bg-slate-50 rounded-lg hover:text-blue-600 hover:bg-blue-50 disabled:opacity-30 disabled:hover:text-slate-500 disabled:hover:bg-slate-50"
                        aria-label={`Mover la foto ${index + 1} antes`}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        onClick={() => mover(index, index + 1)}
                        disabled={index === fotos.length - 1}
                        className="flex-1 min-h-[36px] text-base text-slate-500 bg-slate-50 rounded-lg hover:text-blue-600 hover:bg-blue-50 disabled:opacity-30 disabled:hover:text-slate-500 disabled:hover:bg-slate-50"
                        aria-label={`Mover la foto ${index + 1} después`}
                      >
                        ›
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
