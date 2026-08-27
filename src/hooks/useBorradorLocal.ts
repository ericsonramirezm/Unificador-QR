import { useCallback, useEffect, useRef, useState } from 'react'

// Autoguardado local de formularios largos.
//
// El Daily Report son unos 900 renglones de formulario: 7 actividades, 12
// cargos directos, 15 equipos, 11 cargos indirectos, jornada y fotos. Todo
// ese estado vivía únicamente en memoria. Si el celular bloqueaba la
// pantalla y el navegador descartaba la pestaña en segundo plano
// —comportamiento normal en equipos de terreno— se perdían veinte minutos
// de captura sin ninguna advertencia.
//
// El borrador se guarda en localStorage, que sobrevive a que se cierre la
// pestaña, se recargue o se apague el navegador. No sobrevive a limpiar los
// datos del sitio ni sirve para pasar trabajo de un dispositivo a otro:
// esto es una red de seguridad, no un reemplazo de guardar en el servidor.

const PREFIJO = 'uqr:borrador:'
const RETARDO_MS = 1500
/** Después de esto, un borrador se considera abandonado y no se ofrece. */
const VENCE_EN_MS = 3 * 24 * 60 * 60 * 1000

interface Sobre<T> {
  datos: T
  guardadoEn: number
}

export function leerBorrador<T>(clave: string): { datos: T; guardadoEn: Date } | null {
  try {
    const crudo = localStorage.getItem(PREFIJO + clave)
    if (!crudo) return null

    const sobre = JSON.parse(crudo) as Sobre<T>
    if (!sobre || typeof sobre.guardadoEn !== 'number') return null

    if (Date.now() - sobre.guardadoEn > VENCE_EN_MS) {
      localStorage.removeItem(PREFIJO + clave)
      return null
    }

    return { datos: sobre.datos, guardadoEn: new Date(sobre.guardadoEn) }
  } catch {
    // localStorage puede no estar disponible (modo privado, datos del sitio
    // bloqueados). No es motivo para romper el formulario.
    return null
  }
}

export function borrarBorrador(clave: string) {
  try {
    localStorage.removeItem(PREFIJO + clave)
  } catch {
    /* sin localStorage no hay nada que borrar */
  }
}

/**
 * Guarda `datos` en localStorage cada vez que cambian, con un pequeño
 * retardo para no escribir en cada tecla.
 *
 * @param clave  Identificador del formulario. Debe incluir lo que distinga
 *               un borrador de otro (usuario, contrato, fecha...).
 * @param datos  Lo que se quiere conservar. Debe ser serializable: los File
 *               de las fotos NO se pueden guardar, hay que excluirlos.
 * @param activo Poner en false cuando no corresponde guardar (por ejemplo,
 *               mientras se está enviando, o al editar algo ya guardado).
 */
export function useAutoguardado<T>(clave: string, datos: T, activo = true) {
  const [guardadoEn, setGuardadoEn] = useState<Date | null>(null)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!activo) return

    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => {
      try {
        const sobre: Sobre<T> = { datos, guardadoEn: Date.now() }
        localStorage.setItem(PREFIJO + clave, JSON.stringify(sobre))
        setGuardadoEn(new Date())
      } catch {
        // Cuota llena o almacenamiento bloqueado: se sigue sin autoguardado.
      }
    }, RETARDO_MS)

    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [clave, datos, activo])

  const limpiar = useCallback(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    borrarBorrador(clave)
    setGuardadoEn(null)
  }, [clave])

  return { guardadoEn, limpiar }
}

/** "hace 2 minutos", para el aviso de recuperación. */
export function haceCuanto(fecha: Date): string {
  const segundos = Math.floor((Date.now() - fecha.getTime()) / 1000)
  if (segundos < 60) return 'hace unos segundos'
  const minutos = Math.floor(segundos / 60)
  if (minutos < 60) return `hace ${minutos} minuto${minutos === 1 ? '' : 's'}`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `hace ${horas} hora${horas === 1 ? '' : 's'}`
  const dias = Math.floor(horas / 24)
  return `hace ${dias} día${dias === 1 ? '' : 's'}`
}
