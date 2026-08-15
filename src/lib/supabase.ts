import { createClient } from '@supabase/supabase-js'

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
  async signUp(email: string, password: string, nombre: string, rol: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })

    if (error) throw error

    if (data.user) {
      // Crear perfil de usuario en tabla usuarios
      const { error: profileError } = await supabase
        .from('usuarios')
        .insert([
          {
            id: data.user.id,
            email,
            nombre,
            rol,
          },
        ])

      if (profileError) throw profileError
    }

    return data
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

  // A diferencia de las fotos/PDF individuales (upsert:false, nunca se sobrescriben),
  // el compilado de un día SÍ debe poder regenerarse y reemplazar la versión anterior.
  async subirCompilado(path: string, file: Blob) {
    const { data, error } = await supabase.storage
      .from('documentos')
      .upload(path, file, { cacheControl: '3600', upsert: true, contentType: 'application/pdf' })

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
