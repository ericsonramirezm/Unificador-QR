/**
 * Traduce los errores de Postgres del Supabase VIEJO de Bodega a algo que un
 * bodeguero entienda. Los mensajes que lanza `registrar_movimiento` ya vienen
 * redactados en español y son los que más importa mostrar tal cual.
 *
 * Deliberadamente NO fusionado con `@lib/errores.ts` de Unificador-QR en esta
 * fase (ver el plan, sección 4): ese archivo ya cumple un rol equivalente
 * (`traducirError`) para el resto de la app, pero fusionarlos ahora mezclaría
 * las reglas específicas de Postgres/RLS de Bodega con las de Unificador-QR
 * antes de que el esquema de Bodega siquiera viva en el mismo proyecto. Es
 * limpieza de una fase posterior, no de esta.
 */
export function mensajeDeError(e: unknown): string {
  if (!e) return 'Ocurrió un error desconocido.'
  const err = e as { message?: string; code?: string; details?: string }
  const mensaje = err.message ?? String(e)

  // Los nombres de restricción se revisan ANTES del código genérico 23505: si no,
  // cualquier choque de unicidad (por ejemplo una guía repetida) se reportaba
  // como "Código Defontana ya existe" solo por compartir el mismo código de error.
  if (mensaje.includes('articulos_codigo_defontana_uq')) {
    return 'Ese Código Defontana ya existe. Los códigos no se pueden repetir.'
  }
  if (mensaje.includes('documentos_folio_uq')) {
    return 'Esa guía de despacho ya fue recibida de ese proveedor.'
  }
  if (err.code === '23505') {
    return 'Ya existe un registro igual a este.'
  }
  if (mensaje.includes('movimiento_coherente')) {
    return 'Al movimiento le falta un dato obligatorio para su tipo (guía, sala, trabajador, bodega destino o motivo).'
  }
  // Una llave foránea impide borrar un registro que otra tabla todavía referencia
  // — un artículo con movimientos, una bodega con series, un proveedor con guías.
  if (err.code === '23503') {
    return 'No se puede eliminar: tiene movimientos, series o guías asociadas. Desactívalo en su lugar.'
  }
  if (err.code === '42501' || mensaje.includes('row-level security') || mensaje.includes('permission denied')) {
    return 'Tu rol no tiene permiso para esta operación.'
  }
  // Un valor de enum que la base no conoce significa, en la práctica, que falta
  // aplicar una migración: la app ya sabe del valor nuevo y la base todavía no.
  // Se pide el código Y el texto porque `22P02` también lo produce un uuid o una
  // fecha mal formados, y mandar a alguien a aplicar una migración que no falta
  // es peor que no decir nada.
  if (err.code === '22P02' && mensaje.includes('invalid input value for enum')) {
    return 'Tu base de datos todavía no reconoce este valor: falta aplicar una migración pendiente en Supabase. Avísale a quien administra el sistema.'
  }
  // `fetch` falla así cuando no hay red. Tal cual sale en inglés y sin decir nada
  // útil, justo en el momento en que la explicación es la más simple posible.
  if (mensaje.includes('Failed to fetch') || mensaje.includes('NetworkError') || mensaje.includes('Load failed')) {
    return 'No hay conexión con el servidor. Revisa la señal e inténtalo de nuevo.'
  }
  return mensaje
}
