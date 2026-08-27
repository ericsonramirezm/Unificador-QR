// Traducción de errores técnicos a algo que una persona en terreno pueda
// entender y accionar.
//
// Antes, todos los componentes hacían `err instanceof Error ? err.message
// : 'mensaje en español'`. Como los errores de Supabase SÍ son instancias
// de Error, el mensaje en español casi nunca se usaba y lo que llegaba a
// pantalla era el texto crudo del SDK, en inglés y en lenguaje de base de
// datos: "Failed to fetch", "new row violates row-level security policy
// for table documentos", "duplicate key value violates unique constraint".
//
// Un supervisor que ve "Failed to fetch" no tiene forma de saber si basta
// con esperar a tener señal o si su trabajo se perdió. Eso es lo que estas
// traducciones resuelven: cada mensaje dice qué pasó y qué hacer.

interface Regla {
  /** Fragmentos que se buscan en el mensaje original, en minúsculas. */
  patrones: string[]
  mensaje: string
}

const REGLAS: Regla[] = [
  {
    // El más frecuente en faena: sin señal o señal intermitente.
    patrones: ['failed to fetch', 'networkerror', 'network request failed', 'load failed', 'err_internet'],
    mensaje:
      'No hay conexión con el servidor. Revisa la señal e inténtalo de nuevo — tu información no se ha perdido.',
  },
  {
    patrones: ['timeout', 'timed out', 'aborted'],
    mensaje: 'El servidor tardó demasiado en responder. Con mejor señal debería funcionar; inténtalo otra vez.',
  },
  {
    patrones: ['invalid login credentials', 'invalid credentials'],
    mensaje: 'El correo o la contraseña no son correctos.',
  },
  {
    patrones: ['email not confirmed'],
    mensaje: 'Todavía no confirmas tu correo. Busca el mensaje que te enviamos y haz clic en el enlace.',
  },
  {
    patrones: ['user already registered', 'already been registered'],
    mensaje: 'Ya existe una cuenta con ese correo. Inicia sesión o pide al coordinador que la active.',
  },
  {
    patrones: ['password should be at least'],
    mensaje: 'La contraseña es muy corta: debe tener al menos 6 caracteres.',
  },
  {
    patrones: ['jwt expired', 'invalid jwt', 'token is expired'],
    mensaje: 'Tu sesión expiró por inactividad. Vuelve a iniciar sesión.',
  },
  {
    patrones: ['row-level security', 'permission denied', 'insufficient privilege'],
    mensaje:
      'Tu perfil no tiene permiso para hacer esto. Si crees que debería, pídele al coordinador que revise tu rol.',
  },
  {
    patrones: ['solo puede agregar su comentario'],
    mensaje: 'Como mandante solo puedes agregar tu comentario, no modificar el contenido del reporte.',
  },
  {
    patrones: ['duplicate key', 'unique constraint', 'ya existe'],
    mensaje:
      'Ese registro ya existe. Si estás reintentando después de un error, es probable que la primera vez sí se haya guardado — revisa el listado antes de volver a intentar.',
  },
  {
    patrones: ['payload too large', 'entity too large', 'file size'],
    mensaje: 'El archivo es demasiado grande. Intenta con una foto más liviana o divide el documento.',
  },
  {
    patrones: ['foreign key', 'violates foreign key constraint'],
    mensaje: 'Falta un dato relacionado o fue eliminado por otra persona. Recarga la página e inténtalo de nuevo.',
  },
  {
    patrones: ['storage', 'bucket'],
    mensaje: 'No se pudo guardar el archivo. Revisa tu conexión e inténtalo de nuevo.',
  },
]

/**
 * Convierte cualquier error en un mensaje accionable en español.
 *
 * @param err        Lo que haya llegado al catch.
 * @param porDefecto Mensaje a mostrar cuando no se reconoce el error. Debe
 *                   describir la acción que falló ("No se pudo guardar el
 *                   Daily Report"), no ser genérico.
 */
export function traducirError(err: unknown, porDefecto: string): string {
  // Comparación explícita con false: si `navigator` no existe o `onLine` es
  // undefined (entornos sin DOM, navegadores antiguos), `!navigator.onLine`
  // daría true y TODO error se reportaría como falta de conexión, tapando
  // el problema real. Solo se toma el atajo cuando el navegador afirma que
  // está sin red.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'No tienes conexión a internet. Tu trabajo sigue acá; inténtalo cuando vuelva la señal.'
  }

  const original = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const enMinusculas = original.toLowerCase()

  const regla = REGLAS.find((r) => r.patrones.some((p) => enMinusculas.includes(p)))
  if (regla) return regla.mensaje

  // Sin coincidencia: se muestra el mensaje propio de la acción. El detalle
  // técnico va a la consola para poder diagnosticar sin exponérselo a quien
  // está en terreno.
  if (original) console.error('[error sin traducir]', original)
  return porDefecto
}
