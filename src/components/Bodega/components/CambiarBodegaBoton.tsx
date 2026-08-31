import { useCallback, useState } from 'react'
import { Modal } from './Modal'
import { ElegirBodegaLista } from './ElegirBodegaLista'
import { useCargar } from '../lib/useCargar'
import { listarBodegas } from '../lib/servicios/catalogos'

/**
 * Cambiar de bodega sin cerrar sesión. Va en el header de `Bodega.tsx`, no en
 * una barra propia del módulo (esa se eliminó — la navegación global es la de
 * Unificador-QR).
 *
 * Al elegir, `onCambiada` debe además llevar al usuario a la pestaña Stock:
 * es la forma más simple de invalidar cualquier línea ya capturada en
 * Recepción/Salidas/EPP si el cambio ocurre a mitad de una captura, sin
 * replicar ese reseteo pantalla por pantalla (antes lo hacía un `navigate`
 * de React Router; aquí lo decide `Bodega.tsx`).
 */
export function CambiarBodegaBoton({
  bodegaActualId,
  onElegir,
  className,
}: {
  bodegaActualId: string | null
  /** Cambia la bodega Y navega a Stock — ver `Bodega.tsx`. */
  onElegir: (id: string) => void
  className?: string
}) {
  const [abierto, setAbierto] = useState(false)

  const cargar = useCallback(async () => (await listarBodegas()).filter((b) => b.activo), [])
  const { datos: bodegas } = useCargar(cargar)

  const nombreActual = bodegas?.find((b) => b.id === bodegaActualId)?.nombre ?? '—'

  async function elegir(id: string) {
    onElegir(id)
    setAbierto(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={className ?? 'flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-600 hover:bg-slate-100'}
      >
        <span className="truncate">Bodega: {nombreActual}</span>
        <span className="text-xs text-slate-400">Cambiar</span>
      </button>

      {abierto && (
        <Modal abierto onCerrar={() => setAbierto(false)} titulo="Cambiar de bodega" ancho="sm">
          <ElegirBodegaLista bodegas={bodegas ?? []} valorActual={bodegaActualId} onElegir={elegir} />
        </Modal>
      )}
    </>
  )
}
