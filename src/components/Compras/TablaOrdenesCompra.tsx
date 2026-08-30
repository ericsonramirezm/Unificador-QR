import { useState } from 'react'
import { OrdenCompra } from '@/types/index'
import { formatearFechaCorta } from '@lib/formato'
import { CeldaEditable } from './CeldaEditable'

interface TablaOrdenesCompraProps {
  items: OrdenCompra[]
  cargando: boolean
  onDevolver: (id: string) => Promise<void>
  onGuardarCampo: (id: string, valor: string) => Promise<void>
}

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

  return (
    <div className="overflow-x-auto border border-slate-200 rounded-lg">
      <table className="w-full text-sm min-w-[1200px]">
        <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
          <tr>
            <th className="text-left py-2 px-2 w-24">OC</th>
            <th className="text-left py-2 px-2 w-24">RQ N°</th>
            <th className="text-left py-2 px-2 w-24">Fecha de RQ</th>
            <th className="text-left py-2 px-2 w-28">Cód. Defontana</th>
            <th className="text-left py-2 px-2 w-24">Solicitud de Compra</th>
            <th className="text-left py-2 px-2 w-32">Solicitado por</th>
            <th className="text-left py-2 px-2 w-10">N°</th>
            <th className="text-left py-2 px-2">Descripción</th>
            <th className="text-left py-2 px-2 w-24">Marca</th>
            <th className="text-left py-2 px-2 w-24">Modelo</th>
            <th className="text-right py-2 px-2 w-20">Cantidad</th>
            <th className="text-left py-2 px-2 w-20">Unidad</th>
            <th className="w-16"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item) => (
            <tr key={item.id}>
              <td className="py-2 px-2">
                <CeldaEditable valor={item.oc_numero ?? ''} onGuardar={(v) => onGuardarCampo(item.id, v)} />
              </td>
              <td className="py-2 px-2 text-slate-500">{item.rq_numero || '—'}</td>
              <td className="py-2 px-2 text-slate-500">{formatearFechaCorta(item.fecha_rq)}</td>
              <td className="py-2 px-2 text-slate-500">{item.codigo_defontana || '—'}</td>
              <td className="py-2 px-2 font-semibold text-slate-900">{item.codigo_sc}</td>
              <td className="py-2 px-2">{item.solicitado_por}</td>
              <td className="py-2 px-2 text-slate-400 font-mono text-xs">{item.numero_item}</td>
              <td className="py-2 px-2">{item.descripcion}</td>
              <td className="py-2 px-2">{item.marca || '—'}</td>
              <td className="py-2 px-2">{item.modelo || '—'}</td>
              <td className="py-2 px-2 text-right">{item.cantidad}</td>
              <td className="py-2 px-2">{item.unidad || '—'}</td>
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
        </tbody>
      </table>
    </div>
  )
}
