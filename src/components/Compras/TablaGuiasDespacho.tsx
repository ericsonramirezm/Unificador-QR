import { Fragment, useState } from 'react'
import { GuiaDespacho } from '@/types/index'
import { formatearFechaCorta } from '@lib/formato'
import { agruparPorNumero, type GrupoFilas } from '@lib/agrupar'
import { CeldaEditable } from './CeldaEditable'

interface TablaGuiasDespachoProps {
  items: GuiaDespacho[]
  cargando: boolean
  /** Texto del buscador general (Compras.tsx) — items ya llega pre-filtrado; esto es solo para el mensaje de estado vacío. */
  busqueda?: string
  onDevolver: (id: string) => Promise<void>
  onGuardarCampo: (id: string, campo: 'guia_numero' | 'fecha_guia' | 'cantidad_recibida', valor: string) => Promise<void>
  /** Elimina un ítem para siempre — no vuelve a Órdenes de Compra (a diferencia de onDevolver). */
  onEliminar: (id: string) => Promise<void>
}

const NUM_COLUMNAS = 21

// Cuarta etapa (add_guias_despacho.sql). Mismas columnas heredadas que en
// OC (RQ/Fecha RQ/Proveedor/OC/Fecha OC, todas de solo lectura acá) más
// las propias de esta etapa: Guía N°, Fecha de Guía y Cantidad Recibida.
// Por ahora no hay una quinta pestaña definida, así que no hay botón de
// avance — solo "← OC" para devolver y "Eliminar" para borrar el ítem.
//
// Se agrupa por Guía N°, mismo criterio que RQ/OC: el campo solo guarda al
// presionar "Guardar" (no al perder el foco), para que la fila no salte de
// grupo mientras se está escribiendo el número. Por eso el botón "Guardar"
// vive en la columna de acciones, entre Cantidad Recibida y "← OC". Las
// filas sin Guía todavía quedan juntas en "Sin N° Guía", al final.
//
// "Pendiente" y "Estado de Recepción" se calculan solas (Cantidad -
// Cantidad Recibida), no son columnas editables ni se guardan en la base:
//   - Cantidad Recibida todavía vacía -> neutral, sin resaltado ("—").
//   - Pendiente = 0                   -> verde, "Recepción Completa".
//   - Pendiente > 0 (llegó de menos)  -> amarillo, "Recepción Parcial".
//   - Pendiente < 0 (llegó de más)    -> rojo, "Exceso de Recepción".
// El color de fondo calculado acá reemplaza la banda alternada del grupo
// para esa fila (tiene prioridad visual sobre el agrupamiento).
//
// Recepción Completa y Recepción Parcial se archivan en dos secciones
// colapsables al final de la tabla, cerradas por defecto — así la tabla
// principal se enfoque en lo que sí necesita revisión (Exceso de Recepción
// y lo que todavía no se ha recibido). Un ítem se asigna por su propio
// estado, no por el de su grupo de Guía N° (una misma guía puede traer
// ítems en estados distintos), así que cada sección se agrupa por Guía N°
// por separado. Si hay una búsqueda activa (Compras.tsx) que trae
// coincidencias dentro de una sección, esa sección se fuerza abierta para
// no esconder el resultado.
type EstadoRecepcion = {
  pendiente: number | null
  etiqueta: string
  claseFila: string
  claseTexto: string
}

const calcularEstadoRecepcion = (item: GuiaDespacho): EstadoRecepcion => {
  if (item.cantidad_recibida == null) {
    return { pendiente: null, etiqueta: '—', claseFila: '', claseTexto: 'text-slate-300' }
  }
  const pendiente = item.cantidad - item.cantidad_recibida
  if (pendiente === 0) {
    return { pendiente, etiqueta: 'Recepción Completa', claseFila: 'bg-green-50', claseTexto: 'text-green-700' }
  }
  if (pendiente > 0) {
    return { pendiente, etiqueta: 'Recepción Parcial', claseFila: 'bg-amber-50', claseTexto: 'text-amber-700' }
  }
  return { pendiente, etiqueta: 'Exceso de Recepción', claseFila: 'bg-red-50', claseTexto: 'text-red-700' }
}

// Columnas fijas al desplazar horizontalmente: Solicitado por, N°, Código
// Defontana y Descripción — acá sin checkbox (esta tabla no tiene selección
// múltiple), así que Descripción entra como la 4ª fija en vez de quedar
// scrolleable como en RQ/OC. Por eso Descripción gana un ancho fijo (w-64,
// no tenía antes) — una celda sticky no puede depender de un ancho
// "lo que ocupe el contenido". `left-[Npx]` es la suma acumulada de los
// anchos de las columnas anteriores (w-32/w-10/w-28); si esos anchos
// cambian, recalcular a mano. Fondo opaco explícito por lo mismo que en
// TablaRequisiciones.tsx: una celda sticky sin fondo propio deja ver lo que
// pasa por debajo al desplazar.
const STICKY = 'sticky z-10'
const IZQ_SOLICITADO = 'left-0'
const IZQ_NUMERO = 'left-[128px]'
const IZQ_DEFONTANA = 'left-[168px]'
const IZQ_DESCRIPCION = 'left-[280px] border-r-2 border-slate-300'

export const TablaGuiasDespacho = ({ items, cargando, busqueda, onDevolver, onGuardarCampo, onEliminar }: TablaGuiasDespachoProps) => {
  const [procesando, setProcesando] = useState(false)
  const [abiertoParcial, setAbiertoParcial] = useState(false)
  const [abiertoCompleta, setAbiertoCompleta] = useState(false)

  const [guiaPendiente, setGuiaPendiente] = useState<Record<string, string>>({})
  const [guardandoGuia, setGuardandoGuia] = useState<Record<string, boolean>>({})
  const [errorGuia, setErrorGuia] = useState<Record<string, string>>({})

  const valorGuiaActual = (item: GuiaDespacho) => guiaPendiente[item.id] ?? item.guia_numero ?? ''
  const huboCambioGuia = (item: GuiaDespacho) => item.id in guiaPendiente && guiaPendiente[item.id] !== (item.guia_numero ?? '')

  const guardarGuia = async (item: GuiaDespacho) => {
    if (!huboCambioGuia(item)) return
    setGuardandoGuia((prev) => ({ ...prev, [item.id]: true }))
    setErrorGuia((prev) => ({ ...prev, [item.id]: '' }))
    try {
      await onGuardarCampo(item.id, 'guia_numero', guiaPendiente[item.id])
      setGuiaPendiente((prev) => {
        const copia = { ...prev }
        delete copia[item.id]
        return copia
      })
    } catch {
      setErrorGuia((prev) => ({ ...prev, [item.id]: 'No se guardó' }))
    } finally {
      setGuardandoGuia((prev) => ({ ...prev, [item.id]: false }))
    }
  }

  const devolver = async (id: string, codigoSc: string, numeroItem: number) => {
    const ok = window.confirm(
      `¿Devolver el ítem ${numeroItem} de ${codigoSc} a Órdenes de Compra? Esta guía de despacho se elimina (el ítem vuelve a aparecer en OC).`
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
      `¿Eliminar para siempre el ítem ${numeroItem} de ${codigoSc}? Esta acción no se puede deshacer: el ítem NO vuelve a Órdenes de Compra, se borra por completo.`
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
          <>No hay Guías de Despacho todavía. Avanza ítems desde la pestaña Órdenes de Compra.</>
        )}
      </p>
    )
  }

  // Partición por estado (no por grupo de guía): Exceso/sin-recibir quedan
  // siempre visibles; Completa/Parcial se agrupan aparte para las secciones
  // colapsables de más abajo.
  const itemsActivos: GuiaDespacho[] = []
  const itemsParcial: GuiaDespacho[] = []
  const itemsCompleta: GuiaDespacho[] = []
  for (const item of items) {
    const etiqueta = calcularEstadoRecepcion(item).etiqueta
    if (etiqueta === 'Recepción Completa') itemsCompleta.push(item)
    else if (etiqueta === 'Recepción Parcial') itemsParcial.push(item)
    else itemsActivos.push(item)
  }

  const gruposActivos = agruparPorNumero(itemsActivos, (item) => item.guia_numero, 'Sin N° Guía')
  const gruposParcial = agruparPorNumero(itemsParcial, (item) => item.guia_numero, 'Sin N° Guía')
  const gruposCompleta = agruparPorNumero(itemsCompleta, (item) => item.guia_numero, 'Sin N° Guía')

  const hayBusqueda = !!busqueda?.trim()

  const renderFila = (item: GuiaDespacho, banda: boolean) => {
    const estado = calcularEstadoRecepcion(item)
    // estado.claseFila ya es opaco (bg-green-50/bg-amber-50/bg-red-50, sin
    // transparencia) cuando hay estado — sirve tal cual para las celdas
    // sticky. Solo el caso neutral ('') necesita el mismo tratamiento que en
    // RQ/OC: opaco en vez del bg-slate-50/40 translúcido del <tr>.
    const claseFondoSticky = estado.claseFila || (banda ? 'bg-slate-50' : 'bg-white')
    return (
      <tr key={item.id} className={estado.claseFila || (banda ? 'bg-slate-50/40' : undefined)}>
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
        <td className="py-2 px-2 text-slate-500">{item.proveedor || '—'}</td>
        <td className="py-2 px-2 text-slate-500">{item.oc_numero || '—'}</td>
        <td className="py-2 px-2 text-slate-500">{formatearFechaCorta(item.fecha_oc)}</td>
        <td className="py-2 px-2">
          <div className="relative">
            <input
              type="text"
              value={valorGuiaActual(item)}
              placeholder="por llenar"
              onChange={(e) => setGuiaPendiente((prev) => ({ ...prev, [item.id]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') guardarGuia(item)
              }}
              disabled={!!guardandoGuia[item.id]}
              className="w-full px-2 py-1 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 disabled:bg-slate-50"
            />
            {errorGuia[item.id] && (
              <p className="absolute top-full left-0 text-[11px] text-red-600 mt-0.5 whitespace-nowrap">{errorGuia[item.id]}</p>
            )}
          </div>
        </td>
        <td className="py-2 px-2">
          <CeldaEditable
            tipo="date"
            valor={item.fecha_guia ? item.fecha_guia.slice(0, 10) : ''}
            onGuardar={(v) => onGuardarCampo(item.id, 'fecha_guia', v)}
          />
        </td>
        <td className="py-2 px-2">
          <CeldaEditable
            tipo="number"
            valor={item.cantidad_recibida != null ? String(item.cantidad_recibida) : ''}
            onGuardar={(v) => onGuardarCampo(item.id, 'cantidad_recibida', v)}
          />
        </td>
        <td className={`py-2 px-2 text-right font-semibold ${estado.claseTexto}`}>{estado.pendiente ?? '—'}</td>
        <td className={`py-2 px-2 font-semibold ${estado.claseTexto}`}>{estado.etiqueta}</td>
        <td className="py-2 px-2">
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => guardarGuia(item)}
              disabled={!huboCambioGuia(item) || !!guardandoGuia[item.id]}
              className="shrink-0 px-2 py-1 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {guardandoGuia[item.id] ? '…' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={() => devolver(item.id, item.codigo_sc, item.numero_item)}
              disabled={procesando}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-60"
            >
              ← OC
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

  const renderGrupos = (grupos: GrupoFilas<GuiaDespacho>[]) =>
    grupos.map((grupo, indiceGrupo) => {
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
          {grupo.filas.map((item) => renderFila(item, banda))}
        </Fragment>
      )
    })

  // Sección archivada y colapsable (Recepción Completa / Parcial). No
  // renderiza nada si no hay ítems en ese estado. Se fuerza abierta mientras
  // hay una búsqueda activa, para no esconder una coincidencia.
  const renderSeccionArchivada = (
    etiqueta: string,
    grupos: GrupoFilas<GuiaDespacho>[],
    total: number,
    abierto: boolean,
    alternar: () => void,
    claseTexto: string
  ) => {
    if (total === 0) return null
    const mostrarContenido = abierto || hayBusqueda
    return (
      <Fragment key={etiqueta}>
        <tr className="bg-slate-100 border-t-2 border-slate-300">
          <td colSpan={NUM_COLUMNAS} className="p-0">
            <button
              type="button"
              onClick={alternar}
              className={`w-full flex items-center gap-2 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide ${claseTexto}`}
            >
              <span
                className="inline-block transition-transform"
                style={{ transform: mostrarContenido ? 'rotate(90deg)' : 'none' }}
              >
                ▸
              </span>
              {etiqueta} · {total} ítem{total === 1 ? '' : 's'}
            </button>
          </td>
        </tr>
        {mostrarContenido && renderGrupos(grupos)}
      </Fragment>
    )
  }

  return (
    <div>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-sm min-w-[2950px]">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
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
              <th className="text-left py-2 px-2 w-64">Proveedor</th>
              <th className="text-left py-2 px-2 w-24">OC</th>
              <th className="text-left py-2 px-2 w-24">Fecha OC</th>
              <th className="text-left py-2 px-2 w-40">Guía N°</th>
              <th className="text-left py-2 px-2 w-28">Fecha Guía</th>
              <th className="text-left py-2 px-2 w-32">Cantidad Recibida</th>
              <th className="text-right py-2 px-2 w-24">Pendiente</th>
              <th className="text-left py-2 px-2 w-44">Estado de Recepción</th>
              <th className="w-64"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {renderGrupos(gruposActivos)}
            {renderSeccionArchivada(
              'Recepción Parcial',
              gruposParcial,
              itemsParcial.length,
              abiertoParcial,
              () => setAbiertoParcial((v) => !v),
              'text-amber-700'
            )}
            {renderSeccionArchivada(
              'Recepción Completa',
              gruposCompleta,
              itemsCompleta.length,
              abiertoCompleta,
              () => setAbiertoCompleta((v) => !v),
              'text-green-700'
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 mt-2">
        Fecha de Guía y Cantidad Recibida se guardan solas al salir del campo. El número de Guía necesita presionar
        "Guardar" (o Enter). Pendiente y Estado de Recepción se calculan solos (Cantidad − Cantidad Recibida): en blanco
        hasta que se ingrese Cantidad Recibida, verde cuando llega justo, amarillo si falta, rojo si llegó de más.
        Recepción Completa y Parcial quedan archivadas en secciones colapsables al final, cerradas por defecto.
        Solicitado por, N°, Código Defontana y Descripción quedan fijos al desplazar horizontalmente.
      </p>
    </div>
  )
}
