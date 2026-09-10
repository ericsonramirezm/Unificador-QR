import { ReactNode } from 'react'

interface KpiCardProps {
  icon: ReactNode
  label: string
  value: string
  sublabel?: ReactNode
}

// Tarjeta KPI genérica de Compras — mismo patrón visual que
// ParteDiario/MetricCard.tsx, pero vive acá para no acoplar módulos entre
// sí. Solo muestra valores reales calculados de lo que ya se guarda.
export const KpiCard = ({ icon, label, value, sublabel }: KpiCardProps) => (
  <div className="bg-white rounded-lg border border-slate-200 p-4">
    <div className="flex items-center gap-2 text-slate-400 mb-2">
      {icon}
      <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
    </div>
    <p className="text-2xl font-bold text-slate-900 font-mono">{value}</p>
    {sublabel && <div className="mt-1 text-xs text-slate-500">{sublabel}</div>}
  </div>
)
