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
}

const NUM_COLUMNAS = 18

// Mismas columnas que TablaSolicitudesCompra y TablaOrdenesCompra, mismo
// orden. Acá Código Defontana/RQ/Fecha RQ ya se pueden completar (son
// propios de esta etapa); Proveedor/OC/Fecha OC siguen en blanco porque el
// ítem todavía no llegó a Órdenes de Compra.
//
// Las filas se agrupan por RQ (así varios ítems con el mismo N° de
// Requisición quedan juntos, con banda de fondo alternada). El campo RQ
// solo guarda al presionar "Guardar" (no al perder el foco): si guardara
// en cada tecleo, la fila saltaría de grupo mientras la persona todavía
// está escribiendo el número. Las filas sin RQ todavía quedan en su propio
// grupo, "Sin N° RQ", al final.
export const TablaRequisiciones = ({ items, cargando, onAvanzar, onDevolver, onGuardarCampo }: TablaRequisicionesProps) => {
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [procesando, setProcesando] = useState(false)

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
        <table className="w-full text-sm min-w-[1950px]">
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
              <th className="text-left py-2 px-2 w-52">RQ</th>
              <th className="text-left py-2 px-2 w-28">Fecha RQ</th>
              <th className="text-left py-2 px-2 w-36">Proveedor</th>
              <th className="text-left py-2 px-2 w-24">OC</th>
              <th className="text-left py-2 px-2 w-24">Fecha OC</th>
              <th className="w-32"></th>
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
                        <CeldaEditable
                          valor={item.rq_numero ?? ''}
                          onGuardar={(v) => onGuardarCampo(item.id, 'rq_numero', v)}
                          confirmarConBoton
                        />
                      </td>
                      <td className="py-2 px-2">
                        <CeldaEditable
                          tipo="date"
                          valor={item.fecha_rq ? item.fecha_rq.slice(0, 10) : ''}
                          onGuardar={(v) => onGuardarCampo(item.id, 'fecha_rq', v)}
                        />
                      </td>
                      <td className="py-2 px-2 text-slate-300">—</td>
                      <td className="py-2 px-2 text-slate-300">—</td>
                      <td className="py-2 px-2 text-slate-300">—</td>
                      <td className="py-2 px-2">
                        <div className="flex items-center justify-end gap-3">
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
        Código Defontana y Fecha RQ se guardan solas al salir del campo. RQ necesita presionar "Guardar" (o Enter) — así la fila no cambia de grupo mientras se está escribiendo el número.
      </p>
    </div>
  )
}
