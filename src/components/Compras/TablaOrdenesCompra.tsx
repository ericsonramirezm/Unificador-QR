import { Fragment, useState } from 'react'
import { OrdenCompra } from '@/types/index'
import { formatearFechaCorta } from '@lib/formato'
import { agruparPorNumero } from '@lib/agrupar'
import { CeldaEditable } from './CeldaEditable'

interface TablaOrdenesCompraProps {
  items: OrdenCompra[]
  cargando: boolean
  onDevolver: (id: string) => Promise<void>
  onGuardarCampo: (id: string, campo: 'oc_numero' | 'proveedor' | 'fecha_oc', valor: string) => Promise<void>
  /** Elimina un ítem para siempre — no vuelve a Requisiciones (a diferencia de onDevolver). */
  onEliminar: (id: string) => Promise<void>
}

const NUM_COLUMNAS = 17

// Última etapa: mismas columnas que SC y RQ. Código Defontana/RQ/Fecha RQ
// ya vienen heredados de la pestaña RQ (solo lectura acá); Proveedor, OC y
// Fecha OC son los propios de esta etapa y se completan acá.
//
// Se agrupa por OC, mismo criterio que RQ: el campo OC solo guarda al
// presionar "Guardar" (no al perder el foco), para que la fila no salte de
// grupo mientras se está escribiendo el número. Por eso el botón "Guardar"
// vive en la columna de acciones (entre Fecha OC y "← RQ"), no pegado al
// input. Las filas sin OC todavía quedan juntas en "Sin N° OC", al final.
export const TablaOrdenesCompra = ({ items, cargando, onDevolver, onGuardarCampo, onEliminar }: TablaOrdenesCompraProps) => {
  const [procesando, setProcesando] = useState(false)

  // Igual que RQ en TablaRequisiciones: el valor de OC se maneja acá (no
  // en un CeldaEditable) para poder mostrar el botón "Guardar" en la
  // columna de acciones en vez de pegado al input.
  const [ocPendiente, setOcPendiente] = useState<Record<string, string>>({})
  const [guardandoOC, setGuardandoOC] = useState<Record<string, boolean>>({})
  const [errorOC, setErrorOC] = useState<Record<string, string>>({})

  const valorOCActual = (item: OrdenCompra) => ocPendiente[item.id] ?? item.oc_numero ?? ''
  const huboCambioOC = (item: OrdenCompra) => item.id in ocPendiente && ocPendiente[item.id] !== (item.oc_numero ?? '')

  const guardarOC = async (item: OrdenCompra) => {
    if (!huboCambioOC(item)) return
    setGuardandoOC((prev) => ({ ...prev, [item.id]: true }))
    setErrorOC((prev) => ({ ...prev, [item.id]: '' }))
    try {
      await onGuardarCampo(item.id, 'oc_numero', ocPendiente[item.id])
      setOcPendiente((prev) => {
        const copia = { ...prev }
        delete copia[item.id]
        return copia
      })
    } catch {
      setErrorOC((prev) => ({ ...prev, [item.id]: 'No se guardó' }))
    } finally {
      setGuardandoOC((prev) => ({ ...prev, [item.id]: false }))
    }
  }

  const devolver = async (id: string, codigoSc: string, numeroItem: number) => {
    const ok = window.confirm(
      `¿Devolver el ítem ${numeroItem} de ${codigoSc} a Requisiciones? Esta orden de compra se elimina (el ítem vuelve a aparecer en RQ).`
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
      `¿Eliminar para siempre el ítem ${numeroItem} de ${codigoSc}? Esta acción no se puede deshacer: el ítem NO vuelve a Requisiciones, se borra por completo.`
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
        No hay Órdenes de Compra todavía. Avanza ítems desde la pestaña Requisiciones.
      </p>
    )
  }

  const grupos = agruparPorNumero(items, (item) => item.oc_numero, 'Sin N° OC')

  return (
    <div>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-sm min-w-[2530px]">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
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
              <th className="text-left py-2 px-2 w-24">RQ</th>
              <th className="text-left py-2 px-2 w-24">Fecha RQ</th>
              <th className="text-left py-2 px-2 w-[30rem]">Proveedor</th>
              <th className="text-left py-2 px-2 w-40">OC</th>
              <th className="text-left py-2 px-2 w-28">Fecha OC</th>
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
                    <tr key={item.id} className={banda ? 'bg-slate-50/40' : undefined}>
                      <td className="py-2 px-2">{item.solicitado_por}</td>
                      <td className="py-2 px-2 text-slate-400 font-mono text-xs">{item.numero_item}</td>
                      <td className="py-2 px-2 text-slate-500">{item.codigo_defontana || '—'}</td>
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
                      <td className="py-2 px-2 text-slate-500">{item.rq_numero || '—'}</td>
                      <td className="py-2 px-2 text-slate-500">{formatearFechaCorta(item.fecha_rq)}</td>
                      <td className="py-2 px-2">
                        <CeldaEditable
                          valor={item.proveedor ?? ''}
                          onGuardar={(v) => onGuardarCampo(item.id, 'proveedor', v)}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <div className="relative">
                          <input
                            type="text"
                            value={valorOCActual(item)}
                            placeholder="por llenar"
                            onChange={(e) => setOcPendiente((prev) => ({ ...prev, [item.id]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') guardarOC(item)
                            }}
                            disabled={!!guardandoOC[item.id]}
                            className="w-full px-2 py-1 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 disabled:bg-slate-50"
                          />
                          {errorOC[item.id] && (
                            <p className="absolute top-full left-0 text-[11px] text-red-600 mt-0.5 whitespace-nowrap">
                              {errorOC[item.id]}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        <CeldaEditable
                          tipo="date"
                          valor={item.fecha_oc ? item.fecha_oc.slice(0, 10) : ''}
                          onGuardar={(v) => onGuardarCampo(item.id, 'fecha_oc', v)}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => guardarOC(item)}
                            disabled={!huboCambioOC(item) || !!guardandoOC[item.id]}
                            className="shrink-0 px-2 py-1 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {guardandoOC[item.id] ? '…' : 'Guardar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => devolver(item.id, item.codigo_sc, item.numero_item)}
                            disabled={procesando}
                            className="text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-60"
                          >
                            ← RQ
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
        Proveedor y Fecha OC se guardan solos al salir del campo. El número de OC necesita presionar "Guardar" (o Enter).
      </p>
    </div>
  )
}
