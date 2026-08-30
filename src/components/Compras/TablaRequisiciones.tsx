import { Fragment, useState } from 'react'
import { Requisicion } from '@/types/index'
import { formatearFechaCorta } from '@lib/formato'
import { agruparPorNumero } from '@lib/agrupar'
import { CeldaEditable } from './CeldaEditable'

interface TablaRequisicionesProps {
  items: Requisicion[]
  cargando: boolean
  onAvanzar: (ids: string[]) => Promise<void>
  onDevolver: (id: string) => Promise<void>
  onGuardarCampo: (id: string, campo: 'rq_numero' | 'fecha_rq' | 'codigo_defontana', valor: string) => Promise<void>
  /** Elimina un ítem para siempre — no vuelve a Solicitudes de Compra (a diferencia de onDevolver). */
  onEliminar: (id: string) => Promise<void>
}

const NUM_COLUMNAS = 15

// Acá Código Defontana/RQ/Fecha RQ ya se pueden completar (son propios de
// esta etapa). Proveedor/OC/Fecha OC ya no se muestran en esta pestaña —
// esos campos son propios de Órdenes de Compra y el ítem todavía no llegó
// ahí.
//
// Las filas se agrupan por RQ (así varios ítems con el mismo N° de
// Requisición quedan juntos, con banda de fondo alternada). El campo RQ
// solo guarda al presionar "Guardar" (no al perder el foco): si guardara
// en cada tecleo, la fila saltaría de grupo mientras la persona todavía
// está escribiendo el número. Por eso el botón "Guardar" vive en la
// columna de acciones (entre Fecha RQ y los botones de avance/devolución),
// no pegado al input. Las filas sin RQ todavía quedan en su propio grupo,
// "Sin N° RQ", al final.
export const TablaRequisiciones = ({ items, cargando, onAvanzar, onDevolver, onGuardarCampo, onEliminar }: TablaRequisicionesProps) => {
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [procesando, setProcesando] = useState(false)

  // Valor del campo RQ mientras se edita, guardado acá (no en un
  // CeldaEditable) porque el botón "Guardar" ahora vive en la columna de
  // acciones, separado del input — así se puede mostrar entre la Fecha RQ
  // y los botones de avance/devolución, en vez de pegado al campo.
  const [rqPendiente, setRqPendiente] = useState<Record<string, string>>({})
  const [guardandoRQ, setGuardandoRQ] = useState<Record<string, boolean>>({})
  const [errorRQ, setErrorRQ] = useState<Record<string, string>>({})

  const valorRQActual = (item: Requisicion) => rqPendiente[item.id] ?? item.rq_numero ?? ''
  const huboCambioRQ = (item: Requisicion) => item.id in rqPendiente && rqPendiente[item.id] !== (item.rq_numero ?? '')

  const guardarRQ = async (item: Requisicion) => {
    if (!huboCambioRQ(item)) return
    setGuardandoRQ((prev) => ({ ...prev, [item.id]: true }))
    setErrorRQ((prev) => ({ ...prev, [item.id]: '' }))
    try {
      await onGuardarCampo(item.id, 'rq_numero', rqPendiente[item.id])
      setRqPendiente((prev) => {
        const copia = { ...prev }
        delete copia[item.id]
        return copia
      })
    } catch {
      setErrorRQ((prev) => ({ ...prev, [item.id]: 'No se guardó' }))
    } finally {
      setGuardandoRQ((prev) => ({ ...prev, [item.id]: false }))
    }
  }

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
    setProcesando(true)
    try {
      await onAvanzar(Array.from(seleccion))
      setSeleccion(new Set())
    } finally {
      setProcesando(false)
    }
  }

  const avanzarUna = async (id: string) => {
    setProcesando(true)
    try {
      await onAvanzar([id])
    } finally {
      setProcesando(false)
    }
  }

  const devolver = async (id: string, codigoSc: string, numeroItem: number) => {
    const ok = window.confirm(
      `¿Devolver el ítem ${numeroItem} de ${codigoSc} a Solicitudes de Compra? Esta requisición se elimina (el ítem vuelve a aparecer en SC).`
    )
    if (!ok) return
    setProcesando(true)
    try {
      await onDevolver(id)
    } finally {
      setProcesando(false)
    }
  }

  // Distinto de "Devolver": esto borra el ítem para siempre, no lo hace
  // volver a ninguna etapa anterior.
  const eliminar = async (id: string, codigoSc: string, numeroItem: number) => {
    const ok = window.confirm(
      `¿Eliminar para siempre el ítem ${numeroItem} de ${codigoSc}? Esta acción no se puede deshacer: el ítem NO vuelve a Solicitudes de Compra, se borra por completo.`
    )
    if (!ok) return
    setProcesando(true)
    try {
      await onEliminar(id)
    } finally {
      setProcesando(false)
    }
  }

  if (cargando) {
    return <p className="text-sm text-slate-500 py-8 text-center">Cargando…</p>
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-500 py-8 text-center">
        No hay Requisiciones pendientes. Avanza ítems desde la pestaña Solicitudes de Compra.
      </p>
    )
  }

  const grupos = agruparPorNumero(items, (item) => item.rq_numero, 'Sin N° RQ')

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
            disabled={procesando}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60"
          >
            Pasar a OC →
          </button>
        </div>
      )}

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-sm min-w-[1750px]">
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
              <th className="text-left py-2 px-2 w-32">Solicitado por</th>
              <th className="text-left py-2 px-2 w-10">N°</th>
              <th className="text-left py-2 px-2 w-28">Código Defontana</th>
              <th className="text-left py-2 px-2">Descripción</th>
              <th className="text-left py-2 px-2 w-24">Marca</th>
              <th className="text-left py-2 px-2 w-24">Modelo</th>
              <th className="text-right py-2 px-2 w-20">Cantidad</th>
              <th className="text-left py-2 px-2 w-20">Unidad</th>
              <th className="text-left py-2 px-2 w-24">Solicitud de Compra</th>
              <th className="text-left py-2 px-2 w-24">Fecha de Solicitud</th>
              <th className="text-left py-2 px-2 w-20">Documento</th>
              <th className="text-left py-2 px-2 w-40">RQ</th>
              <th className="text-left py-2 px-2 w-28">Fecha RQ</th>
              <th className="w-64"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {grupos.map((grupo, indiceGrupo) => {
              const banda = indiceGrupo % 2 === 1
              return (
                <Fragment key={grupo.clave}>
                  <tr className={banda ? 'bg-slate-100/70' : 'bg-slate-50/70'}>
                    <td
                      colSpan={NUM_COLUMNAS}
                      className={`px-2 py-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wide ${
                        indiceGrupo > 0 ? 'border-t-2 border-slate-300' : ''
                      }`}
                    >
                      {grupo.etiqueta} · {grupo.filas.length} ítem{grupo.filas.length === 1 ? '' : 's'}
                    </td>
                  </tr>
                  {grupo.filas.map((item) => (
                    <tr key={item.id} className={seleccion.has(item.id) ? 'bg-blue-50/50' : banda ? 'bg-slate-50/40' : undefined}>
                      <td className="py-2 px-2">
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${item.codigo_sc} ítem ${item.numero_item}`}
                          checked={seleccion.has(item.id)}
                          onChange={() => alternarFila(item.id)}
                        />
                      </td>
                      <td className="py-2 px-2">{item.solicitado_por}</td>
                      <td className="py-2 px-2 text-slate-400 font-mono text-xs">{item.numero_item}</td>
                      <td className="py-2 px-2">
                        <CeldaEditable
                          valor={item.codigo_defontana ?? ''}
                          onGuardar={(v) => onGuardarCampo(item.id, 'codigo_defontana', v)}
                        />
                      </td>
                      <td className="py-2 px-2">{item.descripcion}</td>
                      <td className="py-2 px-2">{item.marca || '—'}</td>
                      <td className="py-2 px-2">{item.modelo || '—'}</td>
                      <td className="py-2 px-2 text-right">{item.cantidad}</td>
                      <td className="py-2 px-2">{item.unidad || '—'}</td>
                      <td className="py-2 px-2 font-semibold text-slate-900">{item.codigo_sc}</td>
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
                      <td className="py-2 px-2">
                        <div className="relative">
                          <input
                            type="text"
                            value={valorRQActual(item)}
                            placeholder="por llenar"
                            onChange={(e) => setRqPendiente((prev) => ({ ...prev, [item.id]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') guardarRQ(item)
                            }}
                            disabled={!!guardandoRQ[item.id]}
                            className="w-full px-2 py-1 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 disabled:bg-slate-50"
                          />
                          {errorRQ[item.id] && (
                            <p className="absolute top-full left-0 text-[11px] text-red-600 mt-0.5 whitespace-nowrap">
                              {errorRQ[item.id]}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        <CeldaEditable
                          tipo="date"
                          valor={item.fecha_rq ? item.fecha_rq.slice(0, 10) : ''}
                          onGuardar={(v) => onGuardarCampo(item.id, 'fecha_rq', v)}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => guardarRQ(item)}
                            disabled={!huboCambioRQ(item) || !!guardandoRQ[item.id]}
                            className="shrink-0 px-2 py-1 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {guardandoRQ[item.id] ? '…' : 'Guardar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => devolver(item.id, item.codigo_sc, item.numero_item)}
                            disabled={procesando}
                            className="text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-60"
                          >
                            ← SC
                          </button>
                          <button
                            type="button"
                            onClick={() => avanzarUna(item.id)}
                            disabled={procesando}
                            className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-60"
                          >
                            OC →
                          </button>
                          <button
                            type="button"
                            onClick={() => eliminar(item.id, item.codigo_sc, item.numero_item)}
                            disabled={procesando}
                            className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-60"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 mt-2">
        Código Defontana y Fecha RQ se guardan solas al salir del campo. El número de RQ necesita presionar "Guardar" (o Enter) — así la fila no cambia de grupo mientras se está escribiendo el número.
      </p>
    </div>
  )
}
