import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { db } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { formatearFechaCorta } from '@lib/formato'
import { EntregaTurno as ActividadTurno, Faena, FAENA_LABELS, Usuario } from '@/types/index'

interface EntregaTurnoProps {
  usuario: Usuario
  contrato?: any
  faenaActiva: Faena
}

// Módulo "Entrega de Turno": lista de actividades pendientes por faena, con
// observaciones libres (sin límite de caracteres) y marcado de "hecha".
// Acceso restringido a coordinador — pedido explícito, reforzado también en
// RLS (add_entrega_turno.sql), no solo acá y en el gate de App.tsx/Layout.tsx.
//
// Al hacer clic en una actividad se abre un modal de revisión con toda su
// información; desde ahí mismo se marca (o desmarca) como hecha. Las
// actividades hechas no desaparecen de la lista: quedan tachadas con un
// badge verde, mezcladas con las pendientes — pedido explícito, para tener
// trazabilidad de todo en un solo lugar.
export const EntregaTurno = ({ usuario, contrato, faenaActiva }: EntregaTurnoProps) => {
  const [items, setItems] = useState<ActividadTurno[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [descripcion, setDescripcion] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [agregando, setAgregando] = useState(false)

  const [seleccionada, setSeleccionada] = useState<ActividadTurno | null>(null)
  const [marcando, setMarcando] = useState(false)
  const [eliminando, setEliminando] = useState(false)

  const cargar = async () => {
    if (!contrato?.id) return
    setCargando(true)
    setError(null)
    try {
      const data = await db.obtenerEntregasTurno(contrato.id, faenaActiva)
      setItems(data as ActividadTurno[])
    } catch (err) {
      setError(traducirError(err, 'No se pudieron cargar las actividades'))
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contrato?.id, faenaActiva])

  const agregar = async () => {
    if (!descripcion.trim() || !contrato?.id) return
    setAgregando(true)
    setError(null)
    try {
      await db.crearEntregaTurno({
        contrato_id: contrato.id,
        faena: faenaActiva,
        descripcion: descripcion.trim(),
        observaciones: observaciones.trim() || null,
        creado_por: usuario.id,
      })
      setDescripcion('')
      setObservaciones('')
      await cargar()
    } catch (err) {
      setError(traducirError(err, 'No se pudo agregar la actividad'))
    } finally {
      setAgregando(false)
    }
  }

  const alternarHecha = async (item: ActividadTurno) => {
    setMarcando(true)
    setError(null)
    try {
      const actualizada = (await db.marcarEntregaTurnoHecha(item.id, !item.hecha, usuario.id)) as ActividadTurno
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...actualizada } : i)))
      setSeleccionada((prev) => (prev && prev.id === item.id ? { ...prev, ...actualizada } : prev))
    } catch (err) {
      setError(traducirError(err, 'No se pudo actualizar la actividad'))
    } finally {
      setMarcando(false)
    }
  }

  const eliminar = async (item: ActividadTurno) => {
    const ok = window.confirm(`¿Eliminar la actividad "${item.descripcion}"? Esta acción no se puede deshacer.`)
    if (!ok) return
    setEliminando(true)
    setError(null)
    try {
      await db.eliminarEntregaTurno(item.id)
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      setSeleccionada(null)
    } catch (err) {
      setError(traducirError(err, 'No se pudo eliminar la actividad'))
    } finally {
      setEliminando(false)
    }
  }

  const pendientes = items.filter((i) => !i.hecha).length

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Entrega de Turno</h2>
          <p className="text-sm text-slate-500">
            {contrato?.codigo} · {contrato?.nombre}
          </p>
        </div>
        {/* La faena se elige en el sidebar (selector "Faena Activa", global
            para toda la app) — acá solo se muestra cuál está activa, no hay
            un selector propio para no duplicar el control. */}
        <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 shrink-0">
          {FAENA_LABELS[faenaActiva]}
        </span>
      </div>

      {!contrato && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
          No hay un contrato activo cargado todavía.
        </p>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">{error}</p>
      )}

      {/* Alta rápida: pensado para ir agregando actividades sobre la marcha
          durante el turno, sin abrir un modal aparte. */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 space-y-3">
        <input
          type="text"
          placeholder="Descripción de la actividad"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
        />
        <textarea
          placeholder="Observaciones (opcional, sin límite de caracteres)"
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 resize-y"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={agregar}
            disabled={!descripcion.trim() || agregando || !contrato}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {agregando ? 'Agregando…' : '+ Agregar actividad'}
          </button>
        </div>
      </div>

      {cargando ? (
        <p className="text-sm text-slate-500 py-8 text-center">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500 py-8 text-center">
          No hay actividades registradas para {FAENA_LABELS[faenaActiva]} todavía.
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-500 mb-2">
            {pendientes} pendiente{pendientes === 1 ? '' : 's'} · {items.length} en total
          </p>
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
            {items.map((item) => (
              <li
                key={item.id}
                onClick={() => setSeleccionada(item)}
                className={`px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${item.hecha ? 'bg-green-50/40' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${item.hecha ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                      {item.descripcion}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {item.usuario_creador?.nombre ?? '—'} · {formatearFechaCorta(item.created_at)}
                    </p>
                  </div>
                  {item.hecha && (
                    <span className="shrink-0 px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                      Hecha
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Modal de revisión: toda la información de la actividad, y desde acá
          se marca/desmarca como hecha. */}
      <Dialog.Root open={!!seleccionada} onOpenChange={(abierto) => !abierto && setSeleccionada(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white rounded-lg shadow-xl z-50 p-6 max-h-[85vh] overflow-y-auto">
            {seleccionada && (
              <>
                <div className="flex items-start justify-between gap-3 mb-1">
                  <Dialog.Title className="text-lg font-bold text-slate-900">{seleccionada.descripcion}</Dialog.Title>
                  {seleccionada.hecha && (
                    <span className="shrink-0 px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                      Hecha
                    </span>
                  )}
                </div>
                <Dialog.Description className="text-xs text-slate-400 mb-4">
                  {FAENA_LABELS[seleccionada.faena]} · Creada por {seleccionada.usuario_creador?.nombre ?? '—'} el{' '}
                  {formatearFechaCorta(seleccionada.created_at)}
                  {seleccionada.hecha && seleccionada.hecha_en && (
                    <>
                      {' '}
                      · Marcada hecha por {seleccionada.usuario_hecha?.nombre ?? '—'} el{' '}
                      {formatearFechaCorta(seleccionada.hecha_en)}
                    </>
                  )}
                </Dialog.Description>

                <div className="mb-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Observaciones</p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">
                    {seleccionada.observaciones || <span className="text-slate-300">Sin observaciones.</span>}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-2 pt-4 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => eliminar(seleccionada)}
                    disabled={eliminando}
                    className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-60"
                  >
                    Eliminar
                  </button>
                  <div className="flex items-center gap-2">
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50"
                      >
                        Cerrar
                      </button>
                    </Dialog.Close>
                    <button
                      type="button"
                      onClick={() => alternarHecha(seleccionada)}
                      disabled={marcando}
                      className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 ${
                        seleccionada.hecha
                          ? 'text-slate-600 border border-slate-300 hover:bg-slate-50'
                          : 'bg-green-600 text-white hover:bg-green-700'
                      }`}
                    >
                      {marcando ? '…' : seleccionada.hecha ? 'Marcar como pendiente' : 'Marcar como hecha'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
