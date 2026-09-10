import { Faena, FAENA_LABELS, ParteDiario } from '@/types/index'

interface FaenaSummaryTableProps {
  partes: ParteDiario[]
}

// Tabla comparativa "HH acumuladas por faena" — a propósito NO se filtra
// por faena activa (a diferencia de ReportsHistoryTable): su función es
// comparar Las Tórtolas contra Los Bronces, así que siempre muestra ambas.
export const FaenaSummaryTable = ({ partes }: FaenaSummaryTableProps) => {
  // partes viene ordenado por numero_reporte descendente (ver
  // obtenerPartesDiarios) y el correlativo es único y compartido entre
  // ambas faenas, así que el primer reporte que aparezca de cada faena es
  // su más reciente — y sus columnas *_acumuladas ya traen la suma corrida
  // de todos los anteriores DE ESA FAENA (cada faena corre su propia
  // cadena, ver obtenerUltimoParteDiario). El total general del contrato es
  // la suma de esos dos snapshots — no hay que sumar columna por columna a
  // través de todas las filas, cada "acumuladas" ya es un corrido, no un delta.
  const ultimoLT = partes.find((p) => p.faena === Faena.LT)
  const ultimoLB = partes.find((p) => p.faena === Faena.LB)
  const filas = [
    { faena: Faena.LT, etiqueta: FAENA_LABELS[Faena.LT], parte: ultimoLT },
    { faena: Faena.LB, etiqueta: FAENA_LABELS[Faena.LB], parte: ultimoLB },
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
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">Faena</th>
              <th className="text-right px-4 py-2">HH Directas</th>
              <th className="text-right px-4 py-2">HM Maquinaria</th>
              <th className="text-right px-4 py-2">HH Indirectas</th>
              <th className="text-right px-4 py-2">Total HH</th>
              <th className="text-left px-4 py-2 w-40">% Aporte</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filas.map(({ faena, etiqueta, parte }) => {
              if (!parte) {
                return (
                  <tr key={faena}>
                    <td className="px-4 py-2 text-slate-700">{etiqueta}</td>
                    <td colSpan={5} className="px-4 py-2 text-slate-400 italic">En Movilización</td>
                  </tr>
                )
              }
              const directas = parte.hh_directas_acumuladas ?? 0
              const hm = parte.hm_acumuladas ?? 0
              const indirectas = parte.hh_indirectas_acumuladas ?? 0
              const total = directas + hm + indirectas
              const aporte = totalHH > 0 ? (total / totalHH) * 100 : 0
              return (
                <tr key={faena}>
                  <td className="px-4 py-2 text-slate-700">{etiqueta}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-900">{directas}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-900">{hm}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-900">{indirectas}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900">{total}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-600 rounded-full" style={{ width: `${aporte}%` }} />
                      </div>
                      <span className="text-xs font-mono text-slate-500 w-10 text-right">{aporte.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
            <tr className="bg-slate-50 font-semibold">
              <td className="px-4 py-2 text-slate-900">Total general</td>
              <td className="px-4 py-2 text-right font-mono text-slate-900">{totalGeneral.directas}</td>
              <td className="px-4 py-2 text-right font-mono text-slate-900">{totalGeneral.hm}</td>
              <td className="px-4 py-2 text-right font-mono text-slate-900">{totalGeneral.indirectas}</td>
              <td className="px-4 py-2 text-right font-mono text-slate-900">{totalHH}</td>
              <td className="px-4 py-2"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
