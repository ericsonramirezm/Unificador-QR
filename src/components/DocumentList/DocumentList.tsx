import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Documento, DocumentStatus, UserRole, Usuario, Contrato } from '@/types/index'
import { db, storage, type FiltrosDocumentos } from '@lib/supabase'
import { useCompilarDia } from '@hooks/useCompilarDia'
import { generarQRConFecha } from '@lib/generarQR'
import { formatearCargo, formatearEstadoDocumento } from '@lib/formato'
import { ordenarDocumentos } from '@lib/orden'
import { girarPaginasPDF, girarImagen } from '@lib/girarArchivo'
import { CameraUpload } from '@components/Upload/CameraUpload'
import { RelojPasillo } from '@components/DocumentList/RelojPasillo'
import { traducirError } from '@lib/errores'

interface DocumentListProps {
  usuario?: Usuario
  contrato?: Contrato | null
}

/** Cuántos documentos trae cada tanda del pasillo de revisión. */
const PAGINA = 200

interface GrupoPorDia {
  fecha: string // YYYY-MM-DD
  documentos: Documento[]
}

interface SubgrupoPersona {
  usuarioId: string
  nombre: string
  cargo: string
  documentos: Documento[]
}

function agruparPorDia(documentos: Documento[]): GrupoPorDia[] {
  const grupos: GrupoPorDia[] = []
  const indicePorFecha = new Map<string, GrupoPorDia>()

  for (const doc of documentos) {
    const fecha = doc.fecha_creacion.slice(0, 10)
    let grupo = indicePorFecha.get(fecha)
    if (!grupo) {
      grupo = { fecha, documentos: [] }
      indicePorFecha.set(fecha, grupo)
      grupos.push(grupo)
    }
    grupo.documentos.push(doc)
  }

  // Coordinador primero, luego el resto por fecha de carga (o el orden manual
  // que se haya guardado) — ver src/lib/orden.ts
  grupos.forEach((g) => {
    g.documentos = ordenarDocumentos(g.documentos)
  })

  return grupos
}

function agruparPorPersona(documentos: Documento[]): SubgrupoPersona[] {
  const subgrupos: SubgrupoPersona[] = []
  const indicePorUsuario = new Map<string, SubgrupoPersona>()

  // "documentos" ya viene ordenado (Coordinador primero) desde agruparPorDia,
  // así que el subgrupo del Coordinador queda primero también, sin más que hacer.
  for (const doc of documentos) {
    let subgrupo = indicePorUsuario.get(doc.creado_por)
    if (!subgrupo) {
      subgrupo = {
        usuarioId: doc.creado_por,
        nombre: doc.usuario_creador?.nombre || 'Usuario desconocido',
        cargo: formatearCargo(doc.usuario_creador?.rol),
        documentos: [],
      }
      indicePorUsuario.set(doc.creado_por, subgrupo)
      subgrupos.push(subgrupo)
    }
    subgrupo.documentos.push(doc)
  }

  return subgrupos
}

function formatearFechaCorta(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-')
  return `${dia}-${mes}-${anio}`
}

function formatearFechaGrupo(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00`)
  const texto = d.toLocaleDateString('es-CL', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

function formatearHora(fechaISO: string): string {
  return new Date(fechaISO).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
}

function estadoPillClase(estado: DocumentStatus): string {
  switch (estado) {
    case DocumentStatus.APROBADO:
      return 'bg-green-100 text-green-700'
    case DocumentStatus.RECHAZADO:
      return 'bg-red-100 text-red-700'
    case DocumentStatus.REVISION:
      return 'bg-purple-100 text-purple-700'
    default:
      return 'bg-blue-100 text-blue-700'
  }
}

export const DocumentList = ({ usuario, contrato }: DocumentListProps) => {
  const [documentos, setDocumentos] = useState<Documento[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<DocumentStatus | ''>('')
  // Paginación: antes esta consulta no tenía límite, así que el pasillo
  // crecía indefinidamente con el tiempo. PAGINA cubre de sobra varios días
  // de trabajo; si hay más, aparece "Cargar más" al final.
  const [limite, setLimite] = useState(PAGINA)
  const [hayMas, setHayMas] = useState(false)

  // Modal de revisión: fecha + persona cuyos documentos se están revisando
  const [revisando, setRevisando] = useState<{ fecha: string; usuarioId: string; nombre: string; cargo: string } | null>(null)
  const [aprobandoId, setAprobandoId] = useState<string | null>(null)
  const [modalError, setModalError] = useState<string | null>(null)

  // Compilado del día (unir PDFs aprobados en uno solo)
  const { compilar } = useCompilarDia()
  const [compilando, setCompilando] = useState<{ fecha: string; accion: 'qr' | 'pdf' } | null>(null)
  const [compilarError, setCompilarError] = useState<{ fecha: string; mensaje: string } | null>(null)
  const [qrModal, setQrModal] = useState<{ fecha: string; url: string; qrDataUrl: string } | null>(null)
  // QR ya generados en esta sesión, por fecha — así el botón puede mostrar el QR
  // directamente en vez de "Generar QR" una vez que ya existe. Guarda también la
  // última fecha de aprobación con la que se generó, para detectar si después se
  // aprobaron documentos nuevos ese mismo día y el QR quedó desactualizado.
  const [qrGenerados, setQrGenerados] = useState<
    Record<string, { url: string; qrDataUrl: string; ultimaAprobacion: string }>
  >({})

  // Carga de documentos desde la misma pantalla (Coordinador, APR y Supervisor;
  // el Consultor no carga, solo visualiza)
  const [mostrarCarga, setMostrarCarga] = useState(false)

  // Eliminar documentos (solo Coordinador)
  const [eliminando, setEliminando] = useState(false)
  const [eliminarError, setEliminarError] = useState<string | null>(null)

  // Ordenar y girar documentos (solo Coordinador)
  const [ordenando, setOrdenando] = useState<{ fecha: string } | null>(null)
  const [moviendo, setMoviendo] = useState(false)
  const [girandoId, setGirandoId] = useState<string | null>(null)
  const [ordenError, setOrdenError] = useState<string | null>(null)

  const esCoordinador = usuario?.rol === UserRole.COORDINADOR
  const puedeCargar =
    usuario?.rol === UserRole.COORDINADOR ||
    usuario?.rol === UserRole.APR ||
    usuario?.rol === UserRole.SUPERVISOR

  useEffect(() => {
    cargarDocumentos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroEstado, usuario?.id, contrato?.id, limite])

  const cargarDocumentos = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const filtros: FiltrosDocumentos = { limite }
      if (filtroEstado) filtros.estado = filtroEstado

      // Sin este filtro, en cuanto exista un segundo contrato el pasillo de
      // revisión mezclaría documentos de ambos (y el compilado del día
      // también). Hoy no se nota porque hay uno solo.
      if (contrato?.id) filtros.contrato_id = contrato.id

      // APR/Supervisor/Consultor ven solo sus documentos
      if (!esCoordinador) {
        filtros.creado_por = usuario?.id
      }

      const docs = await db.obtenerDocumentos(filtros)
      setDocumentos(docs || [])
      // Si volvió exactamente el máximo pedido, es probable que haya más.
      setHayMas((docs?.length ?? 0) >= limite)
    } catch (err) {
      const msg = traducirError(err, 'Error al cargar documentos')
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  const aprobarDocumento = async (doc: Documento) => {
    if (!usuario) return
    setAprobandoId(doc.id)
    setModalError(null)

    try {
      await db.actualizarDocumento(doc.id, {
        estado: DocumentStatus.APROBADO,
        aprobado_por: usuario.id,
        fecha_aprobacion: new Date().toISOString(),
      })

      await db.crearHistorial({
        documento_id: doc.id,
        usuario_id: usuario.id,
        accion: 'aprobado',
        detalle: `Documento aprobado por ${usuario.nombre}`,
      })

      await cargarDocumentos()
    } catch (err) {
      const msg = traducirError(err, 'Error al aprobar el documento')
      setModalError(msg)
    } finally {
      setAprobandoId(null)
    }
  }

  const descargarPDFDelDia = async (grupo: GrupoPorDia) => {
    if (!contrato) return
    setCompilando({ fecha: grupo.fecha, accion: 'pdf' })
    setCompilarError(null)

    try {
      const blob = await compilar(
        {
          fecha: grupo.fecha,
          contratoCodigo: contrato.codigo,
          contratoNombre: contrato.nombre,
          mandante: contrato.mandante,
          compiladoPor: usuario?.nombre || '',
          compiladoPorCargo: formatearCargo(usuario?.rol),
        },
        grupo.documentos
      )

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Compilado_${grupo.fecha}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // Revocar de inmediato puede cortar la descarga en algunos navegadores
      // si el archivo es grande — se le da un margen antes de liberar la URL.
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (err) {
      const msg = traducirError(err, 'Error al generar el PDF del día')
      setCompilarError({ fecha: grupo.fecha, mensaje: msg })
    } finally {
      setCompilando(null)
    }
  }

  const generarQRDelDia = async (grupo: GrupoPorDia) => {
    if (!contrato) return
    setCompilando({ fecha: grupo.fecha, accion: 'qr' })
    setCompilarError(null)

    try {
      const blob = await compilar(
        {
          fecha: grupo.fecha,
          contratoCodigo: contrato.codigo,
          contratoNombre: contrato.nombre,
          mandante: contrato.mandante,
          compiladoPor: usuario?.nombre || '',
          compiladoPorCargo: formatearCargo(usuario?.rol),
        },
        grupo.documentos
      )

      const path = `compilados/${contrato.id}/Compilado_${grupo.fecha}.pdf`
      await storage.subirCompilado(path, blob)

      // Todos los documentos del grupo están aprobados en este punto (el botón
      // solo se habilita así), por lo que su última fecha de aprobación marca
      // el caché como vigente también para el Historial.
      const ultimaAprobacion = grupo.documentos.reduce((max, d) => {
        const f = d.fecha_aprobacion || d.fecha_creacion
        return f > max ? f : max
      }, '')

      // La ruta del compilado se reutiliza (upsert) cada vez que se regenera, y
      // Supabase Storage cachea la respuesta — sin versionar la URL, un fetch()
      // posterior podía devolver el archivo viejo cacheado en vez del recién
      // subido. Se agrega un parámetro con la última aprobación para que la URL
      // cambie solo cuando el contenido realmente cambió.
      const urlBase = await storage.getPublicUrl('documentos', path)
      const url = `${urlBase}?v=${encodeURIComponent(ultimaAprobacion)}`
      const qrDataUrl = await generarQRConFecha(url, formatearFechaCorta(grupo.fecha), 320)

      await db.guardarCompiladoDia({
        contrato_id: contrato.id,
        fecha: grupo.fecha,
        url,
        ultima_aprobacion: ultimaAprobacion,
        total_documentos: grupo.documentos.length,
        generado_por: usuario?.id,
      })

      setQrGenerados((prev) => ({ ...prev, [grupo.fecha]: { url, qrDataUrl, ultimaAprobacion } }))
      setQrModal({ fecha: grupo.fecha, url, qrDataUrl })
    } catch (err) {
      const msg = traducirError(err, 'Error al generar el QR del día')
      setCompilarError({ fecha: grupo.fecha, mensaje: msg })
    } finally {
      setCompilando(null)
    }
  }

  // Borra uno o varios documentos por completo (registro + archivos en Storage),
  // invalida el compilado en caché del día correspondiente (si existe) para que
  // el próximo QR/PDF se regenere sin los documentos eliminados, y refresca la lista.
  const eliminarDocumentos = async (docs: Documento[], mensajeConfirmacion: string) => {
    if (docs.length === 0) return
    if (!window.confirm(mensajeConfirmacion)) return

    setEliminando(true)
    setEliminarError(null)

    try {
      for (const doc of docs) {
        await db.eliminarDocumentoCompleto(doc)
      }

      const fechasAfectadas = new Set(docs.map((d) => d.fecha_creacion.slice(0, 10)))
      for (const fecha of fechasAfectadas) {
        await invalidarCacheDelDia(fecha)
      }

      await cargarDocumentos()
    } catch (err) {
      const msg = traducirError(err, 'Error al eliminar')
      setEliminarError(msg)
    } finally {
      setEliminando(false)
    }
  }

  // Invalida el compilado en caché del día y limpia el QR ya generado en
  // memoria — se usa tras reordenar o girar, porque el contenido del día
  // cambió y el compilado/QR anteriores ya no reflejan lo actual.
  const invalidarCacheDelDia = async (fecha: string) => {
    if (!contrato) return
    try {
      await db.invalidarCompiladoDia(contrato.id, fecha)
    } catch {
      // no crítico
    }
    setQrGenerados((prev) => {
      const { [fecha]: _quitado, ...resto } = prev
      return resto
    })
  }

  // Mueve un documento una posición arriba/abajo dentro del día, y guarda el
  // nuevo orden de TODOS los documentos de ese día (mezclando personas).
  const moverDocumento = async (grupo: GrupoPorDia, index: number, direccion: 'arriba' | 'abajo') => {
    const nuevoIndex = direccion === 'arriba' ? index - 1 : index + 1
    if (nuevoIndex < 0 || nuevoIndex >= grupo.documentos.length) return

    const reordenados = [...grupo.documentos]
    const [item] = reordenados.splice(index, 1)
    reordenados.splice(nuevoIndex, 0, item)

    setMoviendo(true)
    setOrdenError(null)
    try {
      await Promise.all(reordenados.map((doc, i) => db.actualizarDocumento(doc.id, { orden: i })))
      await invalidarCacheDelDia(grupo.fecha)
      await cargarDocumentos()
    } catch (err) {
      const msg = traducirError(err, 'Error al reordenar')
      setOrdenError(msg)
    } finally {
      setMoviendo(false)
    }
  }

  // Gira 90° (izquierda o derecha) el PDF y la foto/miniatura de un documento,
  // reemplazando los archivos en su misma ruta en Storage.
  const girarDocumento = async (doc: Documento, grados: number) => {
    setGirandoId(doc.id)
    setOrdenError(null)

    try {
      const bucket = 'documentos'
      const updates: { pdf_url?: string; foto_url?: string } = {}

      if (doc.pdf_url) {
        const path = db._pathDesdeUrlPublica(doc.pdf_url, bucket)
        if (path) {
          const nuevoPdfBlob = await girarPaginasPDF(doc.pdf_url, grados)
          await storage.reemplazarArchivo(bucket, path, nuevoPdfBlob, 'application/pdf')
          const urlBase = await storage.getPublicUrl(bucket, path)
          updates.pdf_url = `${urlBase}?v=${Date.now()}`
        }
      }

      if (doc.foto_url) {
        const path = db._pathDesdeUrlPublica(doc.foto_url, bucket)
        if (path) {
          const nuevaFotoBlob = await girarImagen(doc.foto_url, grados)
          await storage.reemplazarArchivo(bucket, path, nuevaFotoBlob, 'image/jpeg')
          const urlBase = await storage.getPublicUrl(bucket, path)
          updates.foto_url = `${urlBase}?v=${Date.now()}`
        }
      }

      if (Object.keys(updates).length > 0) {
        await db.actualizarDocumento(doc.id, updates)
      }

      await invalidarCacheDelDia(doc.fecha_creacion.slice(0, 10))
      await cargarDocumentos()
    } catch (err) {
      const msg = traducirError(err, 'Error al girar el documento')
      setOrdenError(msg)
    } finally {
      setGirandoId(null)
    }
  }

  if (isLoading) {
    return <div className="text-center py-12">Cargando documentos...</div>
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        Error: {error}
      </div>
    )
  }

  const grupos = agruparPorDia(documentos)

  // Documentos que se muestran dentro del modal abierto (se recalculan en cada
  // render desde el estado vivo, así reflejan al instante cualquier aprobación)
  const documentosDelModal = revisando
    ? documentos.filter(
        (d) => d.fecha_creacion.slice(0, 10) === revisando.fecha && d.creado_por === revisando.usuarioId
      )
    : []

  // Grupo/documentos del modal de ordenar y girar, también en vivo — ya vienen
  // ordenados (Coordinador primero) porque agruparPorDia los ordena.
  const grupoDeOrdenando = ordenando ? grupos.find((g) => g.fecha === ordenando.fecha) : undefined
  const documentosDelOrdenando = grupoDeOrdenando?.documentos ?? []

  return (
    <div className="space-y-4">
      {eliminarError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm flex items-center justify-between gap-3">
          <span>{eliminarError}</span>
          <button
            type="button"
            onClick={() => setEliminarError(null)}
            className="text-red-700 font-semibold flex-shrink-0"
          >
            ×
          </button>
        </div>
      )}

      {/* Encabezado */}
      <div className="bg-white rounded-lg p-4 border border-slate-200 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            {esCoordinador ? 'Pasillo de revisión' : 'Historial de mis documentos'}
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Total: {documentos.length} documento{documentos.length !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="flex items-center gap-4">
          {esCoordinador && <RelojPasillo />}

          {puedeCargar && contrato && (
            <button
              type="button"
              onClick={() => setMostrarCarga(true)}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700"
            >
              📷 Cargar documentos
            </button>
          )}
        </div>
      </div>

      {/* Filtro */}
      <div className="bg-white rounded-lg p-4 border border-slate-200">
        <label className="block text-sm font-semibold text-slate-700 mb-1">Estado</label>
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value as DocumentStatus | '')}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
        >
          <option value="">Todos</option>
          <option value={DocumentStatus.PENDIENTE}>Pendiente</option>
          <option value={DocumentStatus.REVISION}>En revisión</option>
          <option value={DocumentStatus.APROBADO}>Aprobado</option>
          <option value={DocumentStatus.RECHAZADO}>Rechazado</option>
        </select>
      </div>

      {/* Grupos por día */}
      {grupos.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 text-center py-12 text-slate-500">
          <p className="font-semibold">No hay documentos</p>
          <p className="text-sm mt-1">
            {esCoordinador
              ? 'Los documentos aparecerán aquí cuando los supervisores carguen'
              : 'Carga fotos para que aparezcan aquí'}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {grupos.map((grupo) => {
            const subgrupos = esCoordinador ? agruparPorPersona(grupo.documentos) : null
            const todosAprobadosDelDia = grupo.documentos.every((d) => d.estado === DocumentStatus.APROBADO)
            const compilandoEsteDia = compilando?.fecha === grupo.fecha ? compilando.accion : null
            const errorEsteDia = compilarError?.fecha === grupo.fecha ? compilarError.mensaje : null

            // El QR guardado en memoria solo es válido si nada se aprobó después de generarlo
            const ultimaAprobacionActual = grupo.documentos.reduce((max, d) => {
              const f = d.fecha_aprobacion || d.fecha_creacion
              return f > max ? f : max
            }, '')
            const qrGuardado = qrGenerados[grupo.fecha]
            const qrVigente =
              qrGuardado && qrGuardado.ultimaAprobacion >= ultimaAprobacionActual ? qrGuardado : undefined

            return (
              <div key={grupo.fecha} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                {/* Encabezado del día */}
                <div className="bg-slate-800 text-white px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold capitalize">{formatearFechaGrupo(grupo.fecha)}</h3>
                    <span className="text-xs bg-white/15 px-2 py-1 rounded-full font-semibold">
                      {grupo.documentos.length} documento{grupo.documentos.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {esCoordinador && (
                    <div className="flex items-center gap-2">
                      {qrVigente ? (
                        <button
                          type="button"
                          onClick={() => setQrModal({ fecha: grupo.fecha, ...qrVigente })}
                          title="Ver, descargar o compartir el QR"
                          className="flex items-center gap-2 bg-white text-slate-800 text-xs font-semibold pl-1.5 pr-3 py-1.5 rounded-lg hover:bg-slate-100"
                        >
                          <img src={qrVigente.qrDataUrl} alt="QR generado" className="w-6 h-6 rounded" />
                          QR listo
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={!todosAprobadosDelDia || compilando !== null}
                          onClick={() => generarQRDelDia(grupo)}
                          title={
                            !todosAprobadosDelDia
                              ? 'Se activa cuando todos los documentos del día estén aprobados'
                              : qrGuardado
                              ? 'Se aprobaron documentos nuevos desde el último QR — hay que regenerarlo'
                              : undefined
                          }
                          className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                            todosAprobadosDelDia
                              ? 'bg-indigo-500 text-white hover:bg-indigo-400'
                              : 'bg-white/10 text-white/40 cursor-not-allowed'
                          }`}
                        >
                          {compilandoEsteDia === 'qr'
                            ? 'Generando…'
                            : qrGuardado
                            ? '🔄 Actualizar QR'
                            : '📱 Generar QR'}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={!todosAprobadosDelDia || compilando !== null}
                        onClick={() => descargarPDFDelDia(grupo)}
                        title={
                          !todosAprobadosDelDia
                            ? 'Se activa cuando todos los documentos del día estén aprobados'
                            : undefined
                        }
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                          todosAprobadosDelDia
                            ? 'bg-white text-slate-800 hover:bg-slate-100'
                            : 'bg-white/10 text-white/40 cursor-not-allowed'
                        }`}
                      >
                        {compilandoEsteDia === 'pdf' ? 'Generando…' : '⬇️ Descargar PDF'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOrdenando({ fecha: grupo.fecha })}
                        title="Ordenar y girar los documentos de este día"
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20"
                      >
                        ↕️ Ordenar y girar
                      </button>
                      <button
                        type="button"
                        disabled={eliminando}
                        onClick={() =>
                          eliminarDocumentos(
                            grupo.documentos,
                            `¿Eliminar los ${grupo.documentos.length} documentos de ${formatearFechaGrupo(
                              grupo.fecha
                            )}? Esta acción no se puede deshacer.`
                          )
                        }
                        title="Eliminar todos los documentos de este día"
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500/20 text-red-200 hover:bg-red-500/30 disabled:opacity-50"
                      >
                        🗑️
                      </button>
                    </div>
                  )}
                </div>

                {errorEsteDia && (
                  <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-red-700 text-xs">
                    {errorEsteDia}
                  </div>
                )}

                {esCoordinador && subgrupos ? (
                  // ---- Coordinador: subgrupos por persona con opción de revisar ----
                  <div className="divide-y divide-slate-200">
                    {subgrupos.map((sub) => {
                      const todosAprobados = sub.documentos.every((d) => d.estado === DocumentStatus.APROBADO)

                      return (
                        <div key={sub.usuarioId} className="px-4 py-3 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">
                              {sub.nombre}
                              {sub.cargo && <span className="text-slate-500 font-normal"> · {sub.cargo}</span>}
                            </p>
                            <p className="text-xs text-slate-500">
                              {sub.documentos.length} documento{sub.documentos.length !== 1 ? 's' : ''} cargado
                              {sub.documentos.length !== 1 ? 's' : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setRevisando({
                                  fecha: grupo.fecha,
                                  usuarioId: sub.usuarioId,
                                  nombre: sub.nombre,
                                  cargo: sub.cargo,
                                })
                              }
                              className={`px-4 py-2 text-sm font-semibold rounded-lg ${
                                todosAprobados
                                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                  : 'bg-blue-600 text-white hover:bg-blue-700'
                              }`}
                            >
                              {todosAprobados ? '✓ Aprobado' : 'Revisar'}
                            </button>
                            <button
                              type="button"
                              disabled={eliminando}
                              onClick={() =>
                                eliminarDocumentos(
                                  sub.documentos,
                                  `¿Eliminar los ${sub.documentos.length} documentos de ${sub.nombre} (${formatearFechaGrupo(
                                    grupo.fecha
                                  )})? Esta acción no se puede deshacer.`
                                )
                              }
                              title={`Eliminar todos los documentos de ${sub.nombre} este día`}
                              className="w-9 h-9 flex items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  // ---- APR/Supervisor/Consultor: tabla simple de sus documentos ----
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-100 border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-slate-700">Documento</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-slate-700">Hora</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-slate-700">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grupo.documentos.map((doc, idx) => (
                          <tr key={doc.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                            <td className="px-4 py-3 text-sm font-semibold text-slate-900">{doc.titulo}</td>
                            <td className="px-4 py-3 text-sm text-slate-500">{formatearHora(doc.fecha_creacion)}</td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${estadoPillClase(doc.estado)}`}
                              >
                                {formatearEstadoDocumento(doc.estado)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}

          {hayMas && (
            <button
              type="button"
              onClick={() => setLimite((n) => n + PAGINA)}
              disabled={isLoading}
              className="w-full py-3 text-sm font-semibold text-blue-700 bg-white border border-slate-200 rounded-lg hover:bg-blue-50 disabled:opacity-50"
            >
              {isLoading ? 'Cargando…' : 'Cargar documentos más antiguos'}
            </button>
          )}
        </div>
      )}

      {/* Modal de revisión */}
      <Dialog.Root open={!!revisando} onOpenChange={(open) => !open && setRevisando(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white rounded-lg shadow-xl z-50 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <Dialog.Title className="text-lg font-bold text-slate-900">
                  Documentos de {revisando?.nombre}
                  {revisando?.cargo && <span className="text-slate-500 font-normal text-base"> · {revisando.cargo}</span>}
                </Dialog.Title>
                {revisando && (
                  <p className="text-sm text-slate-500">{formatearFechaGrupo(revisando.fecha)}</p>
                )}
              </div>
              <Dialog.Close asChild>
                <button className="text-slate-400 hover:text-slate-700 text-2xl leading-none" aria-label="Cerrar">
                  ×
                </button>
              </Dialog.Close>
            </div>

            {modalError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm mb-4">
                {modalError}
              </div>
            )}

            <div className="space-y-3">
              {documentosDelModal.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-3 border border-slate-200 rounded-lg p-3"
                >
                  <a href={doc.foto_url} target="_blank" rel="noreferrer" className="flex-shrink-0">
                    {doc.foto_url ? (
                      <img
                        src={doc.foto_url}
                        alt={doc.titulo}
                        className="w-20 h-24 object-cover rounded-md border border-slate-200 bg-slate-100"
                      />
                    ) : (
                      <div className="w-20 h-24 rounded-md border border-slate-200 bg-slate-100 flex items-center justify-center text-slate-400 text-xs">
                        Sin foto
                      </div>
                    )}
                  </a>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 truncate">{doc.titulo}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-500">{formatearHora(doc.fecha_creacion)}</span>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${estadoPillClase(doc.estado)}`}
                      >
                        {formatearEstadoDocumento(doc.estado)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {doc.estado === DocumentStatus.APROBADO ? (
                      <span className="text-green-600 text-sm font-semibold whitespace-nowrap">✓ Aprobado</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => aprobarDocumento(doc)}
                        disabled={aprobandoId === doc.id}
                        className="px-3 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:bg-slate-400 whitespace-nowrap"
                      >
                        {aprobandoId === doc.id ? 'Aprobando...' : 'Aprobar'}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={eliminando}
                      onClick={() =>
                        eliminarDocumentos([doc], `¿Eliminar "${doc.titulo}"? Esta acción no se puede deshacer.`)
                      }
                      title="Eliminar este documento"
                      className="w-9 h-9 flex items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Modal del QR del compilado */}
      <Dialog.Root open={!!qrModal} onOpenChange={(open) => !open && setQrModal(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
          {/* max-h + overflow: sin esto, en un celular chico el modal mide
              más que la pantalla y los botones de descargar y regenerar
              quedan cortados fuera, sin forma de alcanzarlos. */}
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm max-h-[85vh] overflow-y-auto bg-white rounded-lg shadow-xl z-50 p-6 text-center">
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-lg font-bold text-slate-900">
                {qrModal && `QR — ${formatearFechaGrupo(qrModal.fecha)}`}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button className="text-slate-400 hover:text-slate-700 text-2xl leading-none" aria-label="Cerrar">
                  ×
                </button>
              </Dialog.Close>
            </div>

            {qrModal && (
              <>
                <img src={qrModal.qrDataUrl} alt="Código QR del compilado" className="mx-auto rounded-lg border border-slate-200" />
                <p className="text-xs text-slate-500 mt-4">
                  Cualquier persona con este código o enlace puede abrir el PDF compilado del día, sin necesidad de iniciar sesión.
                </p>

                <div className="flex gap-2 mt-4">
                  <input
                    readOnly
                    value={qrModal.url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 min-w-0 text-xs px-2 py-2 border border-slate-300 rounded-lg text-slate-600"
                  />
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(qrModal.url)}
                    className="px-3 py-2 bg-slate-800 text-white text-xs font-semibold rounded-lg hover:bg-slate-700 whitespace-nowrap"
                  >
                    Copiar
                  </button>
                </div>

                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      const a = document.createElement('a')
                      a.href = qrModal.qrDataUrl
                      a.download = `QR_${qrModal.fecha}.png`
                      document.body.appendChild(a)
                      a.click()
                      document.body.removeChild(a)
                    }}
                    className="flex-1 px-3 py-2 bg-indigo-500 text-white text-xs font-semibold rounded-lg hover:bg-indigo-400"
                  >
                    ⬇️ Descargar QR (imagen)
                  </button>
                  <button
                    type="button"
                    disabled={compilando !== null}
                    onClick={() => {
                      const grupo = grupos.find((g) => g.fecha === qrModal.fecha)
                      if (grupo) generarQRDelDia(grupo)
                    }}
                    className="px-3 py-2 bg-white border border-slate-300 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-50 disabled:opacity-50"
                  >
                    🔄 Regenerar
                  </button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Modal de ordenar y girar (solo Coordinador) */}
      <Dialog.Root open={!!ordenando} onOpenChange={(open) => !open && setOrdenando(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white rounded-lg shadow-xl z-50 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <Dialog.Title className="text-lg font-bold text-slate-900">Ordenar y girar</Dialog.Title>
                {ordenando && <p className="text-sm text-slate-500">{formatearFechaGrupo(ordenando.fecha)}</p>}
              </div>
              <Dialog.Close asChild>
                <button className="text-slate-400 hover:text-slate-700 text-2xl leading-none" aria-label="Cerrar">
                  ×
                </button>
              </Dialog.Close>
            </div>

            <p className="text-xs text-slate-500 mb-4">
              El orden de esta lista es el orden final de páginas en el PDF compilado del día.
            </p>

            {ordenError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm mb-4">
                {ordenError}
              </div>
            )}

            <div className="space-y-3">
              {documentosDelOrdenando.map((doc, idx) => (
                <div key={doc.id} className="flex items-center gap-3 border border-slate-200 rounded-lg p-3">
                  <span className="text-sm font-bold text-slate-400 w-5 text-center flex-shrink-0">{idx + 1}</span>

                  {doc.foto_url ? (
                    <img
                      src={doc.foto_url}
                      alt={doc.titulo}
                      className="w-16 h-20 object-cover rounded-md border border-slate-200 flex-shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-20 rounded-md border border-slate-200 bg-slate-100 flex-shrink-0" />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 truncate">{doc.titulo}</p>
                    <p className="text-xs text-slate-500 mt-1 truncate">
                      {doc.usuario_creador?.nombre || '—'}
                      {doc.usuario_creador?.rol ? ` (${formatearCargo(doc.usuario_creador.rol)})` : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      disabled={girandoId === doc.id}
                      onClick={() => girarDocumento(doc, -90)}
                      title="Girar a la izquierda"
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      ↺
                    </button>
                    <button
                      type="button"
                      disabled={girandoId === doc.id}
                      onClick={() => girarDocumento(doc, 90)}
                      title="Girar a la derecha"
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      ↻
                    </button>
                    <div className="w-px h-6 bg-slate-200 mx-1" />
                    <button
                      type="button"
                      disabled={moviendo || idx === 0}
                      onClick={() => grupoDeOrdenando && moverDocumento(grupoDeOrdenando, idx, 'arriba')}
                      title="Mover arriba"
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={moviendo || idx === documentosDelOrdenando.length - 1}
                      onClick={() => grupoDeOrdenando && moverDocumento(grupoDeOrdenando, idx, 'abajo')}
                      title="Mover abajo"
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Modal de carga de documentos desde el pasillo (solo Coordinador) */}
      <Dialog.Root
        open={mostrarCarga}
        onOpenChange={(open) => {
          setMostrarCarga(open)
          if (!open) cargarDocumentos()
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-50 rounded-lg shadow-xl z-50 p-6">
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-lg font-bold text-slate-900">Adjuntar documentos</Dialog.Title>
              <Dialog.Close asChild>
                <button className="text-slate-400 hover:text-slate-700 text-2xl leading-none" aria-label="Cerrar">
                  ×
                </button>
              </Dialog.Close>
            </div>

            {usuario && contrato && (
              <CameraUpload
                contratoId={contrato.id}
                usuarioId={usuario.id}
                usuarioNombre={usuario.nombre}
                usuarioRol={usuario.rol}
                permitirSeleccionArchivo={esCoordinador}
                permitirEscaneo={usuario.rol === UserRole.SUPERVISOR || usuario.rol === UserRole.APR}
              />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
