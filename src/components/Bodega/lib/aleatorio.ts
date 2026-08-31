/**
 * Azar para nombrar archivos.
 *
 * Existe por una razón concreta: **`crypto.randomUUID()` solo está disponible en
 * contextos seguros** (HTTPS o `localhost`), y Bodega se usa a diario desde el
 * celular por la red local, en `http://192.168.x.x:8745` (ver el `.bat` de
 * respaldo en `Aplicaciones/Bodega/`). Ahí esa función sencillamente no existe,
 * y llamarla revienta con «is not a function» justo al subir una foto. Ya pasó
 * una vez — no lo "arregles" de vuelta a `crypto.randomUUID()`.
 *
 * `getRandomValues`, en cambio, **sí funciona en contextos inseguros**: de todo
 * el objeto `crypto`, solo `randomUUID` y `subtle` exigen HTTPS.
 */

/**
 * 128 bits de azar en hexadecimal.
 *
 * No es un UUID a propósito: un v4 gasta seis de sus bits en marcar versión y
 * variante, y aquí no los lee nadie. Usar los 128 completos sale más simple y con
 * más azar, no con menos.
 */
export function idAleatorio(): string {
  const c = globalThis.crypto
  // Se lanza en vez de caer a `Math.random()`. No es formalismo: el bucket de
  // fotos es PÚBLICO, y lo único que protege una foto es que su dirección sea
  // imposible de adivinar. Un respaldo predecible rompería esa garantía en
  // silencio, que es justo lo que un respaldo no debe hacer.
  if (!c?.getRandomValues) {
    throw new Error('Este navegador no puede generar nombres de archivo seguros.')
  }

  const bytes = new Uint8Array(16)
  c.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
