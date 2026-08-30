import { createClient } from '@supabase/supabase-js'
import { UserRole, SolicitudCompra, Requisicion, OrdenCompra } from '@/types/index'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

// TODO: una vez estabilizado el esquema, generar tipos reales con
// `supabase gen types typescript` y tipar createClient<Database>(...)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export interface FiltrosDocumentos {
  contrato_id?: string
  estado?: string
  tipo?: string
  creado_por?: string
  /** Cuántas filas traer. Sin esto, la consulta no pagina. */
  limite?: number
  /** Desde qué fila, para "cargar más". */
  desde?: number
}

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
      // Sin esto, el link del correo de confirmación usa la "Site URL" que
      // esté configurada en el proyecto de Supabase (Authentication > URL
      // Configuration) — que suele quedar en el valor por defecto
      // http://localhost:3000 si nunca se cambió. Pasando el origen actual
      // acá, el link apunta a donde sea que se esté usando la app (el
      // dominio publicado o localhost en desarrollo), siempre que ese
      // origen esté en la lista de "Redirect URLs" permitidas del proyecto.
      options: { emailRedirectTo: window.location.origin },
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

  // Crea la fila de perfil para un usuario que el Coordinador ya creó en
  // Supabase (Authentication > Users) — Supabase Auth por sí solo no crea
  // esta fila, así que sin este paso ese usuario no puede usar la app. El
  // `id` debe ser el UID que Supabase le asignó a esa cuenta. Usa la
  // política RLS "coordinador_crear_usuarios" ya existente (permite insertar
  // cualquier fila, con cualquier rol, solo si quien llama es Coordinador).
  async crearUsuario(usuario: { id: string; nombre: string; email: string; rol: UserRole }) {
    const { data, error } = await supabase.from('usuarios').insert([usuario]).select().single()
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

  async obtenerDocumentos(filtros: FiltrosDocumentos) {
    let query = supabase
      .from('documentos')
      .select('*, usuario_creador:creado_por(nombre, email, rol), usuario_aprobador:aprobado_por(nombre, email, rol)')

    // contrato_id: hoy hay un solo contrato activo, así que omitirlo no se
    // nota. En cuanto exista un segundo, sin este filtro el pasillo de
    // revisión y el compilado del día mezclarían documentos de ambos.
    if (filtros.contrato_id) query = query.eq('contrato_id', filtros.contrato_id)
    if (filtros.estado) query = query.eq('estado', filtros.estado)
    if (filtros.tipo) query = query.eq('tipo', filtros.tipo)
    if (filtros.creado_por) query = query.eq('creado_por', filtros.creado_por)

    query = query.order('fecha_creacion', { ascending: false })

    // Paginación opcional: sin límite, estas listas crecen para siempre.
    if (filtros.limite) {
      const desde = filtros.desde ?? 0
      query = query.range(desde, desde + filtros.limite - 1)
    }

    const { data, error } = await query

    if (error) throw error
    return data
  },

  // PER-4: la pantalla de Inicio solo necesita CONTAR. Antes descargaba las
  // dos tablas completas para hacer .filter().length — y un parte diario
  // pesa entre 8 y 15 kB por fila con sus arreglos jsonb. Con head:true no
  // viaja ninguna fila, solo el número, así que el costo deja de crecer con
  // el tiempo. Es la primera pantalla tras el login, la ve todo el mundo en
  // cada sesión.
  async contarDocumentos(filtros: FiltrosDocumentos) {
    let query = supabase.from('documentos').select('id', { count: 'exact', head: true })

    if (filtros.contrato_id) query = query.eq('contrato_id', filtros.contrato_id)
    if (filtros.estado) query = query.eq('estado', filtros.estado)
    if (filtros.creado_por) query = query.eq('creado_por', filtros.creado_por)

    const { count, error } = await query
    if (error) throw error
    return count ?? 0
  },

  async contarPartesDiarios(contratoId: string, estado?: string) {
    let query = supabase
      .from('partes_diarios')
      .select('id', { count: 'exact', head: true })
      .eq('contrato_id', contratoId)

    if (estado) query = query.eq('estado', estado)

    const { count, error } = await query
    if (error) throw error
    return count ?? 0
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

  // ============ PARTE DIARIO ============
  // Tablas separadas de las de Documentos QR (add_partes_diarios.sql) —
  // comparten solo "usuarios" y "contratos". Ver ARQUITECTURA.md.

  async obtenerSiguienteNumeroParte(contratoId: string): Promise<number> {
    const { data, error } = await supabase.rpc('obtener_siguiente_numero_parte', {
      p_contrato_id: contratoId,
    })
    if (error) throw error
    return data as number
  },

  // El último parte de la MISMA faena ya trae, en sus columnas
  // *_acumuladas, la suma de todos los anteriores de esa faena — así que
  // el acumulado del parte nuevo es "el de este + lo que traiga este
  // mismo objeto" (ver nota en la migración). Cada faena corre su propia
  // cadena de acumulados en paralelo (ver add_faena_partes_diarios.sql) —
  // por eso el filtro por faena es tan importante acá como el de
  // contrato_id: si tomara el último reporte de la OTRA faena como base,
  // los acumulados de turno saldrían mal calculados.
  async obtenerUltimoParteDiario(contratoId: string, faena: string) {
    // Por número de reporte, no por fecha (ver obtenerPartesDiarios) —
    // acá importa todavía más: si esto tomara el reporte equivocado como
    // "el último", los acumulados de turno del reporte nuevo saldrían
    // mal calculados.
    const { data, error } = await supabase
      .from('partes_diarios')
      .select('hh_directas_acumuladas, hm_acumuladas, hh_indirectas_acumuladas')
      .eq('contrato_id', contratoId)
      .eq('faena', faena)
      .order('numero_reporte', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    return data
  },

  async crearParteDiario(parte: any) {
    const { data, error } = await supabase
      .from('partes_diarios')
      .insert([parte])
      .select()
      .single()

    if (error) throw error
    return data
  },

  async actualizarParteDiario(id: string, updates: any) {
    const { data, error } = await supabase
      .from('partes_diarios')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Solo coordinador tiene policy de delete sobre partes_diarios (apr no
  // tiene — ver add_partes_diarios.sql), así que esto falla en el server
  // si lo llama cualquier otro rol, incluso si la UI lo permitiera.
  async eliminarParteDiario(id: string) {
    const { error } = await supabase.from('partes_diarios').delete().eq('id', id)
    if (error) throw error
  },

  async obtenerPartesDiarios(contratoId: string) {
    // Ordenado por número de reporte (no por fecha): dos reportes pueden
    // crearse fuera de orden respecto a su fecha real (por ejemplo, un
    // borrador atrasado que se envía después), y el número de reporte es
    // el que de verdad refleja el orden de creación — es correlativo y
    // se asigna con obtener_siguiente_numero_parte() al crear cada uno.
    const { data, error } = await supabase
      .from('partes_diarios')
      .select('*, usuario_creador:creado_por(nombre, email, rol, firma_url)')
      .eq('contrato_id', contratoId)
      .order('numero_reporte', { ascending: false })

    if (error) throw error
    return data
  },

  async obtenerParteDiario(id: string) {
    const { data, error } = await supabase
      .from('partes_diarios')
      .select('*, usuario_creador:creado_por(nombre, email, rol, firma_url)')
      .eq('id', id)
      .single()

    if (error) throw error
    return data
  },

  async comentarComoMandante(id: string, comentario: string, autor: string, usuarioId: string) {
    const { data, error } = await supabase
      .from('partes_diarios')
      .update({
        comentario_mandante: comentario,
        comentario_mandante_autor: autor,
        comentario_mandante_por: usuarioId,
        comentario_mandante_fecha: new Date().toISOString(),
        estado: 'comentado_mandante',
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  // ============ COMPRAS (SC -> RQ -> OC) ============
  // Ver add_compras.sql. Código SC atómico por contrato (mismo patrón que
  // obtenerSiguienteSecuenciaPDF: evita colisiones si dos coordinadores
  // crean una SC al mismo tiempo).
  async obtenerSiguienteCodigoSC(contratoId: string): Promise<string> {
    const { data, error } = await supabase.rpc('obtener_siguiente_codigo_sc', {
      p_contrato_id: contratoId,
    })
    if (error) throw error
    return data as string
  },

  // Inserta todos los ítems de una Solicitud de Compra en un solo insert:
  // o quedan guardadas todas las filas, o ninguna (una sola transacción).
  async crearSolicitudCompra(
    items: Omit<SolicitudCompra, 'id' | 'avanzo_a_rq' | 'created_at' | 'updated_at'>[]
  ) {
    const { data, error } = await supabase.from('solicitudes_compra').insert(items).select()
    if (error) throw error
    return data as SolicitudCompra[]
  },

  // Cada pestaña solo trae lo que todavía no avanzó a la siguiente etapa
  // (avanzo_a_rq / avanzo_a_oc = false) — las filas que ya avanzaron
  // quedan en la base para trazabilidad pero no se listan de nuevo acá.
  async obtenerSolicitudesCompra(contratoId: string) {
    const { data, error } = await supabase
      .from('solicitudes_compra')
      .select('*')
      .eq('contrato_id', contratoId)
      .eq('avanzo_a_rq', false)
      .order('created_at', { ascending: false })
      .order('numero_item', { ascending: true })

    if (error) throw error
    return data as SolicitudCompra[]
  },

  // El join a solicitudes_compra trae Documento/Fecha de Solicitud (no son
  // columnas propias de requisiciones) para mostrar la misma columna en
  // las tres pestañas sin duplicar el dato; se aplana acá para que el resto
  // del código maneje un objeto plano, igual que si fueran columnas propias.
  async obtenerRequisiciones(contratoId: string) {
    const { data, error } = await supabase
      .from('requisiciones')
      .select('*, solicitud_compra:solicitud_compra_id(documento_url, documento_nombre, fecha_solicitud)')
      .eq('contrato_id', contratoId)
      .eq('avanzo_a_oc', false)
      .order('created_at', { ascending: false })
      .order('numero_item', { ascending: true })

    if (error) throw error
    return (data ?? []).map((fila: any) => ({
      ...fila,
      documento_url: fila.solicitud_compra?.documento_url ?? null,
      documento_nombre: fila.solicitud_compra?.documento_nombre ?? null,
      fecha_solicitud: fila.solicitud_compra?.fecha_solicitud ?? null,
      solicitud_compra: undefined,
    })) as Requisicion[]
  },

  async obtenerOrdenesCompra(contratoId: string) {
    const { data, error } = await supabase
      .from('ordenes_compra')
      .select(
        '*, requisicion:requisicion_id(solicitud_compra:solicitud_compra_id(documento_url, documento_nombre, fecha_solicitud))'
      )
      .eq('contrato_id', contratoId)
      .order('created_at', { ascending: false })
      .order('numero_item', { ascending: true })

    if (error) throw error
    return (data ?? []).map((fila: any) => ({
      ...fila,
      documento_url: fila.requisicion?.solicitud_compra?.documento_url ?? null,
      documento_nombre: fila.requisicion?.solicitud_compra?.documento_nombre ?? null,
      fecha_solicitud: fila.requisicion?.solicitud_compra?.fecha_solicitud ?? null,
      requisicion: undefined,
    })) as OrdenCompra[]
  },

  // Botón "Pasar a RQ →" / "Pasar a OC →": recibe un arreglo de ids para
  // soportar tanto una fila sola como selección en lote.
  async avanzarSCaRQ(itemIds: string[]) {
    const { error } = await supabase.rpc('avanzar_sc_a_rq', { p_item_ids: itemIds })
    if (error) throw error
  },

  async avanzarRQaOC(itemIds: string[]) {
    const { error } = await supabase.rpc('avanzar_rq_a_oc', { p_item_ids: itemIds })
    if (error) throw error
  },

  // Botón "← Devolver": solo de a una fila (así se aprobó en el mockup).
  async devolverRQaSC(requisicionId: string) {
    const { error } = await supabase.rpc('devolver_rq_a_sc', { p_requisicion_id: requisicionId })
    if (error) throw error
  },

  async devolverOCaRQ(ordenId: string) {
    const { error } = await supabase.rpc('devolver_oc_a_rq', { p_orden_id: ordenId })
    if (error) throw error
  },

  // Campos propios de RQ/OC: llegan en blanco al avanzar y se completan
  // a mano en su pestaña.
  async actualizarRequisicion(
    id: string,
    updates: Partial<Pick<Requisicion, 'rq_numero' | 'fecha_rq' | 'codigo_defontana'>>
  ) {
    const { data, error } = await supabase
      .from('requisiciones')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data as Requisicion
  },

  async actualizarOrdenCompra(id: string, updates: Partial<Pick<OrdenCompra, 'oc_numero' | 'proveedor' | 'fecha_oc'>>) {
    const { data, error } = await supabase
      .from('ordenes_compra')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data as OrdenCompra
  },
}
