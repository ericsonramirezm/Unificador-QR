import { FAENA_LABELS, ParteDiario, ParteDiarioEstado, Usuario } from '@/types/index'
import { calcularHHReales } from '@lib/calculosHH'
import { Avatar } from './Avatar'
import { puedeEditar, puedeEliminar } from './permisos'

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

interface ReportsHistoryTableProps {
  partes: ParteDiario[] // ya filtrados por faena activa + búsqueda + paginados
  usuario: Usuario
  cargando: boolean
  onSeleccionar: (id: string) => void
  onEditar: (parte: ParteDiario) => void
  onEliminar: (parte: ParteDiario) => void
}

// Tabla detallada de reportes — a diferencia de FaenaSummaryTable, ESTA sí
// llega ya filtrada por la faena activa (se filtra en el orquestador,
// ParteDiarioList.tsx).
export const ReportsHistoryTable = ({ partes, usuario, cargando, onSeleccionar, onEditar, onEliminar }: ReportsHistoryTableProps) => (
  <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
    {cargando ? (
      <div className="p-6 text-sm text-slate-500">Cargando…</div>
    ) : partes.length === 0 ? (
      <div className="p-6 text-sm text-slate-500">No hay Daily Report que coincidan.</div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3">N°</th>
              <th className="text-left px-4 py-3">Faena</th>
              <th className="text-left px-4 py-3">Fecha</th>
              <th className="text-left px-4 py-3">Creado por</th>
              <th className="text-right px-4 py-3">HH Directas — Programado</th>
              <th className="text-right px-4 py-3">HH Directas</th>
              <th className="text-right px-4 py-3">HH Maquinaria</th>
              <th className="text-right px-4 py-3">HH Indirectas</th>
              <th className="text-right px-4 py-3">HH Total</th>
              <th className="text-right px-4 py-3">HH Acumulado</th>
              <th className="text-left px-4 py-3">Estado</th>
              <th className="text-right px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {partes.map((parte) => {
              const hh = calcularHHReales(parte, parte.faena)
              const total = hh.directas + hh.hm + hh.indirectas
              return (
                <tr key={parte.id} onClick={() => onSeleccionar(parte.id)} className="hover:bg-slate-50 cursor-pointer">
                  <td className="px-4 py-3 font-mono text-slate-700">#{String(parte.numero_reporte).padStart(3, '0')}</td>
                  <td className="px-4 py-3">
                    <span
                      title={FAENA_LABELS[parte.faena]}
                      className="px-2 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600"
                    >
                      {parte.faena}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{parte.fecha}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar nombre={parte.usuario_creador?.nombre} size="sm" />
                      <span className="text-slate-700">{parte.usuario_creador?.nombre ?? '—'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-500">{parte.hh_directas_programado ?? 0}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900">{hh.directas}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900">{hh.hm}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900">{hh.indirectas}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">{total}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-500">
                    {(parte.hh_directas_acumuladas ?? 0) + (parte.hm_acumuladas ?? 0) + (parte.hh_indirectas_acumuladas ?? 0)}
                  </td>
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
                            onEditar(parte)
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
                            onEliminar(parte)
                          }}
                          className="px-2 py-1 border border-red-200 text-red-600 text-xs font-semibold rounded-md hover:bg-red-50 transition-colors"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )}
  </div>
)
