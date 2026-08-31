import type { ReactNode } from 'react'
import { useState } from 'react'
import { useMenuContextual, type ItemMenuContextual } from '../lib/useMenuContextual'
import { DialogoConfirmacion } from './DialogoConfirmacion'

export interface Columna<T> {
  clave: string
  titulo: string
  render: (fila: T) => ReactNode
  /** Alineación y ancho de la celda en la vista de escritorio. */
  className?: string
  /** No aparece en la tarjeta del celular (dato secundario). */
  soloEscritorio?: boolean
  /** Es el título de la tarjeta en celular. Debe haber exactamente uno. */
  principal?: boolean
}

/**
 * Una tabla en escritorio y tarjetas en celular, a partir de la misma definición
 * de columnas. Una tabla real en 375 px obliga a desplazar horizontalmente para
 * leer cada fila, que es justo lo que no se puede hacer con el teléfono en una
 * mano frente al estante.
 */
export function TablaCatalogo<T extends { id: string }>({
  columnas,
  filas,
  vacio,
  onFila,
  acciones,
  miniatura,
  onEliminar,
  etiquetaFila,
}: {
  columnas: Columna<T>[]
  filas: T[]
  vacio: ReactNode
  onFila?: (fila: T) => void
  acciones?: (fila: T) => ReactNode
  /**
   * Imagen que encabeza la fila: primera celda estrecha en escritorio, junto al
   * título en la tarjeta del celular. Va como prop y no como una columna más
   * porque en celular las columnas se dibujan en una lista de pares
   * etiqueta/valor, y una foto ahí no significa nada.
   */
  miniatura?: (fila: T) => ReactNode
  /** Clic derecho (o mantener presionado en celular) ofrece "Eliminar". */
  onEliminar?: (fila: T) => Promise<void>
  /** Texto que identifica la fila en el diálogo de confirmación. */
  etiquetaFila?: (fila: T) => string
}) {
  const [eliminando, setEliminando] = useState<T | null>(null)

  if (filas.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{vacio}</div>
  }

  const principal = columnas.find((c) => c.principal) ?? columnas[0]
  const secundarias = columnas.filter((c) => c !== principal)

  return (
    <>
      {/* Escritorio */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800 text-left text-white">
              {miniatura && <th className="w-14 px-4 py-2.5" />}
              {columnas.map((c) => (
                <th key={c.clave} className={`px-4 py-2.5 font-medium ${c.className ?? ''}`}>
                  {c.titulo}
                </th>
              ))}
              {acciones && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila, i) => (
              <FilaEscritorio
                key={fila.id}
                fila={fila}
                indice={i}
                columnas={columnas}
                onFila={onFila}
                acciones={acciones}
                miniatura={miniatura}
                onEliminar={onEliminar ? () => setEliminando(fila) : undefined}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Celular */}
      <ul className="space-y-2 md:hidden">
        {filas.map((fila) => (
          <TarjetaCelular
            key={fila.id}
            fila={fila}
            principal={principal}
            secundarias={secundarias}
            onFila={onFila}
            acciones={acciones}
            miniatura={miniatura}
            onEliminar={onEliminar ? () => setEliminando(fila) : undefined}
          />
        ))}
      </ul>

      {onEliminar && (
        <DialogoConfirmacion
          abierto={eliminando !== null}
          titulo="Eliminar"
          mensaje={
            eliminando &&
            `¿Eliminar ${etiquetaFila ? etiquetaFila(eliminando) : 'este registro'}? Esta acción no se puede deshacer.`
          }
          onCerrar={() => setEliminando(null)}
          onConfirmar={async () => {
            if (!eliminando) return
            await onEliminar(eliminando)
            setEliminando(null)
          }}
        />
      )}
    </>
  )
}

/** Un ítem si hay acción de eliminar, ninguno si no — el hook no abre nada con la lista vacía. */
function itemsEliminar(onEliminar?: () => void): ItemMenuContextual[] {
  return onEliminar ? [{ etiqueta: 'Eliminar', tono: 'peligro', onSeleccionar: onEliminar }] : []
}

function FilaEscritorio<T>({
  fila,
  indice,
  columnas,
  onFila,
  acciones,
  miniatura,
  onEliminar,
}: {
  fila: T
  indice: number
  columnas: Columna<T>[]
  onFila?: (fila: T) => void
  acciones?: (fila: T) => ReactNode
  miniatura?: (fila: T) => ReactNode
  onEliminar?: () => void
}) {
  const { manejadores, menu, debeIgnorarClic } = useMenuContextual(itemsEliminar(onEliminar))

  return (
    <>
      <tr
        onClick={
          onFila
            ? () => {
                if (!debeIgnorarClic()) onFila(fila)
              }
            : undefined
        }
        onContextMenu={manejadores.onContextMenu}
        onTouchStart={manejadores.onTouchStart}
        onTouchMove={manejadores.onTouchMove}
        onTouchEnd={manejadores.onTouchEnd}
        className={`border-t border-slate-100 ${indice % 2 === 1 ? 'bg-slate-50' : ''} ${
          onFila ? 'cursor-pointer hover:bg-blue-50' : ''
        }`}
      >
        {miniatura && <td className="py-1.5 pl-4 pr-0">{miniatura(fila)}</td>}
        {columnas.map((c) => (
          <td key={c.clave} className={`px-4 py-2.5 ${c.className ?? ''}`}>
            {c.render(fila)}
          </td>
        ))}
        {acciones && (
          <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
            {acciones(fila)}
          </td>
        )}
      </tr>
      {menu}
    </>
  )
}

function TarjetaCelular<T>({
  fila,
  principal,
  secundarias,
  onFila,
  acciones,
  miniatura,
  onEliminar,
}: {
  fila: T
  principal: Columna<T>
  secundarias: Columna<T>[]
  onFila?: (fila: T) => void
  acciones?: (fila: T) => ReactNode
  miniatura?: (fila: T) => ReactNode
  onEliminar?: () => void
}) {
  const { manejadores, menu, debeIgnorarClic } = useMenuContextual(itemsEliminar(onEliminar))

  return (
    <li>
      <div
        onClick={
          onFila
            ? () => {
                if (!debeIgnorarClic()) onFila(fila)
              }
            : undefined
        }
        onContextMenu={manejadores.onContextMenu}
        onTouchStart={manejadores.onTouchStart}
        onTouchMove={manejadores.onTouchMove}
        onTouchEnd={manejadores.onTouchEnd}
        className={`rounded-xl border border-slate-200 bg-white p-3 shadow-sm ${onFila ? 'active:bg-blue-50' : ''}`}
      >
        <div className="flex items-start justify-between gap-2">
          {miniatura && miniatura(fila)}
          <div className="min-w-0 flex-1 font-medium text-slate-800">{principal.render(fila)}</div>
          {acciones && <div onClick={(e) => e.stopPropagation()}>{acciones(fila)}</div>}
        </div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {secundarias
            .filter((c) => !c.soloEscritorio)
            .map((c) => (
              <div key={c.clave} className="contents">
                <dt className="text-slate-500">{c.titulo}</dt>
                <dd className="min-w-0 text-slate-700">{c.render(fila)}</dd>
              </div>
            ))}
        </dl>
      </div>
      {menu}
    </li>
  )
}
