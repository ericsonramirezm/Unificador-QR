import { Fragment, useState } from 'react'
import { OrdenCompra } from '@/types/index'
import { formatearFechaCorta } from '@lib/formato'
import { agruparPorNumero, agruparPorProveedor } from '@lib/agrupar'
import { CeldaEditable } from './CeldaEditable'

interface TablaOrdenesCompraProps {
  items: OrdenCompra[]
  cargando: boolean
  /** Texto del buscador general (Compras.tsx) — items ya llega pre-filtrado; esto es solo para el mensaje de estado vacío. */
  busqueda?: string
  onAvanzar: (ids: string[]) => Promise<void>
  onDevolver: (id: string) => Promise<void>
  onGuardarCampo: (id: string, campo: 'oc_numero' | 'proveedor' | 'fecha_oc', valor: string) => Promise<void>
  /** Elimina un ítem para siempre — no vuelve a Requisiciones (a diferencia de onDevolver). */
  onEliminar: (id: string) => Promise<void>
}

const NUM_COLUMNAS = 18

// Mismas columnas que SC y RQ. Código Defontana/RQ/Fecha RQ ya vienen
// heredados de la pestaña RQ (solo lectura acá); Proveedor, OC y Fecha OC
// son los propios de esta etapa y se completan acá. Desde acá se avanza a
// Guías de Despacho (última etapa definida por ahora).
//
// Se agrupa por OC, mismo criterio que RQ: el campo OC solo guarda al
// presionar "Guardar" (no al perder el foco), para que la fila no salte de
// grupo mientras se está escribiendo el número. Por eso el botón "Guardar"
// vive en la columna de acciones (entre Fecha OC y "← RQ"), no pegado al
// input. Las filas sin OC todavía quedan juntas en "Sin N° OC", al final.
//
// Dentro de cada grupo de OC, si los ítems terminaron con Proveedor
// distinto (una misma OC en la práctica debería ir a un solo proveedor),
// se subagrupan por Proveedor con un mini-encabezado liviano — así se nota
// a simple vista que esa OC mezcla proveedores y conviene revisar si
// debería separarse. Si todos comparten el mismo proveedor (el caso
// normal), no se muestra ningún mini-encabezado.
// Columnas fijas al desplazar horizontalmente: Checkbox, Solicitado por, N°,
// Código Defontana y también Descripción (a diferencia de RQ, que la deja
// scrolleable). Los primeros cuatro offsets son los mismos que en
// TablaRequisiciones.tsx (anchos w-8/w-32/w-10/w-28 idénticos); Descripción
// no tenía ancho fijo antes (crecía con el contenido) — una celda sticky no
// puede depender de "lo que ocupe el contenido", así que gana w-64. Ver el
// comentario junto a STICKY en TablaRequisiciones.tsx para el porqué del
// fondo opaco explícito en vez de heredado del <tr>.
const STICKY = 'sticky z-10'
const IZQ_CHECKBOX = 'left-0'
const IZQ_SOLICITADO = 'left-[32px]'
const IZQ_NUMERO = 'left-[160px]'
const IZQ_DEFONTANA = 'left-[200px]'
const IZQ_DESCRIPCION = 'left-[312px] border-r-2 border-slate-300'

export const TablaOrdenesCompra = ({ items, cargando, busqueda, onAvanzar, onDevolver, onGuardarCampo, onEliminar }: TablaOrdenesCompraProps) => {
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
        {busqueda?.trim() ? (
          <>No hay resultados para "{busqueda}".</>
        ) : (
          <>No hay Órdenes de Compra todavía. Avanza ítems desde la pestaña Requisiciones.</>
        )}
      </p>
    )
  }

  const grupos = agruparPorNumero(items, (item) => item.oc_numero, 'Sin N° OC')

  const renderFila = (item: OrdenCompra, banda: boolean) => {
    const claseFondo = seleccion.has(item.id) ? 'bg-blue-50/50' : banda ? 'bg-slate-50/40' : undefined
    // Mismo color que `claseFondo`, sin transparencia — ver comentario junto
    // a STICKY más arriba.
    const claseFondoSticky = seleccion.has(item.id) ? 'bg-blue-50' : banda ? 'bg-slate-50' : 'bg-white'
    return (
    <tr key={item.id} className={claseFondo}>
      <td className={`py-2 px-2 ${STICKY} ${IZQ_CHECKBOX} ${claseFondoSticky}`}>
        <input
          type="checkbox"
          aria-label={`Seleccionar ${item.codigo_sc} ítem ${item.numero_item}`}
          checked={seleccion.has(item.id)}
          onChange={() => alternarFila(item.id)}
        />
      </td>
      <td className={`py-2 px-2 ${STICKY} ${IZQ_SOLICITADO} ${claseFondoSticky}`}>{item.solicitado_por}</td>
      <td className={`py-2 px-2 text-slate-400 font-mono text-xs ${STICKY} ${IZQ_NUMERO} ${claseFondoSticky}`}>
        {item.numero_item}
      </td>
      <td className={`py-2 px-2 text-slate-500 ${STICKY} ${IZQ_DEFONTANA} ${claseFondoSticky}`}>
        {item.codigo_defontana || '—'}
      </td>
      <td className={`py-2 px-2 w-64 ${STICKY} ${IZQ_DESCRIPCION} ${claseFondoSticky}`}>{item.descripcion}</td>
      <td className="py-2 px-2">{item.marca || '—'}</td>
      <td className="py-2 px-2">{item.modelo || '—'}</td>
      <td className="py-2 px-2 text-right">{item.cantidad}</td>
      <td className="py-2 px-2">{item.unidad || '—'}</td>
      <td className="py-2 px-2 font-semibold text-slate-900">{item.codigo_sc}</td>
      <td className="py-2 px-2 text-slate-500">{formatearFechaCorta(item.fecha_solicitud)}</td>
      <td className="py-2 px-2">
        {item.documento_url ? (
          <a href={item.documento_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs">
            Ver
          </a>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </td>
      <td className="py-2 px-2 text-slate-500">{item.rq_numero || '—'}</td>
      <td className="py-2 px-2 text-slate-500">{formatearFechaCorta(item.fecha_rq)}</td>
      <td className="py-2 px-2">
        <CeldaEditable valor={item.proveedor ?? ''} onGuardar={(v) => onGuardarCampo(item.id, 'proveedor', v)} />
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
            <p className="absolute top-full left-0 text-[11px] text-red-600 mt-0.5 whitespace-nowrap">{errorOC[item.id]}</p>
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
            onClick={() => avanzarUna(item.id)}
            disabled={procesando}
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-60"
          >
            GD →
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
            disabled={procesando}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60"
          >
            Pasar a Guías de Despacho →
          </button>
        </div>
      )}

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-sm min-w-[2600px]">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className={`py-2 px-2 w-8 bg-slate-50 ${STICKY} ${IZQ_CHECKBOX}`}>
                <input
                  type="checkbox"
                  aria-label="Seleccionar todas"
                  checked={seleccion.size === items.length}
                  onChange={alternarTodas}
                />
              </th>
              <th className={`text-left py-2 px-2 w-32 bg-slate-50 ${STICKY} ${IZQ_SOLICITADO}`}>Solicitado por</th>
              <th className={`text-left py-2 px-2 w-10 bg-slate-50 ${STICKY} ${IZQ_NUMERO}`}>N°</th>
              <th className={`text-left py-2 px-2 w-28 bg-slate-50 ${STICKY} ${IZQ_DEFONTANA}`}>Código Defontana</th>
              <th className={`text-left py-2 px-2 w-64 bg-slate-50 ${STICKY} ${IZQ_DESCRIPCION}`}>Descripción</th>
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
              // Solo tiene sentido subagrupar si el grupo trae más de un
              // proveedor distinto; si todos comparten uno (o todos están
              // en blanco), agruparPorProveedor devuelve un único grupo y
              // se renderiza plano, sin mini-encabezado.
              const subgrupos = agruparPorProveedor(grupo.filas, (item) => item.proveedor)
              const hayVariosProveedores = subgrupos.length > 1

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
                      {hayVariosProveedores && (
                        <span className="ml-2 normal-case font-normal text-amber-600">
                          — con más de un proveedor, revisa si conviene separar esta OC
                        </span>
                      )}
                    </td>
                  </tr>
                  {hayVariosProveedores
                    ? subgrupos.map((subgrupo, indiceSub) => (
                        <Fragment key={subgrupo.clave}>
                          <tr className={banda ? 'bg-slate-100/40' : 'bg-slate-50/40'}>
                            <td
                              colSpan={NUM_COLUMNAS}
                              className={`px-2 py-0.5 pl-6 text-[10px] font-semibold text-slate-400 uppercase tracking-wide ${
                                indiceSub > 0 ? 'border-t border-slate-200' : ''
                              }`}
                            >
                              Proveedor: {subgrupo.etiqueta}
                            </td>
                          </tr>
                          {subgrupo.filas.map((item) => renderFila(item, banda))}
                        </Fragment>
                      ))
                    : grupo.filas.map((item) => renderFila(item, banda))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 mt-2">
        Proveedor y Fecha OC se guardan solos al salir del campo. El número de OC necesita presionar "Guardar" (o Enter). Si
        una misma OC termina con ítems de más de un proveedor, se subagrupan y se avisa — no se bloquea el guardado, queda a
        criterio de quien gestiona la compra si conviene separarla en OCs distintas.
        Solicitado por, N°, Código Defontana, Descripción y el checkbox quedan fijos al desplazar horizontalmente.
      </p>
    </div>
  )
}
