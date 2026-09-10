// Círculo con iniciales — compartido entre el footer del sidebar
// (Layout.tsx) y la tabla de reportes (ReportsHistoryTable.tsx). No hay
// fotos de perfil en este sistema, así que las iniciales son el único dato
// real disponible para representar a una persona.
function iniciales(nombre: string | undefined | null): string {
  if (!nombre?.trim()) return '?'
  const partes = nombre.trim().split(/\s+/)
  const primeras = partes.length === 1 ? partes[0].slice(0, 2) : partes[0][0] + partes[partes.length - 1][0]
  return primeras.toUpperCase()
}

interface AvatarProps {
  nombre: string | undefined | null
  size?: 'sm' | 'md'
}

const TAMANOS = {
  sm: 'w-7 h-7 text-[10px]',
  md: 'w-9 h-9 text-xs',
}

// Círculo azul sólido (no un tinte translúcido): así se lee igual de bien
// sobre el fondo blanco de la tabla de reportes que sobre el fondo oscuro
// del sidebar — un bg-blue-600/15 quedaba lavado y de bajo contraste ahí.
export const Avatar = ({ nombre, size = 'md' }: AvatarProps) => (
  <div
    className={`shrink-0 rounded-full bg-blue-600 text-white font-semibold flex items-center justify-center ${TAMANOS[size]}`}
    aria-hidden="true"
  >
    {iniciales(nombre)}
  </div>
)
