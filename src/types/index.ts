// ============ ENUMS ============

export enum UserRole {
  COORDINADOR = 'coordinador',
  APR = 'apr',
  SUPERVISOR = 'supervisor',
  CONSULTOR = 'consultor',
  // Persona de la empresa mandante (ver contratos.mandante) que comenta/
  // aprueba el Daily Report después de enviado. No ve Documentos QR.
  MANDANTE = 'mandante',
}

export enum UserStatus {
  ACTIVO = 'activo',
  INACTIVO = 'inactivo',
}

export enum DocumentType {
  PROTOCOLO = 'Protocolo',
  IRL = 'IRL',
  CERTIFICADO = 'Certificado',
  REGISTRO_FOTOGRAFICO = 'Registro Fotográfico',
  ESTADO_PAGO = 'Estado de Pago',
  INFORME = 'Informe',
  SOLICITUD_COMPRA = 'Solicitud de Compra',
  MATRIZ_CAPACITACION = 'Matriz Capacitación',
  FORMULARIO_RRHH = 'Formulario RRHH',
}

export enum Priority {
  ALTA = 'Alta',
  MEDIA = 'Media',
  BAJA = 'Baja',
}

export enum DocumentStatus {
  PENDIENTE = 'pendiente',
  REVISION = 'revision',
  APROBADO = 'aprobado',
  RECHAZADO = 'rechazado',
}

export enum HistorialAction {
  CREADO = 'creado',
  COMENTARIO = 'comentario',
  APROBADO = 'aprobado',
  RECHAZADO = 'rechazado',
  REORDENADO = 'reordenado',
  ELIMINADO = 'eliminado',
}

// ============ INTERFACES ============

export interface Usuario {
  id: string;
  email: string;
  nombre: string;
  rol: UserRole;
  estado: UserStatus;
  created_at: string;
  updated_at: string;
}

export interface Contrato {
  id: string;
  codigo: string;
  nombre: string;
  mandante?: string;
  descripcion?: string;
  estado: 'activo' | 'inactivo';
  created_at: string;
  updated_at: string;
}

export interface Documento {
  id: string;
  contrato_id: string;
  creado_por: string;
  aprobado_por?: string;

  tipo: DocumentType | string;
  titulo: string;
  descripcion?: string;
  prioridad: Priority;

  estado: DocumentStatus;

  foto_url?: string;
  pdf_url?: string;

  // Orden manual dentro del día (sin valor: Coordinador primero, luego por
  // fecha de carga — ver src/lib/orden.ts)
  orden?: number | null;

  comentario_rechazo?: string;

  fecha_creacion: string;
  fecha_aprobacion?: string;
  created_at: string;
  updated_at: string;

  usuario_creador?: Usuario;
  usuario_aprobador?: Usuario;
}

export interface HistorialEntry {
  id: string;
  documento_id: string;
  usuario_id: string;
  accion: HistorialAction;
  detalle?: string;
  created_at: string;

  usuario?: Usuario;
}

export interface Config {
  id: string;
  clave: string;
  valor?: string;
  created_at: string;
  updated_at: string;
}

export interface AuthContext {
  usuario?: Usuario;
  token?: string;
  isLoading: boolean;
  error?: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

export interface UploadRequest {
  contrato_id: string;
  tipo: DocumentType | string;
  titulo: string;
  descripcion?: string;
  prioridad: Priority;
  archivo: Blob;
}

export interface PDFGenerationOptions {
  imagenBlob: Blob;
  fecha: Date;
  titulo?: string;
}

export interface QRData {
  fecha: string;
  documento_id: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
  success: boolean;
}

export interface FiltrosDocumento {
  tipo?: string;
  prioridad?: Priority;
  estado?: DocumentStatus;
  busqueda?: string;
  desde?: Date;
  hasta?: Date;
  creado_por?: string;
}

// ============ PARTE DIARIO ============
// Ver MAPEO_CAMPOS.md (sesión de arquitectura) para el detalle celda por
// celda del Excel que estas estructuras terminan alimentando.

export enum ParteDiarioEstado {
  BORRADOR = 'borrador',
  ENVIADO = 'enviado',
  COMENTADO_MANDANTE = 'comentado_mandante',
}

export interface ActividadEjecutada {
  area: string;
  descripcion: string;
  cantidad: number | null;
}

export interface LineaManoObra {
  cargo: string;
  contratados: number;
  operativos: number;
  // Solo mano de obra directa reparte horas por actividad (hasta 7, Act.1..Act.7)
  horas_por_actividad?: number[];
}

export interface LineaMaquinaria {
  equipo: string;
  cantidad: number;
  mantencion: number;
  standby: number;
  horas_por_actividad: number[];
}

export interface Jornada {
  inicio: string | null; // HH:mm
  fin: string | null;
  horas_efectivas: { entrada: string | null; salida: string | null };
  horas_perdidas: { entrada: string | null; salida: string | null };
}

export interface FotoParteDiario {
  url: string;
  caption?: string;
}

export interface ParteDiario {
  id: string;
  contrato_id: string;

  numero_reporte: number;
  fecha: string; // YYYY-MM-DD
  condicion_climatica?: string;

  actividades: ActividadEjecutada[];
  mano_obra_directa: LineaManoObra[];
  mano_obra_indirecta: LineaManoObra[];
  maquinaria: LineaMaquinaria[];

  jornada?: Jornada;

  hh_directas_programado: number;
  hh_indirectas_programado: number;

  hh_directas_acumuladas?: number;
  hm_acumuladas?: number;
  hh_indirectas_acumuladas?: number;

  fotos: FotoParteDiario[];

  comentario_contratista_autor?: string;
  comentario_contratista?: string;

  comentario_mandante_autor?: string;
  comentario_mandante?: string;
  comentario_mandante_por?: string;
  comentario_mandante_fecha?: string;

  estado: ParteDiarioEstado;
  excel_url?: string;

  creado_por: string;
  created_at: string;
  updated_at: string;

  usuario_creador?: Usuario;
}

// Listas fijas de cargos/equipos del contrato 12501191 (ver MAPEO_CAMPOS.md).
// Si el día de mañana hay más de un contrato con Daily Report y su propia
// lista de cargos, esto pasa a vivir en la tabla `contratos` (columna
// jsonb) en vez de quedar hardcodeado acá.
export const CARGOS_DIRECTOS = [
  'Capataz', 'Soldador', 'Termofusionador', 'Maestro Mayor', 'Rigger',
  'Maestro Mayor Eléctrico', 'Maestro M1', 'Maestro M2 Carpintero', 'Ayudante',
  'Maestro Mayor Estructuras', 'Maestro 1ra Eléctrico', 'Técnico Montajista',
] as const;

export const CARGOS_INDIRECTOS = [
  'Administrador de Contrato', 'Jefe de Oficina Técnica', 'Ingeniero de Calidad',
  'Jefe de Terreno', 'Supervisor', 'Asesor SSOMA', 'Administrativo',
  'Logística', 'Conductor', 'Topógrafo', 'Coordinador de Terreno',
] as const;

export const EQUIPOS_MAQUINARIA = [
  'Camión Tolva 20 m3', 'Camión Aljibe', 'Excavadora 30 ton', 'Retroexcavadora',
  'Mini Excavadora', 'Martillo Excavadora', 'Rodillo Compactador 10Ton',
  'Rodillo Compactador Manual', 'Tijera Eléctrica h=5mt', 'Camión Pluma',
  'Camión Rampla', 'Grúa 90 ton.', 'Alza Hombre 15 mt', 'Grupo Electrógeno 20kva',
  'Generador 10kva',
] as const;
