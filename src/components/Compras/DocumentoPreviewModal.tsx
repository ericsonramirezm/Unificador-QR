import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { leerExcelParaPreview, type HojaPreview } from '@lib/previsualizarDocumento'
import { renderizarPaginasPDF } from '@lib/renderizarPDF'
import { traducirError } from '@lib/errores'

interface DocumentoPreviewModalProps {
  documento: File
  onCerrar: () => void
}

const esPdf = (nombre: string) => nombre.toLowerCase().endsWith('.pdf')

// Modal anidado (se abre encima del modal de Nueva Solicitud de Compra) que
// procesa el documento de respaldo cargado y lo muestra para revisión
// rápida: hojas/celdas en tabla HTML si es Excel, o cada página como imagen
// si es PDF. Pedido explícito, ver conversación del 2026-08-25.
export const DocumentoPreviewModal = ({ documento, onCerrar }: DocumentoPreviewModalProps) => {
  const [isCargando, setIsCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hojas, setHojas] = useState<HojaPreview[] | null>(null)
  const [hojaActiva, setHojaActiva] = useState(0)
  const [paginasPdf, setPaginasPdf] = useState<string[] | null>(null)

  useEffect(() => {
    let cancelado = false
    const procesar = async () => {
      setIsCargando(true)
      setError(null)
      try {
        if (esPdf(documento.name)) {
          const paginas = await renderizarPaginasPDF(documento)
          if (!cancelado) setPaginasPdf(paginas)
        } else {
          const resultado = await leerExcelParaPreview(documento)
          if (!cancelado) setHojas(resultado)
        }
      } catch (err) {
        if (!cancelado) setError(traducirError(err, 'No se pudo generar la vista previa'))
      } finally {
        if (!cancelado) setIsCargando(false)
      }
    }
    procesar()
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documento])

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[60]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl max-h-[85vh] bg-white rounded-lg shadow-xl z-[70] flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
            <Dialog.Title className="text-base font-bold text-slate-900 truncate pr-4">
              {documento.name}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-700 text-xl leading-none shrink-0"
                aria-label="Cerrar vista previa"
              >
                ✕
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-auto p-6">
            {isCargando && <p className="text-sm text-slate-500">Procesando documento…</p>}

            {!isCargando && error && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                {error}
              </div>
            )}

            {!isCargando && !error && paginasPdf && (
              <div className="space-y-4">
                {paginasPdf.map((paginaDataUrl, i) => (
                  <div key={i} className="border border-slate-200 rounded-lg overflow-hidden">
                    <img src={paginaDataUrl} alt={`Página ${i + 1}`} className="w-full h-auto" />
                    <p className="text-xs text-slate-400 text-center py-1">
                      Página {i + 1} de {paginasPdf.length}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {!isCargando && !error && hojas && (
              <div>
                {hojas.length > 1 && (
                  <div className="flex items-center gap-1 mb-3 border-b border-slate-200">
                    {hojas.map((hoja, i) => (
                      <button
                        key={hoja.nombre}
                        type="button"
                        onClick={() => setHojaActiva(i)}
                        className={`px-3 py-1.5 text-sm font-semibold rounded-t-lg -mb-px border ${
                          hojaActiva === i
                            ? 'bg-white border-slate-200 border-b-white text-blue-600'
                            : 'bg-slate-50 border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {hoja.nombre}
                      </button>
                    ))}
                  </div>
                )}
                <div className="overflow-auto border border-slate-200 rounded-lg">
                  <table className="text-xs border-collapse w-max">
                    <tbody>
                      {hojas[hojaActiva].filas.map((fila, i) => (
                        <tr key={i}>
                          {fila.map((celda, j) => (
                            <td key={j} className="border border-slate-200 px-2 py-1 whitespace-nowrap text-slate-700">
                              {celda}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
