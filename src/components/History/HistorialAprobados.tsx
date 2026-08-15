import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Documento, DocumentStatus, Usuario, Contrato } from '@/types/index'
import { db, storage } from '@lib/supabase'
import { useCompilarDia } from '@hooks/useCompilarDia'
import { generarQRConFecha } from '@lib/generarQR'
import { formatearCargo } from '@lib/formato'

interface HistorialAprobadosProps {
  usuario?: Usuario
  contrato?: Contrato | null
}

interface GrupoPorMes {
  mes: string // YYYY-MM
  dias: GrupoPorDia[]
}

interface GrupoPorDia {
  fecha: string // YYYY-MM-DD
  documentos: Documento[]
}

type EstadoQR = { estado: 'generando' } | { estado: 'listo'; url: string; qrDataUrl: string } | { estado: 'error' }

function fechaDeAgrupacion(doc: Documento): string {
  return doc.fecha_aprobacion || doc.fecha_creacion
}

function agruparPorMesYDia(documentos: Documento[]): GrupoPorMes[] {
  // Más reciente primero
  const ordenados = [...documentos].sort(
    (a, b) => new Date(fechaDeAgrupacion(b)).getTime() - new Date(fechaDeAgrupacion(a)).getTime()
  )

  const meses: GrupoPorMes[] = []
  const indiceMeses = new Map<string, GrupoPorMes>()
  const indiceDias = new Map<string, GrupoPorDia>()

  for (const doc of ordenados) {
    const fechaIso = fechaDeAgrupacion(doc)
    const mesKey = fechaIso.slice(0, 7)
    const diaKey = fechaIso.slice(0, 10)

    let mes = indiceMeses.get(mesKey)
    if (!mes) {
      mes = { mes: mesKey, dias: [] }
      indiceMeses.set(mesKey, mes)
      meses.push(mes)
    }

    let dia = indiceDias.get(diaKey)
    if (!dia) {
      dia = { fecha: diaKey, documentos: [] }
      indiceDias.set(diaKey, dia)
      mes.dias.push(dia)
    }

    dia.documentos.push(doc)
  }

  return meses
}

function formatearMes(mes: string): string {
  const texto = new Date(`${mes}-01T00:00:00`).toLocaleDateString('es-CL', {
    month: 'long',
    year: 'numeric',
  })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

function formatearFechaCorta(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-')
  return `${dia}-${mes}-${anio}`
}

function formatearHora(fechaISO: string): string {
  return new Date(fechaISO).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
}

// Fecha de aprobación más reciente entre los documentos de un día — se usa
// para saber si el caché (compilados_dia) sigue vigente o hay algo nuevo.
function ultimaAprobacionDe(documentos: Documento[]): string {
  return documentos.reduce((max, d) => {
    const f = fechaDeAgrupacion(d)
    return f > max ? f : max
  }, '')
}

export const HistorialAprobados = ({ usuario, contrato }: HistorialAprobadosProps) => {
  const [documentos, setDocumentos] = useState<Documento[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [diaAbierto, setDiaAbierto] = useState<GrupoPorDia | null>(null)

  const { compilar } = useCompilarDia()
  const [qrPorDia, setQrPorDia] = useState<Record<string, EstadoQR>>({})

  useEffect(() => {
    cargar()
  }, [])

  const cargar = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const docs = await db.obtenerDocumentos({ estado: DocumentStatus.APROBADO })
      setDocumentos(docs || [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al cargar el historial'
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  const meses = agruparPorMesYDia(documentos)

  // Genera (o regenera) el QR real de un día: compila sus documentos ya
  // aprobados en un solo PDF, lo sube a Storage, codifica su URL pública,
  // y guarda el resultado en el caché para no repetir el trabajo la próxima vez.
  const generarQRDia = async (dia: GrupoPorDia) => {
    if (!contrato) return
    setQrPorDia((prev) => ({ ...prev, [dia.fecha]: { estado: 'generando' } }))

    try {
      const blob = await compilar(
        {
          fecha: dia.fecha,
          contratoCodigo: contrato.codigo,
          contratoNombre: contrato.nombre,
          mandante: contrato.mandante,
          compiladoPor: usuario?.nombre || '',
          compiladoPorCargo: formatearCargo(usuario?.rol),
        },
        dia.documentos
      )

      const path = `compilados/${contrato.id}/Compilado_${dia.fecha}.pdf`
      await storage.subirCompilado(path, blob)

      // La ruta del compilado se reutiliza (upsert) cada vez que se regenera, y
      // Supabase Storage cachea la respuesta — sin versionar la URL, un fetch()
      // posterior podía devolver el archivo viejo cacheado en vez del recién
      // subido. Se agrega un parámetro con la última aprobación para que la URL
      // cambie solo cuando el contenido realmente cambió.
      const ultimaAprobacion = ultimaAprobacionDe(dia.documentos)
      const urlBase = await storage.getPublicUrl('documentos', path)
      const url = `${urlBase}?v=${encodeURIComponent(ultimaAprobacion)}`
      const qrDataUrl = await generarQRConFecha(url, formatearFechaCorta(dia.fecha), 240)

      await db.guardarCompiladoDia({
        contrato_id: contrato.id,
        fecha: dia.fecha,
        url,
        ultima_aprobacion: ultimaAprobacion,
        total_documentos: dia.documentos.length,
        generado_por: usuario?.id,
      })

      setQrPorDia((prev) => ({ ...prev, [dia.fecha]: { estado: 'listo', url, qrDataUrl } }))
    } catch {
      setQrPorDia((prev) => ({ ...prev, [dia.fecha]: { estado: 'error' } }))
    }
  }

  const descargarPDFDia = async (dia: GrupoPorDia) => {
    const qr = qrPorDia[dia.fecha]
    if (qr?.estado !== 'listo') return

    const res = await fetch(qr.url)
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `Compilado_${dia.fecha}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Revocar de inmediato puede cortar la descarga en algunos navegadores
    // si el archivo es grande — se le da un margen antes de liberar la URL.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000)
  }

  const descargarQRImagen = (dia: GrupoPorDia) => {
    const qr = qrPorDia[dia.fecha]
    if (qr?.estado !== 'listo') return

    const a = document.createElement('a')
    a.href = qr.qrDataUrl
    a.download = `QR_${dia.fecha}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  // Al cargar el historial: primero revisa qué días ya tienen un compilado
  // vigente en caché (nada aprobado después de la última vez que se generó)
  // y solo recompila los que faltan o cambiaron — uno por uno, para no
  // saturar Storage con subidas simultáneas.
  useEffect(() => {
    if (!contrato) return

    let cancelado = false

    const generarPendientes = async () => {
      let cache: Awaited<ReturnType<typeof db.obtenerCompiladosDia>> = []
      try {
        cache = await db.obtenerCompiladosDia(contrato.id)
      } catch {
        // si falla la consulta del caché, simplemente se recompila todo
      }
      const cachePorFecha = new Map(cache.map((c) => [c.fecha, c]))

      for (const mes of meses) {
        for (const dia of mes.dias) {
          if (cancelado) return
          if (qrPorDia[dia.fecha]) continue

          const cacheDia = cachePorFecha.get(dia.fecha)
          const vigente =
            cacheDia && new Date(cacheDia.ultima_aprobacion) >= new Date(ultimaAprobacionDe(dia.documentos))

          if (vigente && cacheDia) {
            // Reusa el PDF ya compilado — solo hay que regenerar la imagen del QR (instantáneo)
            try {
              const qrDataUrl = await generarQRConFecha(cacheDia.url, formatearFechaCorta(dia.fecha), 240)
              if (cancelado) return
              setQrPorDia((prev) => ({ ...prev, [dia.fecha]: { estado: 'listo', url: cacheDia.url, qrDataUrl } }))
              continue
            } catch {
              // si falla generar el QR desde el caché, recompila desde cero
            }
          }

          await generarQRDia(dia)
        }
      }
    }

    generarPendientes()

    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentos, contrato?.id])

  if (isLoading) {
    return <div className="text-center py-12">Cargando historial...</div>
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        Error: {error}
      </div>
    )
  }

  const qrDelDiaAbierto = diaAbierto ? qrPorDia[diaAbierto.fecha] : undefined

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg p-4 border border-slate-200">
        <h2 className="text-lg font-bold text-slate-900">Historial de aprobados</h2>
        <p className="text-sm text-slate-500 mt-1">
          {documentos.length} documento{documentos.length !== 1 ? 's' : ''} aprobado{documentos.length !== 1 ? 's' : ''} en total
        </p>
      </div>

      {meses.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 text-center py-12 text-slate-500">
          <p className="font-semibold">Aún no hay documentos aprobados</p>
          <p className="text-sm mt-1">A medida que apruebes documentos en el pasillo de revisión, aparecerán aquí agrupados por día.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {meses.map((mes) => (
            <div key={mes.mes} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <div className="bg-slate-800 text-white px-4 py-3 flex items-center justify-between">
                <h3 className="font-semibold">{formatearMes(mes.mes)}</h3>
                <span className="text-xs bg-white/15 px-2 py-1 rounded-full font-semibold">
                  {mes.dias.reduce((total, d) => total + d.documentos.length, 0)} documentos
                </span>
              </div>

              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {mes.dias.map((dia) => {
                  const qr = qrPorDia[dia.fecha]

                  return (
                    <div
                      key={dia.fecha}
                      className="border border-slate-200 rounded-lg bg-white hover:border-blue-400 hover:shadow-sm transition-all overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => setDiaAbierto(dia)}
                        className="w-full flex items-stretch gap-3 px-4 py-3 text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-slate-900 text-sm">{formatearFechaCorta(dia.fecha)}</p>
                          <p className="text-xs text-slate-500 mt-1">
                            ({dia.documentos.length} documento{dia.documentos.length !== 1 ? 's' : ''} aprobado
                            {dia.documentos.length !== 1 ? 's' : ''})
                          </p>
                        </div>
                        <div className="w-px bg-slate-300 flex-shrink-0" />
                        <div className="w-12 h-12 flex-shrink-0 border-2 border-slate-800 rounded-md flex items-center justify-center self-center overflow-hidden bg-white">
                          {qr?.estado === 'listo' ? (
                            <img src={qr.qrDataUrl} alt="QR del día" className="w-full h-full object-contain" />
                          ) : qr?.estado === 'error' ? (
                            <span className="text-red-500 text-xs">!</span>
                          ) : contrato ? (
                            <span className="w-4 h-4 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </div>
                      </button>

                      {qr?.estado === 'listo' && (
                        <div className="flex border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => descargarPDFDia(dia)}
                            className="flex-1 text-xs font-semibold text-slate-600 py-2 hover:bg-slate-50"
                          >
                            ⬇️ PDF
                          </button>
                          <div className="w-px bg-slate-100" />
                          <button
                            type="button"
                            onClick={() => descargarQRImagen(dia)}
                            className="flex-1 text-xs font-semibold text-slate-600 py-2 hover:bg-slate-50"
                          >
                            ⬇️ QR
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: toda la documentación aprobada de un día + su QR real */}
      <Dialog.Root open={!!diaAbierto} onOpenChange={(open) => !open && setDiaAbierto(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white rounded-lg shadow-xl z-50 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <Dialog.Title className="text-lg font-bold text-slate-900">
                  {diaAbierto && formatearFechaCorta(diaAbierto.fecha)}
                </Dialog.Title>
                <p className="text-sm text-slate-500">Documentación aprobada de este día</p>
              </div>
              <Dialog.Close asChild>
                <button className="text-slate-400 hover:text-slate-700 text-2xl leading-none" aria-label="Cerrar">
                  ×
                </button>
              </Dialog.Close>
            </div>

            {qrDelDiaAbierto?.estado === 'listo' && (
              <div className="flex items-center gap-4 border border-slate-200 rounded-lg p-4 mb-4 bg-slate-50">
                <img src={qrDelDiaAbierto.qrDataUrl} alt="QR del día" className="w-24 h-24 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-500 mb-2">
                    Cualquier persona con este código o enlace puede abrir el PDF compilado del día, sin sesión.
                  </p>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={qrDelDiaAbierto.url}
                      onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 min-w-0 text-xs px-2 py-1.5 border border-slate-300 rounded-lg text-slate-600"
                    />
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(qrDelDiaAbierto.url)}
                      className="px-3 py-1.5 bg-slate-800 text-white text-xs font-semibold rounded-lg hover:bg-slate-700 whitespace-nowrap"
                    >
                      Copiar
                    </button>
                  </div>
                </div>
              </div>
            )}
            {qrDelDiaAbierto?.estado === 'generando' && (
              <p className="text-xs text-slate-500 mb-4">Generando el QR de este día…</p>
            )}
            {qrDelDiaAbierto?.estado === 'error' && diaAbierto && (
              <div className="flex items-center justify-between border border-red-200 bg-red-50 rounded-lg p-3 mb-4">
                <p className="text-xs text-red-700">No se pudo generar el QR de este día.</p>
                <button
                  type="button"
                  onClick={() => generarQRDia(diaAbierto)}
                  className="text-xs font-semibold text-red-700 underline"
                >
                  Reintentar
                </button>
              </div>
            )}

            <div className="space-y-3">
              {diaAbierto?.documentos.map((doc) => (
                <div key={doc.id} className="flex items-center gap-3 border border-slate-200 rounded-lg p-3">
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
                    <p className="text-xs text-slate-500 mt-1">
                      Cargado por {doc.usuario_creador?.nombre || '—'}
                      {doc.usuario_creador?.rol ? ` (${formatearCargo(doc.usuario_creador.rol)})` : ''}
                      {doc.usuario_aprobador?.nombre
                        ? ` · Aprobado por ${doc.usuario_aprobador.nombre}${
                            doc.usuario_aprobador.rol ? ` (${formatearCargo(doc.usuario_aprobador.rol)})` : ''
                          }`
                        : ''}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">{formatearHora(fechaDeAgrupacion(doc))}</p>
                  </div>

                  {doc.pdf_url && (
                    <a
                      href={doc.pdf_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-blue-600 hover:text-blue-700 whitespace-nowrap"
                    >
                      Ver PDF
                    </a>
                  )}
                </div>
              ))}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
