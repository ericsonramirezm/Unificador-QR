import { useRef, useState } from 'react'

export interface FotoPendiente {
  file: File
  caption: string
  preview: string
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

  const agregarFotos = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const nuevas: FotoPendiente[] = Array.from(files).map((file) => ({
      file,
      caption: '',
      preview: URL.createObjectURL(file),
    }))
    onChange([...fotos, ...nuevas])
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
  }

  // Snap por cercanía: mientras arrastras, la tarjeta que "gana" es la que
  // tiene el centro más cercano al dedo/cursor — no hace falta soltar
  // exactamente encima, el resto de la grilla (simétrica, tamaño fijo por
  // celda) se reacomoda sola alrededor de esa posición.
  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragIndex === null || !gridRef.current) return
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
        <span>📷 Toca para agregar fotos, o arrastra varias aquí</span>
        <input type="file" accept="image/*" multiple onChange={(e) => agregarFotos(e.target.files)} className="hidden" />
      </label>

      {fotos.length > 0 && (
        <>
          <p className="text-xs text-slate-400 mt-3 mb-2">
            {fotos.length} foto{fotos.length === 1 ? '' : 's'} — arrastra una tarjeta sobre otra para reordenar. Este es el orden con el que quedarán en el Excel.
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
                  <button
                    type="button"
                    onClick={() => quitar(index)}
                    className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full bg-black/60 text-white text-xs leading-none flex items-center justify-center hover:bg-red-600"
                    aria-label="Quitar foto"
                  >
                    ×
                  </button>

                  <div
                    className="aspect-square touch-none cursor-grab active:cursor-grabbing"
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId)
                      setDragIndex(index)
                    }}
                    onPointerMove={handlePointerMove}
                    onPointerUp={finalizarArrastre}
                    onPointerCancel={() => {
                      setDragIndex(null)
                      setOverIndex(null)
                    }}
                  >
                    <img src={foto.preview} alt="" draggable={false} className="w-full h-full object-cover pointer-events-none" />
                  </div>

                  <div className="p-2 space-y-1.5">
                    <input
                      type="text"
                      placeholder="Pie de foto"
                      value={foto.caption}
                      onChange={(e) => actualizarCaption(index, e.target.value)}
                      className="w-full text-xs px-2 py-1 border border-slate-200 rounded-lg"
                    />
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => mover(index, index - 1)}
                        disabled={index === 0}
                        className="text-xs text-slate-400 hover:text-blue-600 disabled:opacity-30 disabled:hover:text-slate-400 px-1"
                        aria-label="Mover antes"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        onClick={() => mover(index, index + 1)}
                        disabled={index === fotos.length - 1}
                        className="text-xs text-slate-400 hover:text-blue-600 disabled:opacity-30 disabled:hover:text-slate-400 px-1"
                        aria-label="Mover después"
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
