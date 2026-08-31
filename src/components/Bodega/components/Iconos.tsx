/** Iconos en línea: evitan una dependencia más y pesan lo que pesan. */
type Props = { className?: string }

const base = 'h-6 w-6'
const trazo = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const IconoMovimientos = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} {...trazo}>
    <path d="M4 7h11m0 0-3-3m3 3-3 3" />
    <path d="M20 17H9m0 0 3-3m-3 3 3 3" />
  </svg>
)

export const IconoStock = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} {...trazo}>
    <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />
    <path d="m3 7.5 9 4.5 9-4.5M12 12v9" />
  </svg>
)

export const IconoRecepcion = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} {...trazo}>
    <path d="M12 3v10m0 0 4-4m-4 4-4-4" />
    <path d="M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3" />
  </svg>
)

export const IconoSalida = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} {...trazo}>
    <path d="M12 21V11m0 0 4 4m-4-4-4 4" />
    <path d="M4 9V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3" />
  </svg>
)

export const IconoEpp = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} {...trazo}>
    <path d="M12 3a6 6 0 0 0-6 6v3H5a1 1 0 0 0 0 5h14a1 1 0 0 0 0-5h-1V9a6 6 0 0 0-6-6Z" />
    <path d="M9 17v1a3 3 0 0 0 6 0v-1" />
  </svg>
)

export const IconoCatalogos = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} {...trazo}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
    <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14z" />
  </svg>
)

export const IconoSalir = ({ className = 'h-5 w-5' }: Props) => (
  <svg viewBox="0 0 24 24" className={className} {...trazo}>
    <path d="M15 4h2a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-2" />
    <path d="M11 16l-4-4 4-4M7 12h10" />
  </svg>
)

export const IconoAlerta = ({ className = 'h-5 w-5' }: Props) => (
  <svg viewBox="0 0 24 24" className={className} {...trazo}>
    <path d="M12 9v4m0 3h.01" />
    <path d="M10.3 4.3 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
  </svg>
)
