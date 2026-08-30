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
