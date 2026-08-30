import { useEffect, useState } from 'react'
import { NuevaSolicitudCompraModal } from './NuevaSolicitudCompraModal'
import { TablaSolicitudesCompra } from './TablaSolicitudesCompra'
import { TablaRequisiciones } from './TablaRequisiciones'
import { TablaOrdenesCompra } from './TablaOrdenesCompra'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { Contrato, OrdenCompra, Requisicion, SolicitudCompra, Usuario } from '@/types/index'

interface ComprasProps {
  usuario: Usuario
  contrato?: Contrato | null
}

type Pestana = 'sc' | 'rq' | 'oc'

// Módulo de Compras: Solicitud de Compra (SC) → Requisición (RQ) → Orden
// de Compra (OC), como tres pestañas separadas por etapa — ver
// add_compras.sql. Cada ítem que avanza de etapa desaparece de su pestaña
// de origen y aparece en la siguiente; "Devolver" hace el camino inverso.
//
// La búsqueda general (por Código SC/RQ/OC/Solicitado por/Descripción, u
// otros campos) queda para un paso aparte: todavía hay dos preguntas de
// diseño sin responder (qué campos son buscables y si la coincidencia es
// exacta o parcial).
export const Compras = ({ usuario, contrato }: ComprasProps) => {
  const [pestana, setPestana] = useState<Pestana>('sc')
  const [mostrarNuevaSolicitud, setMostrarNuevaSolicitud] = useState(false)

  const [solicitudes, setSolicitudes] = useState<SolicitudCompra[]>([])
  const [requisiciones, setRequisiciones] = useState<Requisicion[]>([])
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const contratoId = contrato?.id

  const cargarTodo = async () => {
    if (!contratoId) return
    setCargando(true)
    setError(null)
    try {
      const [sc, rq, oc] = await Promise.all([
        db.obtenerSolicitudesCompra(contratoId),
        db.obtenerRequisiciones(contratoId),
        db.obtenerOrdenesCompra(contratoId),
      ])
      setSolicitudes(sc)
      setRequisiciones(rq)
      setOrdenes(oc)
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

  const guardarCampoRQ = async (id: string, campo: 'rq_numero' | 'fecha_rq' | 'codigo_defontana', valor: string) => {
    const actualizada = await db.actualizarRequisicion(id, { [campo]: valor || null })
    setRequisiciones((prev) => prev.map((r) => (r.id === id ? actualizada : r)))
  }

  const guardarCampoOC = async (id: string, valor: string) => {
    const actualizada = await db.actualizarOrdenCompra(id, { oc_numero: valor || null })
    setOrdenes((prev) => prev.map((o) => (o.id === id ? actualizada : o)))
  }

  const TABS: { id: Pestana; etiqueta: string; total: number }[] = [
    { id: 'sc', etiqueta: 'Solicitudes de Compra', total: solicitudes.length },
    { id: 'rq', etiqueta: 'Requisiciones', total: requisiciones.length },
    { id: 'oc', etiqueta: 'Órdenes de Compra', total: ordenes.length },
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
        <TablaSolicitudesCompra items={solicitudes} cargando={cargando} onAvanzar={avanzarSCaRQ} />
      )}
      {pestana === 'rq' && (
        <TablaRequisiciones
          items={requisiciones}
          cargando={cargando}
          onAvanzar={avanzarRQaOC}
          onDevolver={devolverRQaSC}
          onGuardarCampo={guardarCampoRQ}
        />
      )}
      {pestana === 'oc' && (
        <TablaOrdenesCompra items={ordenes} cargando={cargando} onDevolver={devolverOCaRQ} onGuardarCampo={guardarCampoOC} />
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
