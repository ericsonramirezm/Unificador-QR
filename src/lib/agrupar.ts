/**
 * Agrupa filas por su número (Código SC / RQ / OC según la tabla), para
 * que las que comparten número queden juntas con una banda visual — ver
 * TablaSolicitudesCompra/TablaRequisiciones/TablaOrdenesCompra.
 *
 * Los grupos con número se ordenan de menor a mayor (comparación numérica,
 * no alfabética: "SC-2" antes que "SC-10"). Las filas sin número todavía
 * (RQ/OC "por llenar") van todas juntas en un único grupo al final,
 * identificado con `etiquetaSinNumero`.
 */
export interface GrupoFilas<T> {
  clave: string
  etiqueta: string
  filas: T[]
}

const SIN_NUMERO = '__sin_numero__'

export function agruparPorNumero<T>(
  items: T[],
  obtenerNumero: (item: T) => string | null | undefined,
  etiquetaSinNumero: string
): GrupoFilas<T>[] {
  const grupos = new Map<string, T[]>()

  for (const item of items) {
    const numero = obtenerNumero(item)
    const clave = numero && numero.trim() !== '' ? numero.trim() : SIN_NUMERO
    if (!grupos.has(clave)) grupos.set(clave, [])
    grupos.get(clave)!.push(item)
  }

  const entradas = Array.from(grupos.entries())
  const conNumero = entradas.filter(([clave]) => clave !== SIN_NUMERO)
  const sinNumero = entradas.filter(([clave]) => clave === SIN_NUMERO)

  conNumero.sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }))

  return [...conNumero, ...sinNumero].map(([clave, filas]) => ({
    clave,
    etiqueta: clave === SIN_NUMERO ? etiquetaSinNumero : clave,
    filas,
  }))
}

const SIN_PROVEEDOR = '__sin_proveedor__'

/**
 * Subagrupa las filas de un grupo (p.ej. todos los ítems de un mismo N° de
 * OC) por un segundo campo — pensado para Proveedor: una Orden de Compra
 * en la práctica se emite a un solo proveedor, así que si dos ítems con el
 * mismo N° de OC terminan con Proveedor distinto conviene que se note.
 *
 * A diferencia de agruparPorNumero, acá el orden es alfabético (no
 * numérico) y el llamador decide si vale la pena mostrar la subdivisión:
 * si el resultado trae un solo grupo, es porque todas las filas comparten
 * el mismo proveedor (o todas están en blanco) y no hay nada que
 * distinguir — en ese caso no corresponde agregar un mini-encabezado.
 */
export function agruparPorProveedor<T>(filas: T[], obtenerProveedor: (item: T) => string | null | undefined): GrupoFilas<T>[] {
  const grupos = new Map<string, T[]>()

  for (const item of filas) {
    const proveedor = obtenerProveedor(item)
    const clave = proveedor && proveedor.trim() !== '' ? proveedor.trim() : SIN_PROVEEDOR
    if (!grupos.has(clave)) grupos.set(clave, [])
    grupos.get(clave)!.push(item)
  }

  const entradas = Array.from(grupos.entries())
  const conProveedor = entradas.filter(([clave]) => clave !== SIN_PROVEEDOR)
  const sinProveedor = entradas.filter(([clave]) => clave === SIN_PROVEEDOR)

  conProveedor.sort((a, b) => a[0].localeCompare(b[0], 'es'))

  return [...conProveedor, ...sinProveedor].map(([clave, subfilas]) => ({
    clave,
    etiqueta: clave === SIN_PROVEEDOR ? 'Sin proveedor' : clave,
    filas: subfilas,
  }))
}
