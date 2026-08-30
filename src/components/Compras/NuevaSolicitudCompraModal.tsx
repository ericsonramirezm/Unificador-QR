import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { DocumentoPreviewModal } from './DocumentoPreviewModal'
import { useAutoguardado, leerBorrador, haceCuanto } from '@hooks/useBorradorLocal'
import { db, storage } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { Contrato, Usuario } from '@/types/index'

interface NuevaSolicitudCompraModalProps {
  usuario: Usuario
  contrato?: Contrato | null
  onCerrar: () => void
  /** Se llama después de guardar con éxito, para refrescar el listado de SC. */
  onGuardado: () => void
}

/** Una sola solicitud a la vez por navegador, así que basta una clave fija. */
const CLAVE_BORRADOR = 'solicitud-compra'

interface ItemSolicitud {
  descripcion: string
  marca: string
  modelo: string
  cantidad: number | null
  unidad: string
}

const filaVacia = (): ItemSolicitud => ({ descripcion: '', marca: '', modelo: '', cantidad: null, unidad: '' })

const EXTENSIONES_ACEPTADAS = ['.xlsx', '.xls', '.pdf']
const extensionValida = (nombre: string) => EXTENSIONES_ACEPTADAS.some((ext) => nombre.toLowerCase().endsWith(ext))

/** Solo caracteres seguros para un path de Storage; el resto se reemplaza. */
const sanearNombreArchivo = (nombre: string) => nombre.replace(/[^a-zA-Z0-9._-]/g, '_')

// Formulario de "Nueva Solicitud de Compra": carga + vista previa del
// documento de respaldo, y tabla dinámica de ítems solicitados. El
// guardado es "retry-safe": si algo falla a mitad de camino (sin señal
// al subir el documento, por ejemplo), reintentar no vuelve a pedir un
// Código SC nuevo ni sube el documento dos veces — sigue desde donde
// quedó, usando el mismo patrón que ParteDiarioForm/CameraUpload.
export const NuevaSolicitudCompraModal = ({ usuario, contrato, onCerrar, onGuardado }: NuevaSolicitudCompraModalProps) => {
  const [documento, setDocumento] = useState<File | null>(null)
  const [errorDocumento, setErrorDocumento] = useState<string | null>(null)
  const [mostrarPreview, setMostrarPreview] = useState(false)

  const [solicitadoPor, setSolicitadoPor] = useState(usuario.nombre)
  const [items, setItems] = useState<ItemSolicitud[]>([filaVacia()])
  const [errorValidacion, setErrorValidacion] = useState<string | null>(null)
  const [enviado, setEnviado] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null)
  const [codigoSCGuardado, setCodigoSCGuardado] = useState<string | null>(null)

  // Progreso ya conseguido en un intento anterior: si el guardado falla a
  // mitad de camino, un reintento retoma desde acá en vez de repetir todo.
  const [codigoSC, setCodigoSC] = useState<string | null>(null)
  const [documentoSubido, setDocumentoSubido] = useState<{ url: string; nombre: string } | null>(null)

  // Autoguardado de los ítems. El documento de respaldo es un File y no se
  // puede serializar, así que hay que volver a adjuntarlo — se avisa.
  const { limpiar: limpiarBorrador } = useAutoguardado(CLAVE_BORRADOR, { items, solicitadoPor }, !enviado)
  const [borrador, setBorrador] = useState(() => leerBorrador<{ items: ItemSolicitud[]; solicitadoPor: string }>(CLAVE_BORRADOR))

  const hayAlgoEscrito = items.some((i) => i.descripcion.trim() || i.marca.trim() || i.modelo.trim() || i.cantidad)

  const cerrarConAviso = () => {
    if (!enviado && hayAlgoEscrito) {
      const ok = window.confirm('Tienes una solicitud a medio llenar. Si cierras ahora, la retomas después desde el borrador.')
      if (!ok) return
    }
    onCerrar()
  }

  const elegirDocumento = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (!extensionValida(file.name)) {
      setErrorDocumento('Solo se aceptan archivos .xlsx, .xls o .pdf')
      return
    }
    setErrorDocumento(null)
    setDocumento(file)
    // Si ya se había subido un documento distinto en un intento anterior,
    // se descarta ese progreso: hay que subir el nuevo.
    setDocumentoSubido(null)
  }

  const quitarDocumento = () => {
    setDocumento(null)
    setErrorDocumento(null)
    setDocumentoSubido(null)
  }

  const actualizarItem = (index: number, campo: keyof ItemSolicitud, valor: string) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item
        if (campo === 'cantidad') {
          return { ...item, cantidad: valor === '' ? null : Number(valor) }
        }
        return { ...item, [campo]: valor }
      })
    )
  }

  const agregarFila = () => setItems((prev) => [...prev, filaVacia()])

  // Al filtrar por índice, el N° de cada fila se recalcula solo — es
  // directamente su posición en el arreglo (index + 1) al renderizar, no
  // un campo guardado aparte.
  const quitarFila = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index))

  const itemsCompletos = items.filter(
    (item) => item.descripcion.trim() !== '' && item.cantidad != null && item.cantidad > 0
  )

  const guardar = async () => {
    if (itemsCompletos.length === 0) {
      setErrorValidacion('Agrega al menos un ítem con descripción y cantidad (mayor a 0) antes de continuar.')
      return
    }
    if (!solicitadoPor.trim()) {
      setErrorValidacion('Indica quién solicita los materiales.')
      return
    }
    if (!contrato) {
      setErrorValidacion('No hay un contrato activo — recarga la página e inténtalo de nuevo.')
      return
    }
    setErrorValidacion(null)
    setErrorGuardado(null)
    setGuardando(true)

    try {
      // Paso 1: Código SC. Si ya se obtuvo en un intento anterior, se
      // reutiliza — no se pide uno nuevo (dejaría un número saltado).
      let codigo = codigoSC
      if (!codigo) {
        codigo = await db.obtenerSiguienteCodigoSC(contrato.id)
        setCodigoSC(codigo)
      }

      // Paso 2: documento de respaldo, si hay uno y todavía no se subió.
      let doc = documentoSubido
      if (documento && !doc) {
        const nombreSeguro = sanearNombreArchivo(documento.name)
        const path = `compras/${contrato.id}/${codigo}/${nombreSeguro}`
        await storage.uploadFoto('documentos', path, documento)
        const url = await storage.getPublicUrl('documentos', path)
        doc = { url, nombre: documento.name }
        setDocumentoSubido(doc)
      }

      // Paso 3: una fila por ítem, todas en un solo insert (o quedan
      // todas, o ninguna).
      const fechaHoy = new Date().toISOString().slice(0, 10)
      const filas = itemsCompletos.map((item, index) => ({
        contrato_id: contrato.id,
        codigo_sc: codigo!,
        numero_item: index + 1,
        solicitado_por: solicitadoPor.trim(),
        fecha_solicitud: fechaHoy,
        documento_url: doc?.url ?? null,
        documento_nombre: doc?.nombre ?? null,
        descripcion: item.descripcion.trim(),
        marca: item.marca.trim() || null,
        modelo: item.modelo.trim() || null,
        cantidad: item.cantidad as number,
        unidad: item.unidad.trim() || null,
        creado_por: usuario.id,
      }))

      await db.crearSolicitudCompra(filas)

      setCodigoSCGuardado(codigo)
      setEnviado(true)
      limpiarBorrador()
      onGuardado()
    } catch (err) {
      setErrorGuardado(traducirError(err, 'No se pudo guardar la Solicitud de Compra'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
    <Dialog.Root open onOpenChange={(o) => !o && cerrarConAviso()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl max-h-[90vh] bg-white rounded-lg shadow-xl z-50 flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200">
            <Dialog.Title className="text-lg font-bold text-slate-900">Nueva Solicitud de Compra</Dialog.Title>
            <Dialog.Description className="text-sm text-slate-500">
              Carga el documento de respaldo y detalla los ítems solicitados.
            </Dialog.Description>
          </div>

          <div className="flex-1 overflow-auto px-6 py-4 space-y-6">
            {enviado ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-800">
                <p className="font-semibold mb-1">✓ {codigoSCGuardado} guardada</p>
                <p>
                  {itemsCompletos.length} ítem{itemsCompletos.length === 1 ? '' : 's'} guardado
                  {itemsCompletos.length === 1 ? '' : 's'}
                  {documento ? ` con el documento "${documento.name}" adjunto.` : ', sin documento adjunto.'} Ya
                  aparece en la pestaña Solicitudes de Compra.
                </p>
              </div>
            ) : (
              <>
                {borrador && borrador.datos.items.some((i) => i.descripcion.trim()) && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <p className="text-sm font-semibold text-amber-900">
                      Tienes una solicitud a medio llenar de {haceCuanto(borrador.guardadoEn)}
                    </p>
                    <p className="text-xs text-amber-800/80 mt-1">
                      Se recuperan los ítems; el documento de respaldo hay que volver a adjuntarlo.
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => {
                          setItems(borrador.datos.items)
                          setSolicitadoPor(borrador.datos.solicitadoPor || usuario.nombre)
                          setBorrador(null)
                        }}
                        className="px-4 py-2.5 bg-amber-600 text-white text-sm font-semibold rounded-lg hover:bg-amber-700"
                      >
                        Recuperar ítems
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          limpiarBorrador()
                          setBorrador(null)
                        }}
                        className="px-4 py-2.5 text-sm font-semibold text-amber-800 border border-amber-300 rounded-lg hover:bg-amber-100"
                      >
                        Empezar de cero
                      </button>
                    </div>
                  </div>
                )}

                {/* Solicitado por */}
                <section>
                  <label htmlFor="solicitado-por" className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2 block">
                    Solicitado por
                  </label>
                  <input
                    id="solicitado-por"
                    type="text"
                    value={solicitadoPor}
                    onChange={(e) => setSolicitadoPor(e.target.value)}
                    placeholder="Nombre de quien pide los materiales"
                    className="w-full max-w-sm px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Aplica a todos los ítems de esta solicitud. Puede ser distinto de quien la está ingresando.
                  </p>
                </section>

                {/* Documento de respaldo */}
                <section>
                  <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">
                    Documento de respaldo
                  </h3>
                  {!documento ? (
                    <label className="flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-2xl px-4 py-6 text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 cursor-pointer transition-colors">
                      <span>📎 Cargar Documento de Respaldo (.xlsx, .xls, .pdf)</span>
                      <input
                        type="file"
                        accept=".xlsx,.xls,.pdf"
                        onChange={(e) => elegirDocumento(e.target.files)}
                        className="hidden"
                      />
                    </label>
                  ) : (
                    <div className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-4 py-3 bg-slate-50">
                      <span className="text-sm text-slate-700 truncate">📄 {documento.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setMostrarPreview(true)}
                          className="px-3 py-1.5 border border-blue-200 text-blue-600 text-xs font-semibold rounded-lg hover:bg-blue-50 transition-colors"
                        >
                          Ver Previa
                        </button>
                        <button
                          type="button"
                          onClick={quitarDocumento}
                          className="px-3 py-1.5 border border-red-200 text-red-600 text-xs font-semibold rounded-lg hover:bg-red-50 transition-colors"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  )}
                  {errorDocumento && <p className="text-xs text-red-600 mt-1">{errorDocumento}</p>}
                </section>

                {/* Tabla dinámica de ítems */}
                <section>
                  <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">
                    Ítems solicitados
                  </h3>
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-sm min-w-[680px]">
                      <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                        <tr>
                          <th className="text-left py-2 px-2 w-10">N°</th>
                          <th className="text-left py-2 px-2">Descripción</th>
                          <th className="text-left py-2 px-2 w-28">Marca</th>
                          <th className="text-left py-2 px-2 w-28">Modelo</th>
                          <th className="text-right py-2 px-2 w-24">Cantidad</th>
                          <th className="text-left py-2 px-2 w-24">Unidad</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {items.map((item, index) => (
                          <tr key={index}>
                            <td className="py-1 px-2 text-slate-400 font-mono text-xs">{index + 1}</td>
                            <td className="py-1 px-2">
                              <textarea
                                rows={1}
                                value={item.descripcion}
                                onChange={(e) => actualizarItem(index, 'descripcion', e.target.value)}
                                placeholder="Detalle del insumo o material"
                                className="w-full px-2 py-1 border border-slate-300 rounded-md text-sm resize-y focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                              />
                            </td>
                            <td className="py-1 px-2">
                              <input
                                type="text"
                                value={item.marca}
                                onChange={(e) => actualizarItem(index, 'marca', e.target.value)}
                                className="w-full px-2 py-1 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                              />
                            </td>
                            <td className="py-1 px-2">
                              <input
                                type="text"
                                value={item.modelo}
                                onChange={(e) => actualizarItem(index, 'modelo', e.target.value)}
                                className="w-full px-2 py-1 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                              />
                            </td>
                            <td className="py-1 px-2">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={item.cantidad ?? ''}
                                onChange={(e) => actualizarItem(index, 'cantidad', e.target.value)}
                                className="w-full px-2 py-1 border border-slate-300 rounded-md text-sm text-right focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                              />
                            </td>
                            <td className="py-1 px-2">
                              <input
                                type="text"
                                value={item.unidad}
                                onChange={(e) => actualizarItem(index, 'unidad', e.target.value)}
                                placeholder="un, m, kg…"
                                className="w-full px-2 py-1 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                              />
                            </td>
                            <td className="py-1 px-2 text-center">
                              <button
                                type="button"
                                onClick={() => quitarFila(index)}
                                className="text-slate-400 hover:text-red-600"
                                aria-label={`Eliminar fila ${index + 1}`}
                                title="Eliminar fila"
                              >
                                🗑
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button
                    type="button"
                    onClick={agregarFila}
                    className="mt-2 text-sm font-semibold text-blue-600 hover:text-blue-700"
                  >
                    + Agregar Fila
                  </button>
                  {errorValidacion && <p className="text-xs text-red-600 mt-2">{errorValidacion}</p>}
                  {errorGuardado && (
                    <p className="text-xs text-red-600 mt-2">
                      {errorGuardado} {codigoSC && '— tu progreso no se perdió, solo presiona Guardar de nuevo.'}
                    </p>
                  )}
                </section>
              </>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200">
            <Dialog.Close asChild>
              <button type="button" className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
                {enviado ? 'Cerrar' : 'Cancelar'}
              </button>
            </Dialog.Close>
            {!enviado && (
              <button
                type="button"
                onClick={guardar}
                disabled={guardando}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {guardando ? 'Guardando…' : 'Guardar Solicitud'}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>

    {mostrarPreview && documento && (
      <DocumentoPreviewModal documento={documento} onCerrar={() => setMostrarPreview(false)} />
    )}
    </>
  )
}
