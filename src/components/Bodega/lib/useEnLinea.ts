import { useEffect, useState } from 'react'

/**
 * Si el navegador cree que hay red.
 *
 * **`navigator.onLine` miente en un sentido**: da `true` con solo estar conectado
 * a una WiFi, aunque esa WiFi no llegue a internet — que es exactamente lo que
 * pasa en faena. Por eso esto sirve para *avisar*, no para decidir: cuando dice
 * que no hay red es fiable, cuando dice que sí no garantiza nada.
 *
 * No se usa dentro del módulo Bodega en esta fase: el `Layout.tsx` de
 * Unificador-QR ya muestra un aviso de "sin conexión" equivalente para toda la
 * app, Bodega incluida (ver el header de `Layout.tsx`). Se porta igual, sin
 * usar, por si algún día el módulo necesita una señal propia más fina que la
 * global.
 */
export function useEnLinea(): boolean {
  const [enLinea, setEnLinea] = useState(() => navigator.onLine)

  useEffect(() => {
    const conectado = () => setEnLinea(true)
    const desconectado = () => setEnLinea(false)
    window.addEventListener('online', conectado)
    window.addEventListener('offline', desconectado)
    return () => {
      window.removeEventListener('online', conectado)
      window.removeEventListener('offline', desconectado)
    }
  }, [])

  return enLinea
}
