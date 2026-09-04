import { useEffect, useState } from 'react'
import { db } from '@lib/supabase'
import { Faena, FAENA_LABELS, HH_TURNO_POR_FAENA, ParteDiario, ParteDiarioEstado, Usuario } from '@/types/index'
import { ParteDiarioForm } from './ParteDiarioForm'
import { ParteDiarioDetalle } from './ParteDiarioDetalle'
import { puedeCrear, puedeEditar, puedeEliminar } from './permisos'
import { traducirError } from '@lib/errores'

// HH del reporte propiamente tal (no acumuladas) — mismo cálculo que ya
// usan ParteDiarioDetalle.tsx y DailyReportExcelPreview.tsx: Directas/
// Maquinaria suman las horas por actividad ya cargadas; Indirectas no se
// registran por actividad, se derivan de operativos × HH de turno de esa
// faena (ver HH_TURNO_POR_FAENA).
const sumarHoras = (items: any[], campo: string) =>
  items.reduce((acc, item) => acc + (Array.isArray(item[campo]) ? item[campo].reduce((a: number, h: number) => a + (h || 0), 0) : 0), 0)

const calcularHH = (parte: ParteDiario) => {
  const directas = sumarHoras(parte.mano_obra_directa, 'horas_por_actividad')
  const maquinaria = sumarHoras(parte.maquinaria, 'horas_por_actividad')
  const indirectas = parte.mano_obra_indirecta.reduce(
    (acc, f) => acc + HH_TURNO_POR_FAENA[parte.faena] * (f.operativos || 0),
    0
  )
  return { directas, maquinaria, indirectas, total: directas + maquinaria + indirectas }
}

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
      setError(traducirError(err, 'No se pudieron cargar los partes diarios'))
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
      setError(traducirError(err, 'No se pudo eliminar el Daily Report'))
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
        contrato={contrato}
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
        // obtenerPartesDiarios) y el correlativo es único y compartido
        // entre ambas faenas, así que el primer reporte que aparezca de
        // cada faena es su más reciente — y sus columnas *_acumuladas ya
        // traen la suma corrida de todos los anteriores DE ESA FAENA (cada
        // faena corre su propia cadena, ver obtenerUltimoParteDiario). El
        // total general del contrato es la suma de esos dos snapshots —
        // no hay que sumar columna por columna a través de todas las
        // filas, cada "acumuladas" ya es un corrido, no un delta.
        const ultimoLT = partes.find((p) => p.faena === Faena.LT)
        const ultimoLB = partes.find((p) => p.faena === Faena.LB)
        const filas = [
          { etiqueta: FAENA_LABELS[Faena.LT], parte: ultimoLT },
          { etiqueta: FAENA_LABELS[Faena.LB], parte: ultimoLB },
        ]
        const totalGeneral = {
          directas: (ultimoLT?.hh_directas_acumuladas ?? 0) + (ultimoLB?.hh_directas_acumuladas ?? 0),
          hm: (ultimoLT?.hm_acumuladas ?? 0) + (ultimoLB?.hm_acumuladas ?? 0),
          indirectas: (ultimoLT?.hh_indirectas_acumuladas ?? 0) + (ultimoLB?.hh_indirectas_acumuladas ?? 0),
        }
        const totalHH = totalGeneral.directas + totalGeneral.hm + totalGeneral.indirectas
        return (
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">HH acumuladas por faena</h3>
              <span className="text-xs text-slate-400">{partes.length} Daily Report{partes.length === 1 ? '' : 's'}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2">Faena</th>
                  <th className="text-right px-4 py-2">HH Directas</th>
                  <th className="text-right px-4 py-2">HM Maquinaria</th>
                  <th className="text-right px-4 py-2">HH Indirectas</th>
                  <th className="text-right px-4 py-2">Total HH</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filas.map(({ etiqueta, parte }) => {
                  const directas = parte?.hh_directas_acumuladas ?? 0
                  const hm = parte?.hm_acumuladas ?? 0
                  const indirectas = parte?.hh_indirectas_acumuladas ?? 0
                  return (
                    <tr key={etiqueta}>
                      <td className="px-4 py-2 text-slate-700">{etiqueta}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-900">{directas}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-900">{hm}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-900">{indirectas}</td>
                      <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900">{directas + hm + indirectas}</td>
                    </tr>
                  )
                })}
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-4 py-2 text-slate-900">Total general</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-900">{totalGeneral.directas}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-900">{totalGeneral.hm}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-900">{totalGeneral.indirectas}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-900">{totalHH}</td>
                </tr>
              </tbody>
            </table>
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
                <th className="text-left px-4 py-3">Faena</th>
                <th className="text-left px-4 py-3">Fecha</th>
                <th className="text-left px-4 py-3">Creado por</th>
                <th className="text-right px-4 py-3">HH Directas</th>
                <th className="text-right px-4 py-3">HH Maquinaria</th>
                <th className="text-right px-4 py-3">HH Indirectas</th>
                <th className="text-right px-4 py-3">HH Total</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-right px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {partes.map((parte) => {
                const hh = calcularHH(parte)
                return (
                <tr
                  key={parte.id}
                  onClick={() => setParteSeleccionado(parte.id)}
                  className="hover:bg-slate-50 cursor-pointer"
                >
                  <td className="px-4 py-3 font-mono text-slate-700">
                    {String(parte.numero_reporte).padStart(3, '0')}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      title={FAENA_LABELS[parte.faena]}
                      className="px-2 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600"
                    >
                      {parte.faena}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{parte.fecha}</td>
                  <td className="px-4 py-3 text-slate-700">{parte.usuario_creador?.nombre ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900">{hh.directas}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900">{hh.maquinaria}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900">{hh.indirectas}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">{hh.total}</td>
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
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
