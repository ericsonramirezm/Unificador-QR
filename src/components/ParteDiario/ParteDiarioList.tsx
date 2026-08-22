import { useEffect, useState } from 'react'
import { db } from '@lib/supabase'
import { ParteDiario, ParteDiarioEstado, UserRole, Usuario } from '@/types/index'
import { ParteDiarioForm } from './ParteDiarioForm'
import { ParteDiarioDetalle } from './ParteDiarioDetalle'

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

// El rol "supervisor" no tiene acceso al módulo Daily Report (ver
// Layout.tsx y remove_supervisor_daily_report.sql).
const puedeCrear = (rol: UserRole) => rol === UserRole.COORDINADOR || rol === UserRole.APR

export const ParteDiarioList = ({ usuario, contrato }: ParteDiarioListProps) => {
  const [partes, setPartes] = useState<ParteDiario[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
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

  if (!contrato?.id) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
        No hay un contrato activo configurado.
      </div>
    )
  }

  if (mostrarFormulario) {
    return (
      <ParteDiarioForm
        usuario={usuario}
        contrato={contrato}
        onCancelar={() => setMostrarFormulario(false)}
        onGuardado={() => {
          setMostrarFormulario(false)
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
