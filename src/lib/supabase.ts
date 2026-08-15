import { createClient } from '@supabase/supabase-js'
import { UserRole } from '@/types/index'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

// TODO: una vez estabilizado el esquema, generar tipos reales con
// `supabase gen types typescript` y tipar createClient<Database>(...)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ============ AUTH HELPERS ============

export const auth = {
  // Auto-registro: el rol NUNCA lo elige quien se registra — siempre queda
  // en Consultor (el rol de menor privilegio), y solo el Coordinador puede
  // subirlo después desde el panel de Usuarios. Esto se refuerza también a
  // nivel de RLS (ver add_registro_usuarios.sql: el "with check" exige
  // rol='consultor' en el insert), así que no basta con cambiar este código
  // para saltárselo.
  //
  // Devuelve `sesionInmediata: false` si el proyecto de Supabase tiene
  // habilitada la confirmación de correo (no hay sesión hasta que el
  // usuario haga clic en el enlace que le llega por email) — la UI debe
  // mostrar un aviso de "revisa tu correo" en ese caso en vez de intentar
  // continuar como si ya hubiera iniciado sesión.
  async signUp(email: string, password: string, nombre: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })

    if (error) throw error

    if (data.user) {
      const { error: profileError } = await supabase
        .from('usuarios')
        .insert([
          {
            id: data.user.id,
            email,
            nombre,
            rol: UserRole.CONSULTOR,
          },
        ])

      if (profileError) throw profileError
    }

    return { user: data.user, sesionInmediata: data.session !== null }
  },

  async signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) throw error
    return data
  },

  async signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  },

  async getCurrentUser() {
    const { data, error } = await supabase.auth.getUser()
    if (error) throw error
    return data.user
  },

  async getUserProfile(userId: string) {
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) throw error
    return data
  },
}

// ============ STORAGE HELPERS ============

export const storage = {
  async uploadFoto(bucket: string, path: string, file: Blob) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false,
      })

    if (error) throw error
    return data
  },

  async getPublicUrl(bucket: string, path: string) {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path)
    return data.publicUrl
  },

  async deleteFoto(bucket: string, path: string) {
    const { error } = await supabase.storage.from(bucket).remove([path])
    if (error) throw error
  },

  async eliminarArchivos(bucket: string, paths: string[]) {
    if (paths.length === 0) return
    const { error } = await supabase.storage.from(bucket).remove(paths)
    if (error) throw error
  },

  // A diferencia de las fotos/PDF individuales (upsert:false, nunca se sobrescriben),
  // el compilado de un día SÍ debe poder regenerarse y reemplazar la versión anterior.
  async subirCompilado(path: string, file: Blob) {
    const { data, error } = await supabase.storage
      .from('documentos')
      .upload(path, file, { cacheControl: '3600', upsert: true, contentType: 'application/pdf' })

    if (error) throw error
    return data
  },

  // Reemplaza un archivo ya subido en su misma ruta (ej. al girar un
  // documento) — a diferencia de uploadFoto, sí sobrescribe lo que había.
  async reemplazarArchivo(bucket: string, path: string, file: Blob, contentType?: string) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, { cacheControl: '3600', upsert: true, contentType })

    if (error) throw error
    return data
  },
}

// ============ DATABASE HELPERS ============

export const db = {
  // Devuelve la siguiente secuencia diaria (1, 2, 3...) para nombrar PDFs,
  // única entre TODOS los usuarios que suban documentos ese día para ese contrato.
  // El incremento es atómico en el servidor (ver migración obtener_siguiente_secuencia_pdf).
  async obtenerSiguienteSecuenciaPDF(contratoId: string, fecha: Date): Promise<number> {
    const fechaISO = fecha.toISOString().slice(0, 10) // YYYY-MM-DD

    const { data, error } = await supabase.rpc('obtener_siguiente_secuencia_pdf', {
      p_contrato_id: contratoId,
      p_fecha: fechaISO,
    })

    if (error) throw error
    return data as number
  },

  // Usuarios (gestión de roles, panel del Coordinador — usa las políticas
  // "coordinador_ver_usuarios"/"coordinador_actualizar_usuarios" de RLS)
  async obtenerUsuarios() {
    const { data, error } = await supabase.from('usuarios').select('*').order('nombre')
    if (error) throw error
    return data
  },

  async actualizarRolUsuario(id: string, rol: UserRole) {
    const { data, error } = await supabase
      .from('usuarios')
      .update({ rol })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Contratos
  async getContratoActivo() {
    const { data, error } = await supabase
      .from('contratos')
      .select('*')
      .eq('estado', 'activo')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error && error.code !== 'PGRST116') throw error
    return data
  },

  // Documentos
  async crearDocumento(documento: any) {
    const { data, error } = await supabase
      .from('documentos')
      .insert([documento])
      .select()
      .single()

    if (error) throw error
    return data
  },

  async obtenerDocumentos(filtros: any) {
    let query = supabase
      .from('documentos')
      .select('*, usuario_creador:creado_por(nombre, email, rol), usuario_aprobador:aprobado_por(nombre, email, rol)')

    if (filtros.estado) query = query.eq('estado', filtros.estado)
    if (filtros.tipo) query = query.eq('tipo', filtros.tipo)
    if (filtros.creado_por) query = query.eq('creado_por', filtros.creado_por)

    const { data, error } = await query.order('fecha_creacion', { ascending: false })

    if (error) throw error
    return data
  },

  async actualizarDocumento(id: string, updates: any) {
    const { data, error } = await supabase
      .from('documentos')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  async eliminarDocumento(id: string) {
    const { error } = await supabase.from('documentos').delete().eq('id', id)
    if (error) throw error
  },

  // Extrae la ruta dentro del bucket a partir de una URL pública de Storage
  // (https://.../storage/v1/object/public/<bucket>/<ruta>), para poder borrar
  // el archivo real, no solo el registro.
  _pathDesdeUrlPublica(url: string, bucket: string): string | null {
    const marcador = `/object/public/${bucket}/`
    const idx = url.indexOf(marcador)
    if (idx === -1) return null
    return decodeURIComponent(url.slice(idx + marcador.length).split('?')[0])
  },

  // Elimina un documento por completo: la foto y el PDF en Storage, y el
  // registro en la base de datos (el historial de auditoría se borra en
  // cascada). Si falla la limpieza de Storage, igual se borra el registro —
  // no queremos que un archivo huérfano bloquee que el documento desaparezca.
  async eliminarDocumentoCompleto(doc: { id: string; foto_url?: string | null; pdf_url?: string | null }) {
    const bucket = 'documentos'
    const paths = [doc.foto_url, doc.pdf_url]
      .map((u) => (u ? db._pathDesdeUrlPublica(u, bucket) : null))
      .filter((p): p is string => !!p)

    if (paths.length > 0) {
      try {
        await storage.eliminarArchivos(bucket, paths)
      } catch (err) {
        console.error('No se pudieron borrar los archivos en Storage:', err)
      }
    }

    const { error } = await supabase.from('documentos').delete().eq('id', doc.id)
    if (error) throw error
  },

  // Invalida el compilado guardado en caché de un día (se usa cuando se borra
  // algún documento de ese día, para que el próximo QR/PDF se regenere sin
  // el documento eliminado en vez de reusar el compilado desactualizado).
  async invalidarCompiladoDia(contratoId: string, fecha: string) {
    const { error } = await supabase
      .from('compilados_dia')
      .delete()
      .eq('contrato_id', contratoId)
      .eq('fecha', fecha)

    if (error) throw error
  },

  // Historial
  async crearHistorial(entrada: any) {
    const { data, error } = await supabase
      .from('historial')
      .insert([entrada])
      .select()
      .single()

    if (error) throw error
    return data
  },

  async obtenerHistorial(documento_id: string) {
    const { data, error } = await supabase
      .from('historial')
      .select('*, usuario:usuario_id(nombre, email)')
      .eq('documento_id', documento_id)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data
  },

  // Caché de compilados por día — evita recompilar/resubir un PDF que ya
  // está al día (ver migración add_cache_compilados.sql)
  async obtenerCompiladosDia(contratoId: string) {
    const { data, error } = await supabase
      .from('compilados_dia')
      .select('*')
      .eq('contrato_id', contratoId)

    if (error) throw error
    return data
  },

  async guardarCompiladoDia(registro: {
    contrato_id: string
    fecha: string
    url: string
    ultima_aprobacion: string
    total_documentos: number
    generado_por?: string | null
  }) {
    const { data, error } = await supabase
      .from('compilados_dia')
      .upsert(registro, { onConflict: 'contrato_id,fecha' })
      .select()
      .single()

    if (error) throw error
    return data
  },
}
