// Iconos de la barra lateral: SVG a mano (sin librería nueva), mismo
// principio que ya usaba el ícono de hamburguesa de Layout.tsx. Trazo
// uniforme (stroke-width 1.8, stroke=currentColor) para que cada ícono
// tome el color de texto del NavItem que lo contiene (tenue si está
// inactivo, blanco si está activo) sin necesitar una clase de color aparte.
import { SVGProps } from 'react'

const base: SVGProps<SVGSVGElement> = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const IconInicio = () => (
  <svg {...base}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
  </svg>
)

export const IconDocumentos = () => (
  <svg {...base}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="16" y2="17" />
  </svg>
)

export const IconCalendario = () => (
  <svg {...base}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
)

export const IconReloj = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15.5 14" />
  </svg>
)

export const IconOjo = () => (
  <svg {...base}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

export const IconCarrito = () => (
  <svg {...base}>
    <circle cx="9" cy="20" r="1.2" />
    <circle cx="18" cy="20" r="1.2" />
    <path d="M2.5 3h2.2l2.4 12.2a2 2 0 0 0 2 1.6h8.3a2 2 0 0 0 2-1.6L21 8H6" />
  </svg>
)

export const IconBodega = () => (
  <svg {...base}>
    <path d="m3.5 7.5 8.5-4.5 8.5 4.5-8.5 4.5-8.5-4.5Z" />
    <path d="M3.5 7.5v9l8.5 4.5 8.5-4.5v-9" />
    <line x1="12" y1="12" x2="12" y2="21" />
  </svg>
)

export const IconEntregaTurno = () => (
  <svg {...base}>
    <path d="M20 11a8 8 0 0 0-14.6-4.5" />
    <polyline points="5.5 2 5.5 6.5 10 6.5" />
    <path d="M4 13a8 8 0 0 0 14.6 4.5" />
    <polyline points="18.5 22 18.5 17.5 14 17.5" />
  </svg>
)

export const IconReporte = () => (
  <svg {...base}>
    <path d="M14.5 3.5a2 2 0 0 1 2.8 2.8L8 15.6l-4 1 1-4Z" />
    <path d="M20 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" />
  </svg>
)

export const IconUsuario = () => (
  <svg {...base}>
    <path d="M4.5 20.5v-1a5.5 5.5 0 0 1 5.5-5.5h4a5.5 5.5 0 0 1 5.5 5.5v1" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)

export const IconConfiguracion = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.65 1.65 0 0 0-1.8-.3 1.65 1.65 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.65 1.65 0 0 0-1-1.5 1.65 1.65 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.65 1.65 0 0 0 .3-1.8 1.65 1.65 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.65 1.65 0 0 0 1.5-1 1.65 1.65 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.65 1.65 0 0 0 1.8.3H9a1.65 1.65 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.65 1.65 0 0 0 1 1.5 1.65 1.65 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.65 1.65 0 0 0-.3 1.8V9a1.65 1.65 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.65 1.65 0 0 0-1.5 1Z" />
  </svg>
)

export const IconApagar = () => (
  <svg {...base}>
    <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
    <line x1="12" y1="2" x2="12" y2="12" />
  </svg>
)

export const IconMeta = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </svg>
)

export const IconChecklist = () => (
  <svg {...base}>
    <path d="M9 11.5 11 13.5 15.5 9" />
    <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
  </svg>
)

export const IconMaquinaria = () => (
  <svg {...base}>
    <path d="M3 16.5V8a1 1 0 0 1 1-1h8.5v9.5" />
    <path d="M12.5 10.5H17l3.5 3v3" />
    <circle cx="7.5" cy="17.5" r="2" />
    <circle cx="17" cy="17.5" r="2" />
  </svg>
)

export const IconAlerta = () => (
  <svg {...base}>
    <path d="M12 3.5 21.5 20h-19L12 3.5Z" />
    <line x1="12" y1="10" x2="12" y2="14.5" />
    <circle cx="12" cy="17.5" r="0.5" fill="currentColor" stroke="none" />
  </svg>
)

export const IconProveedor = () => (
  <svg {...base}>
    <rect x="4" y="9" width="10" height="12" />
    <rect x="14" y="4" width="6" height="17" />
    <rect x="6.5" y="12" width="1.6" height="1.6" fill="currentColor" stroke="none" />
    <rect x="10" y="12" width="1.6" height="1.6" fill="currentColor" stroke="none" />
    <rect x="6.5" y="16" width="1.6" height="1.6" fill="currentColor" stroke="none" />
    <rect x="10" y="16" width="1.6" height="1.6" fill="currentColor" stroke="none" />
    <rect x="16.2" y="7" width="1.6" height="1.6" fill="currentColor" stroke="none" />
    <rect x="16.2" y="10.5" width="1.6" height="1.6" fill="currentColor" stroke="none" />
    <rect x="16.2" y="14" width="1.6" height="1.6" fill="currentColor" stroke="none" />
  </svg>
)
