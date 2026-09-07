import { describe, expect, it } from 'vitest'
import { Faena, HH_TURNO_POR_FAENA } from '@/types/index'
import {
  acumular,
  acumularCadena,
  calcularHHReales,
  hhDeFila,
  hhTotales,
  horasPorActividad,
  permisoDescanso,
  sumar,
} from './calculosHH'
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

describe('HH reales de un reporte guardado', () => {
  it('suma horas por actividad en Directas y Maquinaria, operativos x turno en Indirectas', () => {
    const parte = {
      mano_obra_directa: [{ horas_por_actividad: [10, 20] }, { horas_por_actividad: [5] }],
      maquinaria: [{ horas_por_actividad: [4, 4] }],
      mano_obra_indirecta: [{ contratados: 3, operativos: 2 }],
    }
    expect(calcularHHReales(parte, Faena.LT)).toEqual({ directas: 35, hm: 8, indirectas: 20 })
    expect(calcularHHReales(parte, Faena.LB)).toEqual({ directas: 35, hm: 8, indirectas: 24 })
  })

  it('filas sin horas_por_actividad (null/undefined) no rompen la suma', () => {
    const parte = {
      mano_obra_directa: [{ horas_por_actividad: null }, { horas_por_actividad: undefined }],
      maquinaria: [],
      mano_obra_indirecta: [],
    }
    expect(calcularHHReales(parte, Faena.LT)).toEqual({ directas: 0, hm: 0, indirectas: 0 })
  })
})

describe('cadena de acumulados de una faena', () => {
  it('el primer reporte parte de cero', () => {
    expect(acumularCadena([{ directas: 100, hm: 0, indirectas: 50 }])).toEqual([
      { directas: 100, hm: 0, indirectas: 50 },
    ])
  })

  it('cada reporte suma sobre el acumulado del anterior', () => {
    const cadena = acumularCadena([
      { directas: 100, hm: 0, indirectas: 50 },
      { directas: 80, hm: 10, indirectas: 40 },
      { directas: 60, hm: 0, indirectas: 30 },
    ])
    expect(cadena).toEqual([
      { directas: 100, hm: 0, indirectas: 50 },
      { directas: 180, hm: 10, indirectas: 90 },
      { directas: 240, hm: 10, indirectas: 120 },
    ])
  })

  // Reproduce el bug encontrado en producción (auditoría 2026-09-07): un
  // reporte de en medio de la cadena se edita después de creado (su HH real
  // baja de 55 a 50) — el acumulado de ESE reporte y el de TODOS los
  // posteriores tiene que reflejar el nuevo valor, no quedar pegado al
  // original. `acumularCadena` recalcula desde cero cada vez, así que esto
  // sale gratis con tal de pasarle los reportes en orden — es la prueba que
  // habría atrapado el bug si hubiera existido antes.
  it('si el HH real de un reporte de en medio cambia, el cambio se propaga a los reportes posteriores', () => {
    const original = acumularCadena([
      { directas: 132, hm: 0, indirectas: 55 }, // reporte N°1, antes de editar
      { directas: 99, hm: 0, indirectas: 70 }, // reporte N°2
    ])
    expect(original[1]).toEqual({ directas: 231, hm: 0, indirectas: 125 })

    const trasEditarN1 = acumularCadena([
      { directas: 132, hm: 0, indirectas: 50 }, // reporte N°1, editado: 55 -> 50
      { directas: 99, hm: 0, indirectas: 70 }, // reporte N°2, sin cambios
    ])
    // El acumulado del N°2 baja en 5, exactamente lo que bajó el N°1 — no
    // se queda pegado en 125 (que fue el bug real: reportes 1, 2, 3, 18 y
    // 19 quedaron con acumulados que no reflejaban ediciones posteriores).
    expect(trasEditarN1[1]).toEqual({ directas: 231, hm: 0, indirectas: 120 })
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
