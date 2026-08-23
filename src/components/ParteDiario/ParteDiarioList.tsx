import { useEffect, useState } from 'react'
import { db } from '@lib/supabase'
import { ParteDiario, ParteDiarioEstado, Usuario } from '@/types/index'
import { ParteDiarioForm } from './ParteDiarioForm'
import { ParteDiarioDetalle } from './ParteDiarioDetalle'
import { puedeCrear, puedeEditar, puedeEliminar } from './permisos'

interface ParteDiarioListProps {
  usuario: Usuario
  contrato: any
}

const ETIQUETA_ESTADO: Record<ParteDiarioEstado, string> = {
  [ParteDiarioEstado.BORRADOR]: 'Borrador',
  [ParteDiarioEstado.ENVIADO]: 'Enviado',
  [ParteDiarioEstado.COMENTADO_MANDANTE]: 'Comentado por mandante',
}

const COLOR_ESTADO: Record<ParteDiarioEstado, string> = {
  [ParteDiarioEstado.BORRADOR]: 'bg-slate-100 text-slate-600',
  [ParteDiarioEstado.ENVIADO]: 'bg-blue-100 text-blue-700',
  [ParteDiarioEstado.COMENTADO_MANDANTE]: 'bg-emerald-100 text-emerald-700',
}

export const ParteDiarioList = ({ usuario, contrato }: ParteDiarioListProps) => {
  const [partes, setPartes] = useState<ParteDiario[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [parteAEditar, setParteAEditar] = useState<ParteDiario | null>(null)
  const [parteSeleccionado, setParteSeleccionado] = useState<string | null>(null)

  const cargarPartes = async () => {
    if (!contrato?.id) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await db.obtenerPartesDiarios(contrato.id)
      setPartes(data as ParteDiario[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los partes diarios')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    cargarPartes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contrato?.id])

  const eliminarParte = async (parte: ParteDiario) => {
    if (!window.confirm(`¿Eliminar el Daily Report N° ${String(parte.numero_reporte).padStart(3, '0')}? Esta acción no se puede deshacer.`)) {
      return
    }
    try {
      await db.eliminarParteDiario(parte.id)
      cargarPartes()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el Daily Report')
    }
  }

  if (!contrato?.id) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
        No hay un contrato activo configurado.
      </div>
    )
  }

  if (mostrarFormulario || parteAEditar) {
    return (
      <ParteDiarioForm
        usuario={usuario}
        contrato={contrato}
        parteExistente={parteAEditar ?? undefined}
        onCancelar={() => {
          setMostrarFormulario(false)
          setParteAEditar(null)
        }}
        onGuardado={() => {
          setMostrarFormulario(false)
          setParteAEditar(null)
          cargarPartes()
        }}
      />
    )
  }

  if (parteSeleccionado) {
    return (
      <ParteDiarioDetalle
        usuario={usuario}
        parteId={parteSeleccionado}
        onVolver={() => {
          setParteSeleccionado(null)
          cargarPartes()
        }}
        onEditar={(parte) => {
          setParteSeleccionado(null)
          setParteAEditar(parte)
        }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Daily Report</h2>
          <p className="text-sm text-slate-500">
            {contrato?.codigo} · {contrato?.nombre}
          </p>
        </div>
        {puedeCrear(usuario.rol) && (
          <button
            onClick={() => setMostrarFormulario(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Nuevo Daily Report
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
      )}

      {!isLoading && partes.length > 0 && (() => {
        // partes viene ordenado por numero_reporte descendente (ver
        // obtenerPartesDiarios), así que partes[0] es el último Daily
        // Report — y sus columnas *_acumuladas ya traen la suma de todos
        // los anteriores más las de él mismo. No hay que sumar columna por
        // columna a través de todas las filas: cada "acumuladas" es un
        // snapshot corrido, no un delta — sumarlas todas contaría de más.
        const ultimo = partes[0]
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <p className="text-xs text-slate-500 uppercase">Daily Reports</p>
              <p className="text-2xl font-bold text-slate-900">{partes.length}</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <p className="text-xs text-slate-500 uppercase">HH Directas acum.</p>
              <p className="text-2xl font-bold text-slate-900">{ultimo.hh_directas_acumuladas ?? 0}</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <p className="text-xs text-slate-500 uppercase">HM Maquinaria acum.</p>
              <p className="text-2xl font-bold text-slate-900">{ultimo.hm_acumuladas ?? 0}</p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <p className="text-xs text-slate-500 uppercase">HH Indirectas acum.</p>
              <p className="text-2xl font-bold text-slate-900">{ultimo.hh_indirectas_acumuladas ?? 0}</p>
            </div>
          </div>
        )
      })()}

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-slate-500">Cargando…</div>
        ) : partes.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">Todavía no hay partes diarios para este contrato.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">N°</th>
                <th className="text-left px-4 py-3">Fecha</th>
                <th className="text-left px-4 py-3">Creado por</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-right px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {partes.map((parte) => (
                <tr
                  key={parte.id}
                  onClick={() => setParteSeleccionado(parte.id)}
                  className="hover:bg-slate-50 cursor-pointer"
                >
                  <td className="px-4 py-3 font-mono text-slate-700">
                    {String(parte.numero_reporte).padStart(3, '0')}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{parte.fecha}</td>
                  <td className="px-4 py-3 text-slate-700">{parte.usuario_creador?.nombre ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${COLOR_ESTADO[parte.estado]}`}>
                      {ETIQUETA_ESTADO[parte.estado]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {puedeEditar(usuario, parte) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setParteAEditar(parte)
                          }}
                          className="px-2 py-1 border border-blue-200 text-blue-600 text-xs font-semibold rounded-md hover:bg-blue-50 transition-colors"
                        >
                          Editar
                        </button>
                      )}
                      {puedeEliminar(usuario) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            eliminarParte(parte)
                          }}
                          className="px-2 py-1 border border-red-200 text-red-600 text-xs font-semibold rounded-md hover:bg-red-50 transition-colors"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
