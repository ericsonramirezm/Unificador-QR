import { ReactNode } from 'react'

interface MetricCardProps {
  icon: ReactNode
  label: string
  value: string
  sublabel?: ReactNode
  progreso?: number // 0-100, opcional — solo las tarjetas con barra la pasan
}

// Tarjeta KPI genérica de la página Daily Report. Solo muestra valores
// reales calculados a partir de datos guardados — ninguna tarjeta que la
// use inventa una métrica (tendencia, meta, disponibilidad) que el sistema
// no registra.
export const MetricCard = ({ icon, label, value, sublabel, progreso }: MetricCardProps) => (
  <div className="bg-white rounded-lg border border-slate-200 p-4">
    <div className="flex items-center gap-2 text-slate-400 mb-2">
      {icon}
      <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
    </div>
    <p className="text-2xl font-bold text-slate-900 font-mono">{value}</p>
    {sublabel && <div className="mt-1 text-xs text-slate-500">{sublabel}</div>}
    {progreso !== undefined && (
      <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-600 rounded-full transition-all"
          style={{ width: `${Math.min(100, Math.max(0, progreso))}%` }}
        />
      </div>
    )}
  </div>
)
