// ============ ENUMS ============

export enum UserRole {
  COORDINADOR = 'coordinador',
  APR = 'apr',
  SUPERVISOR = 'supervisor',
  CONSULTOR = 'consultor',
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
