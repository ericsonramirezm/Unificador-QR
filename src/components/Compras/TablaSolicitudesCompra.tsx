import { useState } from 'react'
import { SolicitudCompra } from '@/types/index'
import { formatearFechaCorta } from '@lib/formato'

interface TablaSolicitudesCompraProps {
  items: SolicitudCompra[]
  cargando: boolean
  /** Avanza uno o varios ítems a Requisiciones (checkbox o botón por fila). */
  onAvanzar: (ids: string[]) => Promise<void>
}

export const TablaSolicitudesCompra = ({ items, cargando, onAvanzar }: TablaSolicitudesCompraProps) => {
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [avanzando, setAvanzando] = useState(false)

  const alternarFila = (id: string) => {
    setSeleccion((prev) => {
      const copia = new Set(prev)
      if (copia.has(id)) copia.delete(id)
      else copia.add(id)
      return copia
    })
  }

  const alternarTodas = () => {
    setSeleccion((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))))
  }

  const avanzarSeleccion = async () => {
    if (seleccion.size === 0) return
    setAvanzando(true)
    try {
      await onAvanzar(Array.from(seleccion))
      setSeleccion(new Set())
    } finally {
      setAvanzando(false)
    }
  }

  const avanzarUna = async (id: string) => {
    setAvanzando(true)
    try {
      await onAvanzar([id])
      setSeleccion((prev) => {
        const copia = new Set(prev)
        copia.delete(id)
        return copia
      })
    } finally {
      setAvanzando(false)
    }
  }

  if (cargando) {
    return <p className="text-sm text-slate-500 py-8 text-center">Cargando…</p>
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-500 py-8 text-center">
        No hay Solicitudes de Compra pendientes. Crea una con "Nueva Solicitud de Compra".
      </p>
    )
  }

  return (
    <div>
      {seleccion.size > 0 && (
        <div className="flex items-center justify-between gap-3 mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm text-blue-800">
            {seleccion.size} seleccionado{seleccion.size === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            onClick={avanzarSeleccion}
            disabled={avanzando}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60"
          >
            Pasar a RQ →
          </button>
        </div>
      )}

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="py-2 px-2 w-8">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todas"
                  checked={seleccion.size === items.length}
                  onChange={alternarTodas}
                />
              </th>
              <th className="text-left py-2 px-2 w-10">N°</th>
              <th className="text-left py-2 px-2 w-24">Código SC</th>
              <th className="text-left py-2 px-2 w-32">Solicitado por</th>
              <th className="text-left py-2 px-2 w-24">Fecha</th>
              <th className="text-left py-2 px-2 w-24">Documento</th>
              <th className="text-left py-2 px-2">Descripción</th>
              <th className="text-left py-2 px-2 w-24">Marca</th>
              <th className="text-left py-2 px-2 w-24">Modelo</th>
              <th className="text-right py-2 px-2 w-20">Cantidad</th>
              <th className="text-left py-2 px-2 w-20">Unidad</th>
              <th className="w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr key={item.id} className={seleccion.has(item.id) ? 'bg-blue-50/50' : undefined}>
                <td className="py-2 px-2">
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar ${item.codigo_sc} ítem ${item.numero_item}`}
                    checked={seleccion.has(item.id)}
                    onChange={() => alternarFila(item.id)}
                  />
                </td>
                <td className="py-2 px-2 text-slate-400 font-mono text-xs">{item.numero_item}</td>
                <td className="py-2 px-2 font-semibold text-slate-900">{item.codigo_sc}</td>
                <td className="py-2 px-2">{item.solicitado_por}</td>
                <td className="py-2 px-2 text-slate-500">{formatearFechaCorta(item.fecha_solicitud)}</td>
                <td className="py-2 px-2">
                  {item.documento_url ? (
                    <a
                      href={item.documento_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline text-xs"
                    >
                      Ver
                    </a>
                  ) : (
                    <span className="text-slate-300 text-xs">—</span>
                  )}
                </td>
                <td className="py-2 px-2">{item.descripcion}</td>
                <td className="py-2 px-2">{item.marca || '—'}</td>
                <td className="py-2 px-2">{item.modelo || '—'}</td>
                <td className="py-2 px-2 text-right">{item.cantidad}</td>
                <td className="py-2 px-2">{item.unidad || '—'}</td>
                <td className="py-2 px-2 text-right">
                  <button
                    type="button"
                    onClick={() => avanzarUna(item.id)}
                    disabled={avanzando}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-60"
                  >
                    RQ →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
