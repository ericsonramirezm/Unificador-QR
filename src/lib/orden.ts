import { Documento, UserRole } from '@/types/index'

// Posición efectiva de un documento cuando no se ha reordenado a mano: los
// del Coordinador primero (todos con la misma base, así entre ellos se
// ordenan por fecha de carga), luego el resto por fecha de carga.
function claveDefecto(doc: Documento): number {
  const esCoordinador = doc.usuario_creador?.rol === UserRole.COORDINADOR
  const base = esCoordinador ? 0 : 1_000_000_000_000
  return base + new Date(doc.fecha_creacion).getTime()
}

function clavePosicion(doc: Documento): number {
  return doc.orden !== null && doc.orden !== undefined ? doc.orden : claveDefecto(doc)
}

export function ordenarDocumentos(documentos: Documento[]): Documento[] {
  return [...documentos].sort((a, b) => clavePosicion(a) - clavePosicion(b))
}
