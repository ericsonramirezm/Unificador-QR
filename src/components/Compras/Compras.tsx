import { useEffect, useMemo, useState } from 'react'
import { NuevaSolicitudCompraModal } from './NuevaSolicitudCompraModal'
import { TablaSolicitudesCompra } from './TablaSolicitudesCompra'
import { TablaRequisiciones } from './TablaRequisiciones'
import { TablaOrdenesCompra } from './TablaOrdenesCompra'
import { TablaGuiasDespacho } from './TablaGuiasDespacho'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { filtrarPorTexto } from '@lib/buscar'
import { Contrato, GuiaDespacho, OrdenCompra, Requisicion, SolicitudCompra, Usuario } from '@/types/index'

interface ComprasProps {
  usuario: Usuario
  contrato?: Contrato | null
}

type Pestana = 'sc' | 'rq' | 'oc' | 'gd'

// Módulo de Compras: Solicitud de Compra (SC) → Requisición (RQ) → Orden
// de Compra (OC) → Guía de Despacho (GD), como cuatro pestañas separadas
// por etapa — ver add_compras.sql y add_guias_despacho.sql. Cada ítem que
// avanza de etapa desaparece de su pestaña de origen y aparece en la
// siguiente; "Devolver" hace el camino inverso. Por ahora GD es la última
// etapa definida (podrían agregarse más adelante).
//
// Buscador general (ver @lib/buscar): un único cuadro de texto arriba de
// las pestañas que filtra las 4 etapas a la vez, insensible a mayúsculas y
// tildes. El texto persiste al cambiar de pestaña; los contadores de cada
// pestaña reflejan las coincidencias mientras hay una búsqueda activa, así
// se ve en qué etapa(s) hay resultados sin tener que entrar a cada una.
export const Compras = ({ usuario, contrato }: ComprasProps) => {
  const [pestana, setPestana] = useState<Pestana>('sc')
  const [mostrarNuevaSolicitud, setMostrarNuevaSolicitud] = useState(false)
  const [busqueda, setBusqueda] = useState('')

  const [solicitudes, setSolicitudes] = useState<SolicitudCompra[]>([])
  const [requisiciones, setRequisiciones] = useState<Requisicion[]>([])
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([])
  const [guias, setGuias] = useState<GuiaDespacho[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Campos buscables por etapa: exactamente los que ya se muestran como
  // columna en la tabla de esa pestaña (ver TablaXxx.tsx). Todo vive en
  // memoria y no hay red de por medio, así que se filtra en cada tecla sin
  // debounce.
  const solicitudesFiltradas = useMemo(
    () =>
      filtrarPorTexto(solicitudes, busqueda, (s) => [
        s.codigo_sc,
        s.solicitado_por,
        s.descripcion,
        s.marca,
        s.modelo,
        s.unidad,
      ]),
    [solicitudes, busqueda]
  )
  const requisicionesFiltradas = useMemo(
    () =>
      filtrarPorTexto(requisiciones, busqueda, (r) => [
        r.rq_numero,
        r.codigo_defontana,
        r.codigo_sc,
        r.solicitado_por,
        r.descripcion,
        r.marca,
        r.modelo,
        r.unidad,
      ]),
    [requisiciones, busqueda]
  )
  const ordenesFiltradas = useMemo(
    () =>
      filtrarPorTexto(ordenes, busqueda, (o) => [
        o.oc_numero,
        o.proveedor,
        o.rq_numero,
        o.codigo_defontana,
        o.codigo_sc,
        o.solicitado_por,
        o.descripcion,
        o.marca,
        o.modelo,
        o.unidad,
      ]),
    [ordenes, busqueda]
  )
  const guiasFiltradas = useMemo(
    () =>
      filtrarPorTexto(guias, busqueda, (g) => [
        g.guia_numero,
        g.oc_numero,
        g.proveedor,
        g.rq_numero,
        g.codigo_defontana,
        g.codigo_sc,
        g.solicitado_por,
        g.descripcion,
        g.marca,
        g.modelo,
        g.unidad,
      ]),
    [guias, busqueda]
  )

  const contratoId = contrato?.id

  const cargarTodo = async () => {
    if (!contratoId) return
    setCargando(true)
    setError(null)
    try {
      const [sc, rq, oc, gd] = await Promise.all([
        db.obtenerSolicitudesCompra(contratoId),
        db.obtenerRequisiciones(contratoId),
        db.obtenerOrdenesCompra(contratoId),
        db.obtenerGuiasDespacho(contratoId),
      ])
      setSolicitudes(sc)
      setRequisiciones(rq)
      setOrdenes(oc)
      setGuias(gd)
    } catch (err) {
      setError(traducirError(err, 'No se pudo cargar el módulo de Compras'))
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargarTodo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contratoId])

  const avanzarSCaRQ = async (ids: string[]) => {
    try {
      await db.avanzarSCaRQ(ids)
      await cargarTodo()
    } catch (err) {
      setError(traducirError(err, 'No se pudo pasar el ítem a Requisiciones'))
    }
  }

  const avanzarRQaOC = async (ids: string[]) => {
    try {
      await db.avanzarRQaOC(ids)
      await cargarTodo()
    } catch (err) {
      setError(traducirError(err, 'No se pudo pasar el ítem a Órdenes de Compra'))
    }
  }

  const avanzarOCaGD = async (ids: string[]) => {
    try {
      await db.avanzarOCaGD(ids)
      await cargarTodo()
    } catch (err) {
      setError(traducirError(err, 'No se pudo pasar el ítem a Guías de Despacho'))
    }
  }

  const devolverRQaSC = async (id: string) => {
    try {
      await db.devolverRQaSC(id)
      await cargarTodo()
    } catch (err) {
      setError(traducirError(err, 'No se pudo devolver el ítem a Solicitudes de Compra'))
    }
  }

  const devolverOCaRQ = async (id: string) => {
    try {
      await db.devolverOCaRQ(id)
      await cargarTodo()
    } catch (err) {
      setError(traducirError(err, 'No se pudo devolver el ítem a Requisiciones'))
    }
  }

  const devolverGDaOC = async (id: string) => {
    try {
      await db.devolverGDaOC(id)
      await cargarTodo()
    } catch (err) {
      setError(traducirError(err, 'No se pudo devolver el ítem a Órdenes de Compra'))
    }
  }

  const guardarCampoRQ = async (id: string, campo: 'rq_numero' | 'fecha_rq' | 'codigo_defontana', valor: string) => {
    // actualizarRequisicion no trae el join a solicitudes_compra (Documento/
    // Fecha de Solicitud): se combina con la fila que ya estaba en memoria
    // para no perder esas columnas de la vista.
    const actualizada = await db.actualizarRequisicion(id, { [campo]: valor || null })
    setRequisiciones((prev) => prev.map((r) => (r.id === id ? { ...r, ...actualizada } : r)))
  }

  const guardarCampoOC = async (id: string, campo: 'oc_numero' | 'proveedor' | 'fecha_oc', valor: string) => {
    const actualizada = await db.actualizarOrdenCompra(id, { [campo]: valor || null })
    setOrdenes((prev) => prev.map((o) => (o.id === id ? { ...o, ...actualizada } : o)))
  }

  const guardarCampoGD = async (id: string, campo: 'guia_numero' | 'fecha_guia' | 'cantidad_recibida', valor: string) => {
    // Igual que guardarCampoOC: actualizarGuiaDespacho no trae el join
    // anidado (Documento/Fecha de Solicitud), se combina con la fila que ya
    // estaba en memoria para no perder esas columnas de la vista.
    const valorFinal = campo === 'cantidad_recibida' ? (valor === '' ? null : Number(valor)) : valor || null
    const actualizada = await db.actualizarGuiaDespacho(id, { [campo]: valorFinal })
    setGuias((prev) => prev.map((g) => (g.id === id ? { ...g, ...actualizada } : g)))
  }

  // "Eliminar": borra para siempre, no vuelve a la etapa anterior (a
  // diferencia de "Devolver"). El confirm() con la advertencia vive en
  // cada tabla, acá solo se llama a la base y se refresca la lista.
  const eliminarSC = async (id: string) => {
    try {
      await db.eliminarSolicitudCompra(id)
      await cargarTodo()
    } catch (err) {
      setError(traducirError(err, 'No se pudo eliminar la Solicitud de Compra'))
    }
  }

  const eliminarRQ = async (id: string) => {
    try {
      await db.eliminarRequisicion(id)
      await cargarTodo()
    } catch (err) {
      setError(traducirError(err, 'No se pudo eliminar la Requisición'))
    }
  }

  const eliminarOC = async (id: string) => {
    try {
      await db.eliminarOrdenCompra(id)
      await cargarTodo()
    } catch (err) {
      setError(traducirError(err, 'No se pudo eliminar la Orden de Compra'))
    }
  }

  const eliminarGD = async (id: string) => {
    try {
      await db.eliminarGuiaDespacho(id)
      await cargarTodo()
    } catch (err) {
      setError(traducirError(err, 'No se pudo eliminar la Guía de Despacho'))
    }
  }

  const TABS: { id: Pestana; etiqueta: string; total: number }[] = [
    { id: 'sc', etiqueta: 'Solicitudes de Compra', total: solicitudesFiltradas.length },
    { id: 'rq', etiqueta: 'Requisiciones', total: requisicionesFiltradas.length },
    { id: 'oc', etiqueta: 'Órdenes de Compra', total: ordenesFiltradas.length },
    { id: 'gd', etiqueta: 'Guías de Despacho', total: guiasFiltradas.length },
  ]

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-xl font-bold text-slate-900">Módulo de Compras</h2>
        <button
          type="button"
          onClick={() => setMostrarNuevaSolicitud(true)}
          disabled={!contrato}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <span className="text-base leading-none">+</span>
          {/* En pantallas angostas se muestra solo el ícono, para que el
              botón no empuje el título fuera del encabezado. */}
          <span className="hidden sm:inline">Nueva Solicitud de Compra</span>
        </button>
      </div>

      {!contrato && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
          No hay un contrato activo cargado todavía.
        </p>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">{error}</p>
      )}

      <div className="relative mb-4">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar en Compras (Código, Proveedor, Descripción, Solicitado por...)"
          className="w-full pl-9 pr-9 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
        />
        {busqueda && (
          <button
            type="button"
            onClick={() => setBusqueda('')}
            aria-label="Limpiar búsqueda"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            ×
          </button>
        )}
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-4 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setPestana(tab.id)}
            className={`px-4 py-2 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              pestana === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.etiqueta} ({tab.total})
          </button>
        ))}
      </div>

      {pestana === 'sc' && (
        <TablaSolicitudesCompra
          items={solicitudesFiltradas}
          cargando={cargando}
          busqueda={busqueda}
          onAvanzar={avanzarSCaRQ}
          onEliminar={eliminarSC}
        />
      )}
      {pestana === 'rq' && (
        <TablaRequisiciones
          items={requisicionesFiltradas}
          cargando={cargando}
          busqueda={busqueda}
          onAvanzar={avanzarRQaOC}
          onDevolver={devolverRQaSC}
          onGuardarCampo={guardarCampoRQ}
          onEliminar={eliminarRQ}
        />
      )}
      {pestana === 'oc' && (
        <TablaOrdenesCompra
          items={ordenesFiltradas}
          cargando={cargando}
          busqueda={busqueda}
          onAvanzar={avanzarOCaGD}
          onDevolver={devolverOCaRQ}
          onGuardarCampo={guardarCampoOC}
          onEliminar={eliminarOC}
        />
      )}
      {pestana === 'gd' && (
        <TablaGuiasDespacho
          items={guiasFiltradas}
          cargando={cargando}
          busqueda={busqueda}
          onDevolver={devolverGDaOC}
          onGuardarCampo={guardarCampoGD}
          onEliminar={eliminarGD}
        />
      )}

      {mostrarNuevaSolicitud && (
        <NuevaSolicitudCompraModal
          usuario={usuario}
          contrato={contrato}
          onCerrar={() => setMostrarNuevaSolicitud(false)}
          onGuardado={cargarTodo}
        />
      )}
    </div>
  )
}
