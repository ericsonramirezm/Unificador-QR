import { describe, expect, it } from 'vitest'
import { Faena, HH_TURNO_POR_FAENA } from '@/types/index'
import { acumular, hhDeFila, hhTotales, horasPorActividad, permisoDescanso, sumar } from './calculosHH'
import { traducirError } from './errores'

describe('multiplicador de HH por faena', () => {
  it('usa 10 horas en Las Tórtolas y 12 en Los Bronces', () => {
    expect(HH_TURNO_POR_FAENA[Faena.LT]).toBe(10)
    expect(HH_TURNO_POR_FAENA[Faena.LB]).toBe(12)
  })

  // Esta es la prueba que habría atrapado el bug: la celda de cada fila
  // tenía el literal 11, que no corresponde a ninguna faena.
  it('nunca multiplica por un valor fijo que no sea el de la faena', () => {
    const fila = { contratados: 3, operativos: 2 }
    expect(hhDeFila(Faena.LT, fila)).toBe(20)
    expect(hhDeFila(Faena.LB, fila)).toBe(24)
    expect(hhDeFila(Faena.LT, fila)).not.toBe(22)
  })
})

describe('coherencia entre filas y total', () => {
  // El síntoma que veía el coordinador: las filas mostraban 22, 22, 22
  // (=66) y la fila Total decía 60. La tabla no cuadraba consigo misma.
  it('la suma de las filas es exactamente el total, en ambas faenas', () => {
    const filas = [
      { contratados: 3, operativos: 2 },
      { contratados: 5, operativos: 4 },
      { contratados: 2, operativos: 0 },
    ]

    for (const faena of [Faena.LT, Faena.LB]) {
      const sumaDeFilas = sumar(filas.map((f) => hhDeFila(faena, f)))
      expect(hhTotales(faena, filas)).toBe(sumaDeFilas)
    }
  })

  it('sin operativos, no hay HH', () => {
    expect(hhTotales(Faena.LT, [{ contratados: 8, operativos: 0 }])).toBe(0)
  })

  it('una lista vacía da cero, no NaN', () => {
    expect(hhTotales(Faena.LB, [])).toBe(0)
  })
})

describe('permiso / descanso', () => {
  it('es la diferencia entre contratados y operativos', () => {
    expect(permisoDescanso({ contratados: 7, operativos: 5 })).toBe(2)
    expect(permisoDescanso({ contratados: 4, operativos: 4 })).toBe(0)
  })
})

describe('horas repartidas por actividad', () => {
  it('multiplica la duración de cada actividad por los operativos del cargo', () => {
    expect(horasPorActividad(4, [0.5, 2, 1])).toEqual([2, 8, 4])
  })

  it('trata una actividad sin duración como cero', () => {
    expect(horasPorActividad(3, [null, 1])).toEqual([0, 3])
  })
})

describe('acumulados', () => {
  it('parte de cero cuando es el primer reporte de la faena', () => {
    expect(acumular(null, 120)).toBe(120)
    expect(acumular(undefined, 120)).toBe(120)
  })

  it('suma sobre el acumulado del reporte anterior', () => {
    expect(acumular(1000, 120)).toBe(1120)
  })
})

describe('sumar', () => {
  it('ignora valores nulos o NaN en vez de propagarlos', () => {
    expect(sumar([1, NaN, 3])).toBe(4)
    expect(sumar([])).toBe(0)
  })
})

describe('traducción de errores', () => {
  it('convierte los errores de red en algo accionable, sin jerga', () => {
    const mensaje = traducirError(new Error('Failed to fetch'), 'No se pudo guardar')
    expect(mensaje).toContain('conexión')
    expect(mensaje).not.toContain('Failed to fetch')
  })

  it('no filtra jerga de base de datos al usuario', () => {
    const mensaje = traducirError(
      new Error('new row violates row-level security policy for table "documentos"'),
      'No se pudo guardar'
    )
    expect(mensaje).not.toContain('row-level security')
    expect(mensaje).toContain('permiso')
  })

  it('avisa que un reintento pudo haber guardado la primera vez', () => {
    const mensaje = traducirError(
      new Error('duplicate key value violates unique constraint "partes_diarios_contrato_id_numero_reporte_key"'),
      'No se pudo guardar'
    )
    expect(mensaje).toContain('ya existe')
  })

  it('cuando no reconoce el error, usa el mensaje propio de la acción', () => {
    expect(traducirError(new Error('algo rarísimo'), 'No se pudo guardar el Daily Report')).toBe(
      'No se pudo guardar el Daily Report'
    )
  })
})
