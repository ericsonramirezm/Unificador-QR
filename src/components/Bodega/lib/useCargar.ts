import { useCallback, useEffect, useState } from 'react'

/**
 * Carga asíncrona con estado de carga, error y recarga manual. Existe para no
 * repetir el mismo `useEffect` con tres `useState` en cada pantalla de catálogo.
 *
 * `cargar` debe venir memoizada con `useCallback`, o el efecto se dispara en
 * cada render.
 */
export function useCargar<T>(cargar: () => Promise<T>) {
  const [datos, setDatos] = useState<T | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const ejecutar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setDatos(await cargar())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCargando(false)
    }
  }, [cargar])

  useEffect(() => {
    let vigente = true
    setCargando(true)
    setError(null)
    cargar()
      .then((d) => {
        if (vigente) setDatos(d)
      })
      .catch((e) => {
        if (vigente) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })
    return () => {
      // Evita escribir estado de una petición vieja que llegó tarde y pisaría
      // el resultado de la búsqueda actual.
      vigente = false
    }
  }, [cargar])

  return { datos, cargando, error, recargar: ejecutar }
}
