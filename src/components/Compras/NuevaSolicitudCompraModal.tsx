import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { DocumentoPreviewModal } from './DocumentoPreviewModal'

interface NuevaSolicitudCompraModalProps {
  onCerrar: () => void
}

interface ItemSolicitud {
  descripcion: string
  marca: string
  modelo: string
  cantidad: number | null
}

const filaVacia = (): ItemSolicitud => ({ descripcion: '', marca: '', modelo: '', cantidad: null })

const EXTENSIONES_ACEPTADAS = ['.xlsx', '.xls', '.pdf']
const extensionValida = (nombre: string) => EXTENSIONES_ACEPTADAS.some((ext) => nombre.toLowerCase().endsWith(ext))

// Formulario de "Nueva Solicitud de Compra": carga + vista previa del
// documento de respaldo, y tabla dinámica de ítems solicitados. Por ahora
// es solo lógica de frontend — el botón final no guarda todavía en
// Supabase (no existe tabla para esto aún); eso se conecta en un próximo
// paso, una vez definido el esquema (pedido explícito, ver conversación
// del 2026-08-25). La extracción automática de datos del Excel a la tabla
// también queda pendiente para un pedido aparte.
export const NuevaSolicitudCompraModal = ({ onCerrar }: NuevaSolicitudCompraModalProps) => {
  const [documento, setDocumento] = useState<File | null>(null)
  const [errorDocumento, setErrorDocumento] = useState<string | null>(null)
  const [mostrarPreview, setMostrarPreview] = useState(false)

  const [items, setItems] = useState<ItemSolicitud[]>([filaVacia()])
  const [errorValidacion, setErrorValidacion] = useState<string | null>(null)
  const [enviado, setEnviado] = useState(false)

  const elegirDocumento = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (!extensionValida(file.name)) {
      setErrorDocumento('Solo se aceptan archivos .xlsx, .xls o .pdf')
      return
    }
    setErrorDocumento(null)
    setDocumento(file)
  }

  const quitarDocumento = () => {
    setDocumento(null)
    setErrorDocumento(null)
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

  const intentarGuardar = () => {
    if (itemsCompletos.length === 0) {
      setErrorValidacion('Agrega al menos un ítem con descripción y cantidad (mayor a 0) antes de continuar.')
      return
    }
    setErrorValidacion(null)
    // Todavía no hay tabla en Supabase para Solicitudes de Compra — este
    // guardado es un paso siguiente aparte. Acá solo se confirma que el
    // formulario (carga + preview + tabla + validación) funciona de
    // punta a punta.
    setEnviado(true)
  }

  return (
    <>
    <Dialog.Root open onOpenChange={(o) => !o && onCerrar()}>
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
                <p className="font-semibold mb-1">✓ Formulario completo</p>
                <p>
                  {itemsCompletos.length} ítem{itemsCompletos.length === 1 ? '' : 's'} listo
                  {itemsCompletos.length === 1 ? '' : 's'}
                  {documento ? ` y documento "${documento.name}" adjunto.` : ', sin documento adjunto.'} El
                  guardado real (conexión a la base de datos) se conecta en un próximo paso.
                </p>
              </div>
            ) : (
              <>
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
                    <table className="w-full text-sm min-w-[560px]">
                      <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                        <tr>
                          <th className="text-left py-2 px-2 w-10">N°</th>
                          <th className="text-left py-2 px-2">Descripción</th>
                          <th className="text-left py-2 px-2 w-28">Marca</th>
                          <th className="text-left py-2 px-2 w-28">Modelo</th>
                          <th className="text-right py-2 px-2 w-24">Cantidad</th>
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
                onClick={intentarGuardar}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
              >
                Guardar Solicitud
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
