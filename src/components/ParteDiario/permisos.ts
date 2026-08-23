import { ParteDiario, UserRole, Usuario } from '@/types/index'

// El rol "supervisor" no tiene acceso al módulo Daily Report en absoluto
// (ver Layout.tsx y remove_supervisor_daily_report.sql) — por eso no
// aparece en ninguno de estos helpers.

export const puedeCrear = (rol: UserRole) => rol === UserRole.COORDINADOR || rol === UserRole.APR

// Coordinador puede editar cualquier Daily Report del contrato; apr solo
// los que él mismo creó. Esto es solo la UI — la barrera real está en las
// policies RLS de partes_diarios, que siguen el mismo criterio.
export const puedeEditar = (usuario: Usuario, parte: ParteDiario) => {
  if (usuario.rol === UserRole.COORDINADOR) return true
  if (usuario.rol === UserRole.APR) return parte.creado_por === usuario.id
  return false
}

// Eliminar es más restrictivo: en la base de datos solo coordinador tiene
// policy de delete sobre partes_diarios (apr no tiene ninguna). Este
// helper solo refleja esa misma regla en la UI para no mostrar un botón
// que el servidor va a rechazar.
export const puedeEliminar = (usuario: Usuario) => usuario.rol === UserRole.COORDINADOR
