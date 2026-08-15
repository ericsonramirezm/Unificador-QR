import { UserRole } from '@/types/index'

const ETIQUETAS_CARGO: Record<string, string> = {
  [UserRole.COORDINADOR]: 'Coordinador',
  [UserRole.APR]: 'APR',
  [UserRole.SUPERVISOR]: 'Supervisor',
  [UserRole.CONSULTOR]: 'Consultor',
}

export function formatearCargo(rol?: string | null): string {
  if (!rol) return ''
  return ETIQUETAS_CARGO[rol] || rol
}
