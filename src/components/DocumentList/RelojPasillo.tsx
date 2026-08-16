import { useEffect, useState } from 'react'

const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Reloj en vivo (día, fecha, hora y huso horario) para el encabezado del
// Pasillo de revisión — útil para el Coordinador al revisar a qué hora se
// cargó/aprobó cada documento del día.
export const RelojPasillo = () => {
  const [ahora, setAhora] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const fecha = capitalizar(
    ahora.toLocaleDateString('es-CL', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  )
  const hora = ahora.toLocaleTimeString('es-CL')
  const zonaHoraria = Intl.DateTimeFormat().resolvedOptions().timeZone
  const offset = new Intl.DateTimeFormat('es-CL', { timeZoneName: 'shortOffset' })
    .formatToParts(ahora)
    .find((p) => p.type === 'timeZoneName')?.value

  return (
    <div className="text-right">
      <p className="text-sm font-semibold text-slate-900 tabular-nums">{hora}</p>
      <p className="text-xs text-slate-500">{fecha}</p>
      <p className="text-xs text-slate-400">
        {zonaHoraria}
        {offset ? ` (${offset})` : ''}
      </p>
    </div>
  )
}
