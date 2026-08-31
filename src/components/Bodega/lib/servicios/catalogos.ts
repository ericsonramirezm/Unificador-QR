import { RolBodega } from '@/types/index'
import { mensajeDeError } from '../errores'
import { obtenerSupabaseBodega } from '../supabaseBodega'
import { normalizarCodigo } from '../codigos'
import { formatearRut } from '../rut'
import type {
  Articulo,
  Bodega,
  EquivalenciaProveedor,
  Proveedor,
  SalaElectrica,
  TipoArticulo,
  TipoArticuloCatalogo,
  Trabajador,
} from '../../tipos'

/**
 * Acceso a los catálogos. La RLS de Postgres es la que decide quién puede
 * escribir: aquí no se comprueba el rol, solo se traduce el rechazo a un mensaje
 * legible. Duplicar la regla en el cliente la haría divergir tarde o temprano.
 */

function fallar(e: unknown): never {
  throw new Error(mensajeDeError(e))
}

// Se reexporta para no romper los imports existentes; la definición vive en
// `../codigos` para que el lector de planillas no arrastre este módulo.
export { normalizarCodigo } from '../codigos'

// --- Artículos ---------------------------------------------------------------

export interface FiltroArticulos {
  texto?: string
  tipo?: TipoArticulo | 'TODOS'
  incluirInactivos?: boolean
  limite?: number
}

export async function listarArticulos(filtro: FiltroArticulos = {}): Promise<Articulo[]> {
  let q = obtenerSupabaseBodega().from('articulos').select('*')

  if (!filtro.incluirInactivos) q = q.eq('activo', true)
  if (filtro.tipo && filtro.tipo !== 'TODOS') q = q.eq('tipo', filtro.tipo)

  const texto = filtro.texto?.trim()
  if (texto) {
    // Búsqueda por fragmento: el bodeguero teclea "4mm" o "guant", no palabras
    // completas. Por eso ILIKE con comodines a ambos lados y no búsqueda de
    // texto completo, que exige tokens enteros y no encontraría ninguno de los dos.
    const patron = `%${texto.replace(/[%_]/g, '\\$&')}%`
    q = q.or(`codigo_defontana.ilike.${patron},descripcion.ilike.${patron},marca.ilike.${patron}`)
  }

  const { data, error } = await q.order('codigo_defontana').limit(filtro.limite ?? 300)
  if (error) fallar(error)
  return (data ?? []) as Articulo[]
}

export async function obtenerArticulo(id: string): Promise<Articulo> {
  const { data, error } = await obtenerSupabaseBodega().from('articulos').select('*').eq('id', id).single()
  if (error) fallar(error)
  return data as Articulo
}

export async function obtenerArticuloPorCodigo(codigo: string): Promise<Articulo | null> {
  const { data, error } = await obtenerSupabaseBodega()
    .from('articulos')
    .select('*')
    .eq('codigo_defontana', normalizarCodigo(codigo))
    .maybeSingle()
  if (error) fallar(error)
  return (data as Articulo) ?? null
}

/**
 * Lo que el formulario de artículo escribe. **Las rutas de la foto quedan
 * deliberadamente fuera**: no se pueden escribir con un `insert`/`update` normal
 * porque el bodeguero no tiene ese permiso sobre `articulos`. Van por
 * `fijar_foto_articulo` desde `servicios/fotos.ts`, y dejarlas fuera del tipo
 * impide que alguien las cuele aquí y se pregunte por qué no se guardan.
 */
export type DatosArticulo = Omit<Articulo, 'id' | 'creado_en' | 'foto_path' | 'foto_miniatura_path'>

export async function crearArticulo(datos: DatosArticulo): Promise<Articulo> {
  const { data, error } = await obtenerSupabaseBodega()
    .from('articulos')
    .insert({ ...datos, codigo_defontana: normalizarCodigo(datos.codigo_defontana) })
    .select()
    .single()
  if (error) fallar(error)
  return data as Articulo
}

export async function actualizarArticulo(id: string, cambios: Partial<DatosArticulo>): Promise<Articulo> {
  const payload = { ...cambios }
  if (payload.codigo_defontana) payload.codigo_defontana = normalizarCodigo(payload.codigo_defontana)
  const { data, error } = await obtenerSupabaseBodega().from('articulos').update(payload).eq('id', id).select().single()
  if (error) fallar(error)
  return data as Articulo
}

export const eliminarArticulo = (id: string) => eliminar('articulos', id)

/**
 * Inserta en bloque los artículos de una importación. No usa `upsert`: el usuario
 * pidió que un código repetido avise, no que sobrescriba en silencio. Los
 * duplicados ya se filtraron en la vista previa; si aun así choca alguno, el
 * índice único de la base rechaza el lote entero y el mensaje lo explica.
 */
export async function crearArticulosEnBloque(datos: DatosArticulo[]): Promise<number> {
  if (datos.length === 0) return 0
  const { data, error } = await obtenerSupabaseBodega()
    .from('articulos')
    .insert(datos.map((d) => ({ ...d, codigo_defontana: normalizarCodigo(d.codigo_defontana) })))
    .select('id')
  if (error) fallar(error)
  return data?.length ?? 0
}

/** Todos los códigos ya existentes, para cruzar contra una planilla importada. */
export async function listarCodigosExistentes(): Promise<Set<string>> {
  const { data, error } = await obtenerSupabaseBodega().from('articulos').select('codigo_defontana')
  if (error) fallar(error)
  return new Set((data ?? []).map((a: { codigo_defontana: string }) => a.codigo_defontana))
}

// --- Catálogos simples -------------------------------------------------------

async function listar<T>(tabla: string, orden: string): Promise<T[]> {
  const { data, error } = await obtenerSupabaseBodega().from(tabla).select('*').order(orden)
  if (error) fallar(error)
  return (data ?? []) as T[]
}

async function crear<T>(tabla: string, valores: Record<string, unknown>): Promise<T> {
  const { data, error } = await obtenerSupabaseBodega().from(tabla).insert(valores).select().single()
  if (error) fallar(error)
  return data as T
}

async function actualizar<T>(tabla: string, id: string, cambios: Record<string, unknown>): Promise<T> {
  const { data, error } = await obtenerSupabaseBodega().from(tabla).update(cambios).eq('id', id).select().single()
  if (error) fallar(error)
  return data as T
}

/**
 * Borrado real. Si una llave foránea lo bloquea (el registro tiene historial),
 * la base lo rechaza y `mensajeDeError` lo traduce.
 *
 * Un DELETE denegado por RLS, en cambio, **no lanza**: afecta cero filas — la
 * misma asimetría que un UPDATE bloqueado. Sin este chequeo, un intento sin
 * permiso se vería como "eliminado" cuando en realidad no pasó nada.
 */
async function eliminar(tabla: string, id: string): Promise<void> {
  const { error, count } = await obtenerSupabaseBodega().from(tabla).delete({ count: 'exact' }).eq('id', id)
  if (error) fallar(error)
  if (!count) throw new Error('No se pudo eliminar: no tienes permiso o el registro ya no existe.')
}

export const listarProveedores = () => listar<Proveedor>('proveedores', 'nombre')
export const crearProveedor = (v: Omit<Proveedor, 'id'>) =>
  crear<Proveedor>('proveedores', { ...v, rut: v.rut ? formatearRut(v.rut) : v.rut })
export const actualizarProveedor = (id: string, v: Partial<Proveedor>) => {
  const payload = { ...v }
  if (payload.rut) payload.rut = formatearRut(payload.rut)
  return actualizar<Proveedor>('proveedores', id, payload)
}
export const eliminarProveedor = (id: string) => eliminar('proveedores', id)

/**
 * Busca si ese código de proveedor ya está asociado a un artículo Defontana.
 * Solo lectura: la RLS de `equivalencias_proveedor` deja ver a cualquier
 * `authenticated`. `null` si nunca se enseñó ese código para este proveedor.
 */
export async function buscarEquivalenciaProveedor(
  proveedorId: string,
  codigo: string,
): Promise<EquivalenciaProveedor | null> {
  const { data, error } = await obtenerSupabaseBodega()
    .from('equivalencias_proveedor')
    .select('*')
    .eq('proveedor_id', proveedorId)
    .eq('codigo_proveedor', normalizarCodigo(codigo))
    .maybeSingle()
  if (error) fallar(error)
  return (data as EquivalenciaProveedor) ?? null
}

/** Todas las equivalencias enseñadas, para armar el mapa articulo_id → códigos en Stock. */
export const listarEquivalenciasProveedor = () =>
  listar<EquivalenciaProveedor>('equivalencias_proveedor', 'codigo_proveedor')

/**
 * Enseña o corrige a qué artículo corresponde un código de proveedor. Va por
 * el RPC `registrar_equivalencia_proveedor`: la tabla no tiene política de
 * insert/update directa, igual que `fijar_bodega_actual`.
 */
export async function registrarEquivalenciaProveedor(v: {
  proveedor_id: string
  codigo_proveedor: string
  descripcion_proveedor: string | null
  articulo_id: string
}): Promise<EquivalenciaProveedor> {
  const { data, error } = await obtenerSupabaseBodega().rpc('registrar_equivalencia_proveedor', {
    p_proveedor: v.proveedor_id,
    p_codigo: v.codigo_proveedor,
    p_descripcion: v.descripcion_proveedor,
    p_articulo: v.articulo_id,
  })
  if (error) fallar(error)
  return data as EquivalenciaProveedor
}

export const listarSalas = () => listar<SalaElectrica>('salas_electricas', 'nombre')
export const crearSala = (v: Omit<SalaElectrica, 'id'>) => crear<SalaElectrica>('salas_electricas', v)
export const actualizarSala = (id: string, v: Partial<SalaElectrica>) =>
  actualizar<SalaElectrica>('salas_electricas', id, v)
// Sin `eliminarSala`: no se pidió y las salas eléctricas quedan fuera de alcance.

export const listarTrabajadores = () => listar<Trabajador>('trabajadores', 'nombre')
export const crearTrabajador = (v: Omit<Trabajador, 'id'>) =>
  crear<Trabajador>('trabajadores', { ...v, rut: formatearRut(v.rut) })
export const actualizarTrabajador = (id: string, v: Partial<Trabajador>) => {
  const payload = { ...v }
  if (payload.rut) payload.rut = formatearRut(payload.rut)
  return actualizar<Trabajador>('trabajadores', id, payload)
}
export const eliminarTrabajador = (id: string) => eliminar('trabajadores', id)

export const listarBodegas = () => listar<Bodega>('bodegas', 'nombre')
export const crearBodega = (nombre: string) => crear<Bodega>('bodegas', { nombre: nombre.trim() })
export const actualizarBodega = (id: string, v: Partial<Bodega>) => actualizar<Bodega>('bodegas', id, v)
export const eliminarBodega = (id: string) => eliminar('bodegas', id)

/**
 * En el orden en que se crearon: los tres de siempre (Material, EPP, Activo)
 * primero, los que agregue el usuario después, en el orden en que los agregó.
 */
export const listarTiposArticulo = () => listar<TipoArticuloCatalogo>('tipos_articulo', 'creado_en')

/** `codigo` lo calcula la base a partir del nombre — ver `normalizar_codigo_tipo_articulo`. */
export const crearTipoArticulo = (v: { nombre: string; color: string }) =>
  crear<TipoArticuloCatalogo>('tipos_articulo', v)

// --- Usuarios del Supabase VIEJO de Bodega -----------------------------------
//
// Lo de aquí abajo administra la tabla `perfiles` del proyecto ANTIGUO de
// Bodega (jmvgtlwrlpidovotvlfr) — el sistema de roles/usuarios propio que
// tenía Bodega como app standalone, con su propio login (no portado). NO es
// lo mismo que `usuario.rol_bodega` de Unificador-QR (ver
// `@/types/index` y `../../permisos`): esa es la fuente de verdad para qué
// puede hacer la persona que ya inició sesión en Unificador-QR; esta tabla es
// un catálogo administrativo aparte que sigue viviendo en el proyecto viejo
// mientras no se ejecute la Fase 3/4 (fusión de esquema y de login). La
// pantalla Catálogos → Usuarios administra el primero; el gate real de acceso
// al módulo lo decide el segundo.

/** Fila de `perfiles` en el Supabase VIEJO de Bodega. Desaparece con la Fase 3/4. */
export interface PerfilBodegaAntiguo {
  id: string
  nombre: string
  rol: RolBodega
  activo: boolean
  creado_en: string
  /** La bodega elegida al entrar, en el sistema viejo. Sin relación con el `useState` local de `Bodega.tsx`. */
  bodega_actual_id: string | null
}

export const listarPerfiles = () => listar<PerfilBodegaAntiguo>('perfiles', 'nombre')

/**
 * Cambia el rol de un usuario. El llamador debe haber comprobado antes que no
 * está dejando al sistema sin ningún administrador activo — ver
 * `esElUltimoAdmin`. La base no lo impide: es una regla de operación, no de
 * integridad, y bloquearla en un trigger dejaría a un proyecto nuevo sin forma
 * de recuperarse.
 */
export const cambiarRol = (id: string, rol: RolBodega) => actualizar<PerfilBodegaAntiguo>('perfiles', id, { rol })

export const cambiarActivo = (id: string, activo: boolean) =>
  actualizar<PerfilBodegaAntiguo>('perfiles', id, { activo })

/**
 * Fija la bodega de trabajo del usuario actual EN EL PROYECTO VIEJO. No se usa
 * en esta fase: `Bodega.tsx` maneja `bodegaActualId` con un `useState` local
 * (ver el plan, sección 3) para no depender de una sesión autenticada contra
 * este proyecto, que ya no existe desde que Bodega dejó de tener su propio
 * login. Se deja escrita para cuando la Fase 3/4 decida si algo de este RPC
 * se reaprovecha contra el proyecto de Unificador-QR.
 */
export async function fijarBodegaActual(bodegaId: string): Promise<PerfilBodegaAntiguo> {
  const { data, error } = await obtenerSupabaseBodega().rpc('fijar_bodega_actual', { p_bodega: bodegaId })
  if (error) fallar(error)
  return data as PerfilBodegaAntiguo
}

/** ¿Este perfil es el único ADMIN activo que queda? */
export function esElUltimoAdmin(perfiles: PerfilBodegaAntiguo[], id: string): boolean {
  const admins = perfiles.filter((p) => p.rol === RolBodega.ADMIN && p.activo)
  return admins.length === 1 && admins[0].id === id
}
