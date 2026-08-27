import { Faena, HH_TURNO_POR_FAENA } from '@/types/index'

// Fórmulas de horas-hombre del Daily Report, extraídas del formulario para
// poder probarlas.
//
// Estaban embebidas dentro de ParteDiarioForm.tsx (900 líneas), y por eso
// sobrevivió el error que encontró la auditoría: cuando el multiplicador
// fijo pasó a depender de la faena (10 en Las Tórtolas, 12 en Los Bronces),
// se actualizó el encabezado de la tabla y la fila de Total, pero la celda
// de cada fila quedó con el literal 11 — un valor que no corresponde a
// ninguna faena. Las filas mostraban 22, 22, 22 y el Total decía 60.
//
// Con estas funciones separadas, una prueba de cuatro líneas detecta esa
// clase de desincronización antes de que llegue a producción.

export interface FilaCargo {
  contratados: number
  operativos: number
}

/** Suma tolerante a null/undefined/NaN, como la del formulario. */
export const sumar = (valores: number[]) => valores.reduce((acc, v) => acc + (v || 0), 0)

/**
 * HH de una fila de mano de obra (directa o indirecta).
 *
 * Es la MISMA fórmula que usa el total, a propósito: si alguien cambia una
 * y no la otra, las pruebas de abajo fallan.
 */
export function hhDeFila(faena: Faena, fila: FilaCargo): number {
  return HH_TURNO_POR_FAENA[faena] * fila.operativos
}

/** HH totales de un conjunto de cargos. */
export function hhTotales(faena: Faena, filas: FilaCargo[]): number {
  return sumar(filas.map((f) => hhDeFila(faena, f)))
}

/** Permiso/Descanso: contratados que no están operativos. */
export function permisoDescanso(fila: FilaCargo): number {
  return fila.contratados - fila.operativos
}

/**
 * HH de un cargo directo repartidas por actividad: cada actividad dura
 * `cantidad` horas, y cada operativo del cargo aporta esas horas.
 */
export function horasPorActividad(operativos: number, duracionesActividad: (number | null)[]): number[] {
  return duracionesActividad.map((duracion) => (duracion ?? 0) * operativos)
}

/**
 * Acumulado nuevo = acumulado del último reporte de la misma faena + el
 * total del turno actual.
 */
export function acumular(anterior: number | null | undefined, delTurno: number): number {
  return (anterior ?? 0) + delTurno
}
