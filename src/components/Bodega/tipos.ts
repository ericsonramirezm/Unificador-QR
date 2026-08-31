/**
 * Tipos del dominio de bodega. Reflejan el esquema de Supabase de Bodega.
 * Si cambias uno, cambia también la migración correspondiente — la base es la
 * fuente de verdad, esto es su espejo en TypeScript.
 *
 * `RolUsuario`/`Perfil` del `types/domain.ts` original NO viven aquí: el rol
 * ahora es `Usuario.rol_bodega` (`RolBodega`, en `@/types/index`) y las
 * funciones de permiso están en `./permisos`. La única excepción es
 * `PerfilBodegaAntiguo`, en `lib/servicios/catalogos.ts` — la fila de la
 * tabla `perfiles` del Supabase VIEJO de Bodega, que sigue existiendo allá
 * mientras este módulo no migre (Fase 3/4).
 */

/**
 * Qué clase de cosa es: el `codigo` de una fila de `tipos_articulo`. Ya no es
 * una unión cerrada — el usuario puede crear tipos nuevos además de los tres
 * de siempre (Material, EPP, Activo) — así que es un valor opaco de servidor,
 * comparado por igualdad, nunca enumerado en el cliente. `EPP` es el único que
 * admite `ENTREGA_EPP` (ver `pages/Epp.tsx`); los tipos nuevos se comportan
 * siempre como Material.
 */
export type TipoArticulo = string

/** Fila de `tipos_articulo`: el catálogo de tipos, con su etiqueta y color. */
export interface TipoArticuloCatalogo {
  codigo: string
  nombre: string
  /** Clase completa de Tailwind, de una paleta fija — ver `PALETA_COLOR_TIPO`. */
  color: string
  activo: boolean
}
export type TipoDocumento = 'GUIA_DESPACHO' | 'ORDEN_COMPRA'
export type EstadoSerie = 'EN_BODEGA' | 'ENTREGADO' | 'DEVUELTO' | 'BAJA'

/**
 * Los seis tipos de movimiento. El signo sobre el stock lo pone el tipo, nunca
 * el signo de la cantidad — salvo en AJUSTE, el único que admite negativos.
 */
export type TipoMovimiento =
  | 'ENTRADA'
  | 'SALIDA_SALA'
  | 'ENTREGA_EPP'
  | 'DEVOLUCION'
  | 'TRASLADO'
  | 'AJUSTE'

export interface Bodega {
  id: string
  nombre: string
  activo: boolean
}

export interface Articulo {
  id: string
  codigo_defontana: string
  descripcion: string
  tipo: TipoArticulo
  unidad: string
  marca: string | null
  familia: string | null
  controla_serie: boolean
  stock_minimo: number
  activo: boolean
  creado_en: string
  /**
   * Rutas dentro del bucket público `fotos-articulos`. **No se escriben con un
   * `update` normal**: el bodeguero no tiene ese permiso sobre `articulos`. Van
   * por el RPC `fijar_foto_articulo`, y por eso quedan fuera de `DatosArticulo`.
   */
  foto_path: string | null
  foto_miniatura_path: string | null
}

export interface Proveedor {
  id: string
  rut: string | null
  nombre: string
  activo: boolean
}

/**
 * A qué artículo Defontana corresponde el código con que un proveedor
 * identifica ese mismo material. Ayuda de búsqueda para la Recepción, sin
 * relación con el libro de movimientos.
 */
export interface EquivalenciaProveedor {
  id: string
  proveedor_id: string
  codigo_proveedor: string
  descripcion_proveedor: string | null
  articulo_id: string
  creado_en: string
}

export interface SalaElectrica {
  id: string
  codigo: string | null
  nombre: string
  activo: boolean
}

export interface Trabajador {
  id: string
  rut: string
  nombre: string
  cargo: string | null
  activo: boolean
}

/**
 * De dónde viene lo que entra. El caso normal es `TRASLADO_INTERNO`: las guías
 * reales del contrato las emite WILUG a WILUG, desde la bodega central de
 * Coquimbo a la faena, con total $0. La compra a un proveedor externo existe,
 * pero es la excepción.
 */
export type OrigenDocumento = 'TRASLADO_INTERNO' | 'COMPRA_EXTERNA'

export interface Documento {
  id: string
  tipo: TipoDocumento
  folio: string
  origen: OrigenDocumento
  origen_nombre: string | null
  /** La bodega real de la que viene un traslado interno — dispara el descuento. */
  origen_bodega_id: string | null
  proveedor_id: string | null
  fecha: string
  orden_compra: string | null
  archivo_path: string | null
}

export const ETIQUETA_ORIGEN: Record<OrigenDocumento, string> = {
  TRASLADO_INTERNO: 'Traslado interno',
  COMPRA_EXTERNA: 'Compra a proveedor',
}

/** Fila de `v_stock`: saldo por artículo y bodega, con el aviso de mínimo. */
export interface FilaStock {
  articulo_id: string
  codigo_defontana: string
  descripcion: string
  tipo: TipoArticulo
  unidad: string
  marca: string | null
  familia: string | null
  controla_serie: boolean
  stock_minimo: number
  activo: boolean
  bodega_id: string
  bodega: string
  cantidad: number
  bajo_minimo: boolean
  foto_path: string | null
  foto_miniatura_path: string | null
}

/** Fila de `v_movimientos`: la línea de tiempo, ya desnormalizada. */
export interface FilaMovimiento {
  id: string
  folio: number
  tipo: TipoMovimiento
  fecha: string
  creado_en: string
  bodega_id: string
  bodega: string
  bodega_destino_id: string | null
  bodega_destino: string | null
  sala_id: string | null
  sala: string | null
  trabajador_id: string | null
  trabajador: string | null
  trabajador_rut: string | null
  documento_id: string | null
  documento_tipo: TipoDocumento | null
  documento_folio: string | null
  documento_fecha: string | null
  orden_compra: string | null
  archivo_path: string | null
  proveedor_id: string | null
  proveedor: string | null
  retirado_por: string | null
  retirado_por_id: string | null
  retirado_por_nombre: string | null
  origen: OrigenDocumento | null
  origen_nombre: string | null
  motivo: string | null
  observacion: string | null
  registrado_por: string | null
  n_lineas: number
  total_unidades: number
  /** La cantidad recibida no calza con la declarada en la guía. */
  tiene_diferencia: boolean
  /** Si este movimiento ES una anulación, el original al que anula. */
  anula_movimiento_id: string | null
  anula_folio: number | null
  /** Si a este movimiento ya lo anuló otro. */
  anulado_por_id: string | null
  anulado_por_folio: number | null
  origen_bodega_id: string | null
  /** Si no es null, se le agregaron líneas después de creado (ver `agregar_lineas_recepcion`). */
  editado_en: string | null
  editado_por: string | null
  editado_por_nombre: string | null
}

/** Fila de `v_movimiento_lineas`. */
export interface FilaLinea {
  id: string
  movimiento_id: string
  movimiento_tipo: TipoMovimiento
  fecha: string
  articulo_id: string
  codigo_defontana: string
  descripcion: string
  articulo_tipo: TipoArticulo
  unidad: string
  marca: string | null
  cantidad: number
  cantidad_guia: number | null
  diferencia: number | null
  costo_unitario: number | null
  observacion: string | null
  series: string[]
}

/** Fila de `v_series`: dónde está cada unidad serializada ahora mismo. */
export interface FilaSerie {
  id: string
  numero_serie: string
  estado: EstadoSerie
  articulo_id: string
  codigo_defontana: string
  descripcion: string
  bodega_id: string | null
  bodega: string | null
  sala_id: string | null
  sala: string | null
  trabajador_id: string | null
  trabajador: string | null
  ubicacion_actual: string | null
}

// --- Pendientes por cobrar ---------------------------------------------------

export type MotivoResolucion = 'LLEGO_DESPUES' | 'MERMA_ACEPTADA' | 'ERROR_GUIA'

export const ETIQUETA_MOTIVO: Record<MotivoResolucion, string> = {
  LLEGO_DESPUES: 'Llegó después',
  MERMA_ACEPTADA: 'Merma aceptada',
  ERROR_GUIA: 'Error de la guía',
}

/**
 * Fila de `v_pendientes`. El pendiente **se deriva del libro** (recibido menor
 * que lo declarado en la guía); lo único guardado es su resolución.
 */
export interface FilaPendiente {
  linea_id: string
  movimiento_id: string
  movimiento_folio: number
  fecha: string
  guia_folio: string | null
  origen: OrigenDocumento | null
  origen_nombre: string | null
  proveedor: string | null
  articulo_id: string
  codigo_defontana: string
  descripcion: string
  unidad: string
  cantidad_guia: number
  cantidad_recibida: number
  cantidad_faltante: number
  dias_abierto: number
  motivo: MotivoResolucion | null
  nota: string | null
  resuelto_en: string | null
  resuelto_por_nombre: string | null
  /** `true` mientras nadie lo haya cerrado. */
  pendiente: boolean
}

// --- Entrada de `registrar_movimiento` ---------------------------------------

export interface LineaMovimiento {
  articulo_id: string
  /** Magnitud positiva; solo AJUSTE admite negativo. */
  cantidad: number
  /** Lo declarado en la guía. El stock se calcula con `cantidad`, no con esto. */
  cantidad_guia?: number | null
  costo_unitario?: number | null
  observacion?: string | null
  /** Obligatorio y exacto (una por unidad) si el artículo controla serie. */
  series?: string[]
}

/** Cabecera de la guía con la que llega el material. */
export interface NuevaGuia {
  folio: string
  fecha?: string
  origen: OrigenDocumento
  /** Obligatoria si `origen` es `TRASLADO_INTERNO`: la bodega que despacha. El nombre lo calcula el servidor. */
  origen_bodega_id?: string | null
  proveedor_id?: string | null
  orden_compra?: string | null
}

/**
 * Una recepción completa: la guía y sus líneas. Se manda entera al RPC
 * `registrar_recepcion`, que crea documento y movimiento en la misma
 * transacción — nunca en dos pasos desde el navegador.
 */
export interface NuevaRecepcion {
  documento: NuevaGuia
  bodega_id: string
  observacion?: string | null
  lineas: LineaMovimiento[]
}

export interface NuevoMovimiento {
  tipo: TipoMovimiento
  bodega_id: string
  fecha?: string
  documento_id?: string | null
  sala_id?: string | null
  trabajador_id?: string | null
  bodega_destino_id?: string | null
  /** Trabajador de la nómina que retira el material de una salida a sala. */
  retirado_por_id?: string | null
  /** Nombre suelto, para quien retira y no está en la nómina. */
  retirado_por?: string | null
  motivo?: string | null
  observacion?: string | null
  lineas: LineaMovimiento[]
}

// --- Etiquetas y colores de los tipos de movimiento ---------------------------

export const ETIQUETA_MOVIMIENTO: Record<TipoMovimiento, string> = {
  ENTRADA: 'Entrada',
  SALIDA_SALA: 'Salida a sala',
  ENTREGA_EPP: 'Entrega de EPP',
  DEVOLUCION: 'Devolución',
  TRASLADO: 'Traslado',
  AJUSTE: 'Ajuste',
}

/** Signo que cada tipo aplica sobre la bodega de origen. Espeja el SQL. */
export const SIGNO_MOVIMIENTO: Record<TipoMovimiento, '+' | '-' | '±'> = {
  ENTRADA: '+',
  DEVOLUCION: '+',
  SALIDA_SALA: '-',
  ENTREGA_EPP: '-',
  TRASLADO: '-',
  AJUSTE: '±',
}

export const COLOR_MOVIMIENTO: Record<TipoMovimiento, string> = {
  ENTRADA: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  DEVOLUCION: 'bg-teal-100 text-teal-800 ring-teal-200',
  SALIDA_SALA: 'bg-blue-100 text-blue-800 ring-blue-200',
  ENTREGA_EPP: 'bg-violet-100 text-violet-800 ring-violet-200',
  TRASLADO: 'bg-amber-100 text-amber-800 ring-amber-200',
  AJUSTE: 'bg-slate-200 text-slate-700 ring-slate-300',
}
