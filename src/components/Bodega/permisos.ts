import { RolBodega } from '@/types/index'
import type { TipoMovimiento } from './tipos'

/**
 * Permisos del módulo Bodega, sobre `RolBodega` (ex `RolUsuario` de
 * `types/domain.ts`, mismos cuatro valores). Espeja la verificación de rol de
 * `registrar_movimiento` en Postgres — la base manda, esto es solo
 * comodidad de navegación.
 */

export const ETIQUETA_ROL: Record<RolBodega, string> = {
  [RolBodega.ADMIN]: 'Administrador',
  [RolBodega.BODEGUERO]: 'Bodeguero',
  [RolBodega.CONSULTA]: 'Consulta',
  [RolBodega.PREVENCIONISTA]: 'Prevencionista',
}

export function puedeRegistrar(rol: RolBodega | null, tipo: TipoMovimiento): boolean {
  if (!rol) return false
  if (tipo === 'AJUSTE') return rol === RolBodega.ADMIN
  if (tipo === 'ENTREGA_EPP') return rol === RolBodega.ADMIN || rol === RolBodega.BODEGUERO || rol === RolBodega.PREVENCIONISTA
  return rol === RolBodega.ADMIN || rol === RolBodega.BODEGUERO
}

export const esAdmin = (rol: RolBodega | null) => rol === RolBodega.ADMIN
