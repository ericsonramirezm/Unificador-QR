import { useState, type ReactNode } from 'react'
import { Aviso, Boton } from './Campo'
import { Modal } from './Modal'

/**
 * Confirmación antes de una acción de un solo clic con consecuencias —
 * "Eliminar" en catálogos, "Anular" en movimientos. No cierra si `onConfirmar`
 * lanza: el error queda visible dentro del propio diálogo, igual que el resto
 * de los formularios del proyecto.
 */
export function DialogoConfirmacion({
  abierto,
  titulo,
  mensaje,
  etiquetaConfirmar = 'Eliminar',
  onCerrar,
  onConfirmar,
  children,
  confirmarDeshabilitado,
}: {
  abierto: boolean
  titulo: string
  mensaje?: ReactNode
  etiquetaConfirmar?: string
  onCerrar: () => void
  onConfirmar: () => Promise<void>
  /** Campos extra, p. ej. el textarea de motivo al anular. */
  children?: ReactNode
  confirmarDeshabilitado?: boolean
}) {
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!abierto) return null

  async function confirmar() {
    setError(null)
    setCargando(true)
    try {
      await onConfirmar()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setCargando(false)
    }
  }

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo={titulo} ancho="sm">
      <div className="space-y-4">
        {mensaje && <p className="text-sm text-slate-600">{mensaje}</p>}
        {children}
        {error && <Aviso tono="error">{error}</Aviso>}
        <div className="flex justify-end gap-2">
          <Boton type="button" variante="secundario" onClick={onCerrar} disabled={cargando}>
            Cancelar
          </Boton>
          <Boton type="button" variante="peligro" onClick={confirmar} disabled={cargando || confirmarDeshabilitado}>
            {cargando ? 'Procesando…' : etiquetaConfirmar}
          </Boton>
        </div>
      </div>
    </Modal>
  )
}
