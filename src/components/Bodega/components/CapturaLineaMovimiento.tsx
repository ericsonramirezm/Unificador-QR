import { useEffect, useRef, useState } from 'react'
import { Aviso, Boton, Campo, claseInput } from './Campo'
import { SelectorArticulo } from './SelectorArticulo'
import type { Articulo, FilaSerie, TipoArticulo } from '../tipos'

export interface LineaCapturada {
  clave: string
  articulo: Articulo
  cantidad: number
  /** Números de serie elegidos; vacío si el artículo no las controla. */
  series: string[]
}

/**
 * Captura de una línea para salidas, devoluciones, traslados y entregas de EPP.
 *
 * A diferencia de la recepción, aquí las series **no se teclean: se eligen** de
 * las que el sistema sabe que están donde deben estar. Escribirlas a mano
 * permitiría sacar una serie que ya salió, y aunque la base lo rechazaría, el
 * bodeguero se enteraría recién al guardar toda la salida.
 */
export function CapturaLineaMovimiento({
  cargarSeries,
  onAgregar,
  tipoArticulo,
  etiquetaCantidad = 'Cantidad',
}: {
  cargarSeries: (articuloId: string) => Promise<FilaSerie[]>
  onAgregar: (l: LineaCapturada) => void
  tipoArticulo?: TipoArticulo
  etiquetaCantidad?: string
}) {
  const [articulo, setArticulo] = useState<Articulo | null>(null)
  const [cantidad, setCantidad] = useState('')
  const [disponibles, setDisponibles] = useState<FilaSerie[]>([])
  const [elegidas, setElegidas] = useState<string[]>([])
  const [cargandoSeries, setCargandoSeries] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const cantidadRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!articulo?.controla_serie) {
      setDisponibles([])
      return
    }
    let vigente = true
    setCargandoSeries(true)
    cargarSeries(articulo.id)
      .then((s) => vigente && setDisponibles(s))
      .catch(() => vigente && setDisponibles([]))
      .finally(() => vigente && setCargandoSeries(false))
    return () => {
      vigente = false
    }
  }, [articulo, cargarSeries])

  function elegir(a: Articulo) {
    setArticulo(a)
    setCantidad('')
    setElegidas([])
    setAviso(null)
    setTimeout(() => cantidadRef.current?.focus(), 0)
  }

  function alternarSerie(numero: string) {
    setElegidas((e) => (e.includes(numero) ? e.filter((x) => x !== numero) : [...e, numero]))
  }

  // Con series, la cantidad la determina cuántas se marcaron: son el mismo dato
  // dicho dos veces, y dejar que se contradigan solo genera errores al guardar.
  const conSerie = Boolean(articulo?.controla_serie)
  const nCantidad = conSerie ? elegidas.length : Number(cantidad)

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!articulo) return
    if (!Number.isFinite(nCantidad) || nCantidad <= 0) {
      return setAviso(conSerie ? 'Marca al menos una serie.' : 'La cantidad debe ser mayor que cero.')
    }
    onAgregar({ clave: `${articulo.id}-${Date.now()}`, articulo, cantidad: nCantidad, series: elegidas })
    setArticulo(null)
    setCantidad('')
    setElegidas([])
    setAviso(null)
  }

  if (!articulo) {
    return <SelectorArticulo onElegir={elegir} tipo={tipoArticulo} autoFocus placeholder="Busca por código o descripción…" />
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <div className="flex items-baseline gap-3 rounded-lg bg-slate-50 px-3 py-2">
        <span className="font-mono text-sm">{articulo.codigo_defontana}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{articulo.descripcion}</span>
        <button type="button" onClick={() => setArticulo(null)} className="text-xs text-slate-500 hover:underline">
          Cambiar
        </button>
      </div>

      {conSerie ? (
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Elige las unidades ({elegidas.length} marcada{elegidas.length === 1 ? '' : 's'})
          </span>
          {cargandoSeries ? (
            <p className="text-sm text-slate-500">Buscando unidades disponibles…</p>
          ) : disponibles.length === 0 ? (
            <Aviso tono="info">
              No hay unidades de este artículo disponibles para mover desde aquí.
            </Aviso>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {disponibles.map((s) => (
                <li key={s.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={elegidas.includes(s.numero_serie)}
                      onChange={() => alternarSerie(s.numero_serie)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    <span className="font-mono text-xs">{s.numero_serie}</span>
                    <span className="text-xs text-slate-500">{s.ubicacion_actual}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <Campo etiqueta={`${etiquetaCantidad} (${articulo.unidad})`} htmlFor="cantidad" requerido>
          <input
            id="cantidad"
            ref={cantidadRef}
            type="number"
            step="0.001"
            min="0"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            className={claseInput}
          />
        </Campo>
      )}

      {aviso && <Aviso tono="info">{aviso}</Aviso>}

      <div className="flex justify-end gap-2">
        <Boton type="button" variante="secundario" onClick={() => setArticulo(null)}>
          Cancelar
        </Boton>
        <Boton type="submit" disabled={nCantidad <= 0}>
          Agregar línea
        </Boton>
      </div>
    </form>
  )
}

/** Tabla de las líneas ya capturadas, común a todas las pantallas de movimiento. */
export function TablaLineas({ lineas, onQuitar }: { lineas: LineaCapturada[]; onQuitar: (clave: string) => void }) {
  if (lineas.length === 0) return null
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-800 text-left text-white">
            <th className="px-3 py-2 font-medium">Código</th>
            <th className="px-3 py-2 font-medium">Descripción</th>
            <th className="px-3 py-2 text-right font-medium">Cantidad</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <tr key={l.clave} className={`border-t border-slate-100 ${i % 2 === 1 ? 'bg-slate-50' : ''}`}>
              <td className="px-3 py-2 font-mono text-xs">{l.articulo.codigo_defontana}</td>
              <td className="px-3 py-2">
                {l.articulo.descripcion}
                {l.series.length > 0 && (
                  <span className="ml-2 text-xs text-slate-500">series: {l.series.join(', ')}</span>
                )}
              </td>
              <td className="px-3 py-2 text-right font-medium">
                {l.cantidad} {l.articulo.unidad}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  onClick={() => onQuitar(l.clave)}
                  className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  aria-label={`Quitar ${l.articulo.codigo_defontana}`}
                >
                  Quitar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
