/**
 * Búsqueda de texto libre reutilizada por el buscador general de Compras
 * (ver Compras.tsx): parcial, sin distinguir mayúsculas ni tildes.
 */
export function normalizarBusqueda(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export function coincideTexto(valor: string | number | null | undefined, consultaNormalizada: string): boolean {
  if (valor == null) return false
  return normalizarBusqueda(String(valor)).includes(consultaNormalizada)
}

/**
 * Filtra `items` dejando solo los que coinciden con `consulta` en alguno de
 * los campos que devuelva `obtenerCampos`. Si `consulta` está vacía,
 * devuelve `items` tal cual (sin copiar el array).
 */
export function filtrarPorTexto<T>(
  items: T[],
  consulta: string,
  obtenerCampos: (item: T) => Array<string | number | null | undefined>
): T[] {
  const consultaNormalizada = normalizarBusqueda(consulta)
  if (!consultaNormalizada) return items
  return items.filter((item) => obtenerCampos(item).some((campo) => coincideTexto(campo, consultaNormalizada)))
}
