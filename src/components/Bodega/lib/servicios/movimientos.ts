import { mensajeDeError } from '../errores'
import { obtenerSupabaseBodega } from '../supabaseBodega'
import type {
  FilaLinea,
  FilaMovimiento,
  FilaPendiente,
  FilaSerie,
  FilaStock,
  LineaMovimiento,
  MotivoResolucion,
  NuevaRecepcion,
  NuevoMovimiento,
  TipoArticulo,
  TipoMovimiento,
} from '../../tipos'

/**
 * Escrituras del libro de inventario.
 *
 * **Nada de esto hace `INSERT` directo.** Todo pasa por las funciones de
 * Postgres, que son las que validan rol, saldo y series dentro de una
 * transacción. El privilegio de escritura sobre `movimientos` está revocado, así
 * que un intento directo desde aquí fallaría de todos modos — y así debe seguir.
 */

function fallar(e: unknown): never {
  throw new Error(mensajeDeError(e))
}

export interface ResultadoMovimiento {
  movimiento_id: string
  folio: number
}

/** Recepción completa: crea la guía y su entrada en una sola operación atómica. */
export async function registrarRecepcion(r: NuevaRecepcion): Promise<ResultadoMovimiento> {
  const { data, error } = await obtenerSupabaseBodega().rpc('registrar_recepcion', { p: r })
  if (error) fallar(error)
  return data as ResultadoMovimiento
}

/** Cualquier otro movimiento (salidas, EPP, devoluciones, traslados, ajustes). */
export async function registrarMovimiento(m: NuevoMovimiento): Promise<ResultadoMovimiento> {
  const { data, error } = await obtenerSupabaseBodega().rpc('registrar_movimiento', { p: m })
  if (error) fallar(error)
  return data as ResultadoMovimiento
}

/**
 * Suma líneas nuevas a una recepción (ENTRADA o traslado con guía) ya guardada,
 * bajo el mismo folio — nunca toca las líneas que ya existían. Excepción
 * acotada y deliberada a que el libro es de solo inserción: ver
 * `agregar_lineas_recepcion` en la migración 0017.
 */
export async function agregarLineasRecepcion(
  movimientoId: string,
  lineas: LineaMovimiento[],
): Promise<ResultadoMovimiento> {
  const { data, error } = await obtenerSupabaseBodega().rpc('agregar_lineas_recepcion', {
    p_movimiento_id: movimientoId,
    p_lineas: lineas,
  })
  if (error) fallar(error)
  return data as ResultadoMovimiento
}

/**
 * Anula un movimiento por contramovimiento: registra el inverso enlazado por
 * `anula_movimiento_id`. El original nunca se toca. Solo ADMIN, con motivo.
 */
export async function anularMovimiento(id: string, motivo: string): Promise<FilaMovimientoCabecera> {
  const { data, error } = await obtenerSupabaseBodega().rpc('anular_movimiento', { p_movimiento: id, p_motivo: motivo })
  if (error) fallar(error)
  return data as FilaMovimientoCabecera
}

/** Lo que devuelve `anular_movimiento`: la fila cruda de `movimientos`, no la vista. */
export interface FilaMovimientoCabecera {
  id: string
  folio: number
}

/**
 * Borra un movimiento y sus líneas de verdad — sin rastro, sin poder deshacerlo.
 * Solo ADMIN; rechaza sobre una anulación, un movimiento ya anulado, o uno con
 * artículos de número de serie. Ver `eliminar_movimiento` en la migración 0018.
 */
export async function eliminarMovimiento(id: string): Promise<void> {
  const { error } = await obtenerSupabaseBodega().rpc('eliminar_movimiento', { p_movimiento_id: id })
  if (error) fallar(error)
}

// --- Consultas ---------------------------------------------------------------

export interface FiltroStock {
  texto?: string
  tipo?: TipoArticulo | 'TODOS'
  soloBajoMinimo?: boolean
  bodegaId?: string
}

/** Filtros comunes a la lista y a los conteos, para que no puedan divergir. */
function consultaStock(f: FiltroStock, seleccion: string, opciones?: { count: 'exact'; head: true }) {
  let q = obtenerSupabaseBodega().from('v_stock').select(seleccion, opciones).eq('activo', true)

  if (f.bodegaId) q = q.eq('bodega_id', f.bodegaId)
  if (f.tipo && f.tipo !== 'TODOS') q = q.eq('tipo', f.tipo)
  if (f.soloBajoMinimo) q = q.eq('bajo_minimo', true)

  const texto = f.texto?.trim()
  if (texto) {
    const patron = `%${texto.replace(/[%_]/g, '\\$&')}%`
    q = q.or(`codigo_defontana.ilike.${patron},descripcion.ilike.${patron},marca.ilike.${patron}`)
  }
  return q
}

export async function listarStock(f: FiltroStock = {}): Promise<FilaStock[]> {
  const { data, error } = await consultaStock(f, '*').order('codigo_defontana').limit(500)
  if (error) fallar(error)
  return (data ?? []) as unknown as FilaStock[]
}

export interface ConteoStock {
  /** Artículos con ficha de stock que cumplen la búsqueda. */
  total: number
  /** De esos, cuántos están bajo su mínimo. */
  criticos: number
}

/**
 * Conteos para los marcadores de la pantalla de Stock.
 *
 * Se piden a la base con `count: exact` en vez de contar sobre la lista ya
 * traída: `listarStock` corta en 500 filas, así que contar ahí daría un número
 * correcto hoy y equivocado en cuanto el catálogo crezca — justo cuando más se
 * mira. Un marcador que miente es peor que no tenerlo: con él se decide qué
 * reponer.
 */
export async function contarStock(f: FiltroStock = {}): Promise<ConteoStock> {
  const base = { ...f, soloBajoMinimo: false }
  const [todos, criticos] = await Promise.all([
    consultaStock(base, 'articulo_id', { count: 'exact', head: true }),
    consultaStock({ ...base, soloBajoMinimo: true }, 'articulo_id', { count: 'exact', head: true }),
  ])
  if (todos.error) fallar(todos.error)
  if (criticos.error) fallar(criticos.error)
  return { total: todos.count ?? 0, criticos: criticos.count ?? 0 }
}

/** Últimos movimientos, para la línea de tiempo y las fichas. */
export async function listarMovimientos(limite = 50): Promise<FilaMovimiento[]> {
  const { data, error } = await obtenerSupabaseBodega()
    .from('v_movimientos')
    .select('*')
    .order('creado_en', { ascending: false })
    .limit(limite)
  if (error) fallar(error)
  return (data ?? []) as FilaMovimiento[]
}

// --- Línea de tiempo con filtros ---------------------------------------------

export interface FiltroMovimientos {
  desde?: string
  hasta?: string
  tipo?: TipoMovimiento | 'TODOS'
  /** Busca en los datos de la CABECERA, no en las líneas. */
  texto?: string
  /** Filtra por un artículo concreto; se resuelve en dos pasos (ver abajo). */
  articuloId?: string | null
  soloConDiferencia?: boolean
  /** Por defecto, un movimiento anulado y su reverso quedan ocultos. */
  mostrarAnulados?: boolean
  limite?: number
}

/**
 * Movimientos en los que participó un artículo.
 *
 * El Código Defontana es propiedad de las LÍNEAS, no de la cabecera, así que no
 * cabe en el mismo `ILIKE` que el resto de la búsqueda. Se resuelve en dos pasos:
 * primero qué movimientos tocaron ese artículo, después se filtra la línea de
 * tiempo por esos identificadores. Ambas consultas van por índice.
 *
 * La alternativa —una vista que concentre el texto de todas las líneas de cada
 * movimiento— obligaría a calcular esa agregación sobre la tabla entera antes de
 * poder filtrar nada.
 */
async function movimientosDeArticulo(articuloId: string, limite = 500): Promise<string[]> {
  const { data, error } = await obtenerSupabaseBodega()
    .from('movimiento_lineas')
    .select('movimiento_id')
    .eq('articulo_id', articuloId)
    .limit(limite)
  if (error) fallar(error)
  return [...new Set((data ?? []).map((l: { movimiento_id: string }) => l.movimiento_id))]
}

function consultaMovimientos(f: FiltroMovimientos, seleccion: string, opciones?: { count: 'exact'; head: true }) {
  let q = obtenerSupabaseBodega().from('v_movimientos').select(seleccion, opciones)

  if (f.desde) q = q.gte('fecha', f.desde)
  if (f.hasta) q = q.lte('fecha', f.hasta)
  if (f.tipo && f.tipo !== 'TODOS') q = q.eq('tipo', f.tipo)
  if (f.soloConDiferencia) q = q.eq('tiene_diferencia', true)
  // Oculto por defecto: una fila desaparece tanto si ES una anulación como si
  // YA FUE anulada. No se borra nada de la base — es solo lo que se muestra.
  if (!f.mostrarAnulados) q = q.is('anula_movimiento_id', null).is('anulado_por_id', null)

  const texto = f.texto?.trim()
  if (texto) {
    const patron = `%${texto.replace(/[%_]/g, '\\$&')}%`
    q = q.or(
      [
        `documento_folio.ilike.${patron}`,
        `proveedor.ilike.${patron}`,
        `sala.ilike.${patron}`,
        `trabajador.ilike.${patron}`,
        `retirado_por_nombre.ilike.${patron}`,
        `origen_nombre.ilike.${patron}`,
        `observacion.ilike.${patron}`,
        `motivo.ilike.${patron}`,
        `orden_compra.ilike.${patron}`,
      ].join(','),
    )
  }
  return q
}

export async function buscarMovimientos(f: FiltroMovimientos = {}): Promise<FilaMovimiento[]> {
  let q = consultaMovimientos(f, '*')

  if (f.articuloId) {
    const ids = await movimientosDeArticulo(f.articuloId)
    // Sin coincidencias no hay nada que mostrar: devolver sin filtro traería
    // TODOS los movimientos, que es exactamente lo contrario de lo pedido.
    if (ids.length === 0) return []
    q = q.in('id', ids)
  }

  const { data, error } = await q
    .order('fecha', { ascending: false })
    .order('folio', { ascending: false })
    .limit(f.limite ?? 300)
  if (error) fallar(error)
  return (data ?? []) as unknown as FilaMovimiento[]
}

export interface ResumenPeriodo {
  entradas: number
  salidas: number
  eppEntregado: number
  conDiferencia: number
}

/** Indicadores del rango filtrado, para el tablero de Movimientos. */
export async function resumenPeriodo(f: FiltroMovimientos = {}): Promise<ResumenPeriodo> {
  const base: FiltroMovimientos = { ...f, tipo: 'TODOS', soloConDiferencia: false }
  const contar = async (extra: Partial<FiltroMovimientos>) => {
    const q = consultaMovimientos({ ...base, ...extra }, 'id', { count: 'exact', head: true })
    const { count, error } = await q
    if (error) fallar(error)
    return count ?? 0
  }

  const [entradas, salidas, eppEntregado, conDiferencia] = await Promise.all([
    contar({ tipo: 'ENTRADA' }),
    contar({ tipo: 'SALIDA_SALA' }),
    contar({ tipo: 'ENTREGA_EPP' }),
    contar({ soloConDiferencia: true }),
  ])
  return { entradas, salidas, eppEntregado, conDiferencia }
}

// --- Pendientes por cobrar ---------------------------------------------------

export async function listarPendientes(soloAbiertos = true): Promise<FilaPendiente[]> {
  let q = obtenerSupabaseBodega().from('v_pendientes').select('*')
  if (soloAbiertos) q = q.eq('pendiente', true)

  const { data, error } = await q.order('fecha', { ascending: false })
  if (error) fallar(error)
  return (data ?? []) as FilaPendiente[]
}

/**
 * Cierra un faltante. No modifica el movimiento: escribe un hecho nuevo en
 * `resoluciones_pendiente`, y la vista lo refleja al instante.
 */
export async function resolverPendiente(
  lineaId: string,
  motivo: MotivoResolucion,
  nota: string | null,
): Promise<void> {
  const supabase = obtenerSupabaseBodega()
  const { data: sesion } = await supabase.auth.getUser()
  const { error } = await supabase.from('resoluciones_pendiente').insert({
    linea_id: lineaId,
    motivo,
    nota: nota?.trim() || null,
    resuelto_por: sesion.user?.id,
  })
  if (error) fallar(error)
}

/** Historial de un artículo: cada línea que lo movió, de la más reciente atrás. */
export async function historialArticulo(articuloId: string, limite = 100): Promise<FilaLinea[]> {
  const { data, error } = await obtenerSupabaseBodega()
    .from('v_movimiento_lineas')
    .select('*')
    .eq('articulo_id', articuloId)
    .order('fecha', { ascending: false })
    .limit(limite)
  if (error) fallar(error)
  return (data ?? []) as FilaLinea[]
}

/** Dónde está cada unidad serializada de un artículo. */
export async function seriesDeArticulo(articuloId: string): Promise<FilaSerie[]> {
  const { data, error } = await obtenerSupabaseBodega()
    .from('v_series')
    .select('*')
    .eq('articulo_id', articuloId)
    .order('numero_serie')
  if (error) fallar(error)
  return (data ?? []) as FilaSerie[]
}

/**
 * Series que se pueden sacar de una bodega. Incluye las devueltas desde terreno:
 * están físicamente en el estante igual que las que nunca salieron.
 */
export async function seriesDisponibles(articuloId: string, bodegaId: string): Promise<FilaSerie[]> {
  const { data, error } = await obtenerSupabaseBodega()
    .from('v_series')
    .select('*')
    .eq('articulo_id', articuloId)
    .eq('bodega_id', bodegaId)
    .in('estado', ['EN_BODEGA', 'DEVUELTO'])
    .order('numero_serie')
  if (error) fallar(error)
  return (data ?? []) as FilaSerie[]
}

/** Series que están en terreno y por lo tanto se pueden devolver. */
export async function seriesEntregadas(
  articuloId: string,
  filtro: { salaId?: string | null; trabajadorId?: string | null } = {},
): Promise<FilaSerie[]> {
  let q = obtenerSupabaseBodega().from('v_series').select('*').eq('articulo_id', articuloId).eq('estado', 'ENTREGADO')
  if (filtro.salaId) q = q.eq('sala_id', filtro.salaId)
  if (filtro.trabajadorId) q = q.eq('trabajador_id', filtro.trabajadorId)

  const { data, error } = await q.order('numero_serie')
  if (error) fallar(error)
  return (data ?? []) as FilaSerie[]
}

/** Qué se instaló en cada sala eléctrica. */
export async function consumoPorSala(salaId: string) {
  const { data, error } = await obtenerSupabaseBodega()
    .from('v_consumo_por_sala')
    .select('*')
    .eq('sala_id', salaId)
    .order('codigo_defontana')
  if (error) fallar(error)
  return data ?? []
}

/** Qué EPP tiene cada trabajador. */
export async function eppDeTrabajador(trabajadorId: string) {
  const { data, error } = await obtenerSupabaseBodega()
    .from('v_epp_por_trabajador')
    .select('*')
    .eq('trabajador_id', trabajadorId)
    .order('codigo_defontana')
  if (error) fallar(error)
  return data ?? []
}

/** Las líneas de un movimiento concreto, para abrir su detalle. */
export async function lineasDeMovimiento(movimientoId: string): Promise<FilaLinea[]> {
  const { data, error } = await obtenerSupabaseBodega()
    .from('v_movimiento_lineas')
    .select('*')
    .eq('movimiento_id', movimientoId)
    .order('codigo_defontana')
  if (error) fallar(error)
  return (data ?? []) as FilaLinea[]
}
