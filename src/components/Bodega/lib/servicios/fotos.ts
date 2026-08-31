import { mensajeDeError } from '../errores'
import { obtenerSupabaseBodega } from '../supabaseBodega'
import { idAleatorio } from '../aleatorio'
import { prepararFoto, tipoDe } from '../fotos/prepararFoto'
import type { Articulo } from '../../tipos'

/**
 * La foto del artículo, contra el bucket público `fotos-articulos`.
 *
 * La ruta se guarda en `articulos`, pero **no con un `update`**: el bodeguero no
 * tiene ese permiso, y bajo RLS un update denegado no falla — afecta cero filas.
 * Se escribe con el RPC `fijar_foto_articulo`, que además solo puede tocar esas
 * dos columnas.
 */

const BUCKET = 'fotos-articulos'

function fallar(e: unknown): never {
  throw new Error(mensajeDeError(e))
}

/**
 * URL para mostrar la foto. En un bucket público es **síncrona y estable**: no
 * hay que firmar nada, así que una lista de cien filas no dispara cien llamadas
 * ni caduca a los minutos. Es la razón principal de que el bucket sea público.
 */
export function urlFoto(path: string | null | undefined): string | null {
  if (!path) return null
  return obtenerSupabaseBodega().storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

/**
 * Comprime, sube y deja la foto asociada al artículo. Devuelve el artículo ya
 * actualizado, que es lo que la pantalla debe mostrar.
 */
export async function subirFotoArticulo(articulo: Articulo, archivo: File): Promise<Articulo> {
  const { foto, miniatura, extension } = await prepararFoto(archivo)

  // Nombre NUEVO en cada reemplazo, nunca sobrescribir la ruta anterior: al ser
  // un bucket público, la foto vieja está cacheada en la red de distribución y en
  // los celulares. Reusar la ruta mostraría la imagen antigua durante horas.
  //
  // NO uses `crypto.randomUUID()` aquí, por muy obvia que parezca: exige contexto
  // seguro y desde el celular se entra por HTTP en la red local, así que ahí no
  // existe y esto falla con «is not a function». Ver `lib/aleatorio.ts`.
  const id = idAleatorio()
  const rutaFoto = `${articulo.id}/${id}.${extension}`
  const rutaMini = `${articulo.id}/${id}_mini.${extension}`

  const almacen = obtenerSupabaseBodega().storage.from(BUCKET)

  const subidas = await Promise.all([
    almacen.upload(rutaFoto, foto, { contentType: tipoDe(foto) }),
    almacen.upload(rutaMini, miniatura, { contentType: tipoDe(miniatura) }),
  ])
  const falla = subidas.find((s) => s.error)
  if (falla?.error) {
    await borrar([rutaFoto, rutaMini])
    fallar(falla.error)
  }

  const { data, error } = await obtenerSupabaseBodega().rpc('fijar_foto_articulo', {
    p_articulo: articulo.id,
    p_foto: rutaFoto,
    p_miniatura: rutaMini,
  })
  if (error) {
    // Los archivos ya subidos quedarían sin dueño: se limpian antes de propagar.
    await borrar([rutaFoto, rutaMini])
    fallar(error)
  }

  // Recién ahora se borra la anterior, cuando la nueva ya está registrada. Si
  // este borrado falla queda un archivo huérfano — molesto, no incorrecto.
  await borrar([articulo.foto_path, articulo.foto_miniatura_path])

  return data as Articulo
}

/** Quita la foto del artículo y borra sus archivos. */
export async function quitarFotoArticulo(articulo: Articulo): Promise<Articulo> {
  const { data, error } = await obtenerSupabaseBodega().rpc('fijar_foto_articulo', {
    p_articulo: articulo.id,
    p_foto: null,
    p_miniatura: null,
  })
  if (error) fallar(error)

  await borrar([articulo.foto_path, articulo.foto_miniatura_path])
  return data as Articulo
}

/** Borrado de mejor esfuerzo: nunca hace fallar la operación que lo llamó. */
async function borrar(rutas: (string | null | undefined)[]): Promise<void> {
  const limpias = rutas.filter((r): r is string => Boolean(r))
  if (limpias.length === 0) return
  try {
    await obtenerSupabaseBodega().storage.from(BUCKET).remove(limpias)
  } catch {
    // Un archivo huérfano no justifica cancelar un cambio que ya se guardó.
  }
}
