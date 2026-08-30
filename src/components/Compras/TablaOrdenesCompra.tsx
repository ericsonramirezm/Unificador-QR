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
}

const NUM_COLUMNAS = 17

// Última etapa: mismas columnas que SC y RQ. Código Defontana/RQ/Fecha RQ
// ya vienen heredados de la pestaña RQ (solo lectura acá); Proveedor, OC y
// Fecha OC son los propios de esta etapa y se completan acá.
//
// Se agrupa por OC, mismo criterio que RQ: el campo OC solo guarda al
// presionar "Guardar" (no al perder el foco), para que la fila no salte de
// grupo mientras se está escribiendo el número. Las filas sin OC todavía
// quedan juntas en "Sin N° OC", al final.
export const TablaOrdenesCompra = ({ items, cargando, onDevolver, onGuardarCampo }: TablaOrdenesCompraProps) => {
  const [procesando, setProcesando] = useState(false)

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
        <table className="w-full text-sm min-w-[1950px]">
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
              <th className="text-left py-2 px-2 w-36">Proveedor</th>
              <th className="text-left py-2 px-2 w-52">OC</th>
              <th className="text-left py-2 px-2 w-28">Fecha OC</th>
              <th className="w-16"></th>
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
                        <CeldaEditable
                          valor={item.oc_numero ?? ''}
                          onGuardar={(v) => onGuardarCampo(item.id, 'oc_numero', v)}
                          confirmarConBoton
                        />
                      </td>
                      <td className="py-2 px-2">
                        <CeldaEditable
                          tipo="date"
                          valor={item.fecha_oc ? item.fecha_oc.slice(0, 10) : ''}
                          onGuardar={(v) => onGuardarCampo(item.id, 'fecha_oc', v)}
                        />
                      </td>
                      <td className="py-2 px-2 text-right">
                        <button
                          type="button"
                          onClick={() => devolver(item.id, item.codigo_sc, item.numero_item)}
                          disabled={procesando}
                          className="text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-60"
                        >
                          ← RQ
                        </button>
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
        Proveedor y Fecha OC se guardan solos al salir del campo. OC necesita presionar "Guardar" (o Enter).
      </p>
    </div>
  )
}
