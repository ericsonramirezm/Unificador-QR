import { DocumentStatus, ParteDiarioEstado, UserRole } from '@/types/index'

const ETIQUETAS_CARGO: Record<string, string> = {
  [UserRole.COORDINADOR]: 'Coordinador',
  [UserRole.APR]: 'APR',
  [UserRole.SUPERVISOR]: 'Supervisor',
  [UserRole.CONSULTOR]: 'Consultor',
  // Faltaba, así que este rol siempre se mostraba crudo ("mandante").
  [UserRole.MANDANTE]: 'Mandante',
}

// Estados de documento: la app mostraba el valor crudo de la base
// ("revision", "pendiente") en las tablas, mientras el filtro de más arriba
// en la misma pantalla decía "En revisión" — el usuario no tenía cómo saber
// que eran lo mismo.
const ETIQUETAS_ESTADO_DOCUMENTO: Record<string, string> = {
  [DocumentStatus.PENDIENTE]: 'Pendiente',
  [DocumentStatus.REVISION]: 'En revisión',
  [DocumentStatus.APROBADO]: 'Aprobado',
  [DocumentStatus.RECHAZADO]: 'Rechazado',
}

const ETIQUETAS_ESTADO_PARTE: Record<string, string> = {
  [ParteDiarioEstado.BORRADOR]: 'Borrador',
  [ParteDiarioEstado.ENVIADO]: 'Enviado',
  [ParteDiarioEstado.COMENTADO_MANDANTE]: 'Comentado por el mandante',
}

export function formatearEstadoDocumento(estado?: string | null): string {
  if (!estado) return ''
  return ETIQUETAS_ESTADO_DOCUMENTO[estado] || estado
}

export function formatearEstadoParte(estado?: string | null): string {
  if (!estado) return ''
  return ETIQUETAS_ESTADO_PARTE[estado] || estado
}

export function formatearCargo(rol?: string | null): string {
  if (!rol) return ''
  return ETIQUETAS_CARGO[rol] || rol
}
