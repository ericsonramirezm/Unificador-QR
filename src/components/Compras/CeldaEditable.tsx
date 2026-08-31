import { useState } from 'react'

interface CeldaEditableProps {
  valor: string
  onGuardar: (nuevoValor: string) => Promise<void>
  tipo?: 'text' | 'date' | 'number'
  placeholder?: string
  /**
   * Si es true, no guarda al perder el foco — hay que presionar "Guardar"
   * (o Enter). Se usa en los campos que además agrupan filas (RQ, OC):
   * la fila cambia de banda/grupo apenas se guarda, y si guardara en cada
   * tecleo o al primer click afuera, la fila saltaría de grupo mientras la
   * persona todavía está escribiendo el número.
   */
  confirmarConBoton?: boolean
}

/**
 * Campo "por llenar" de RQ/OC (RQ N°, Fecha de RQ, Código Defontana, OC,
 * Proveedor, Fecha OC): llega en blanco al avanzar de etapa y se completa
 * a mano acá mismo, en la tabla — sin abrir un modal aparte.
 */
export const CeldaEditable = ({
  valor,
  onGuardar,
  tipo = 'text',
  placeholder = 'por llenar',
  confirmarConBoton = false,
}: CeldaEditableProps) => {
  const [local, setLocal] = useState(valor)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const huboCambio = local !== valor

  const confirmar = async () => {
    if (!huboCambio) return
    setGuardando(true)
    setError(null)
    try {
      await onGuardar(local)
    } catch {
      setError('No se guardó')
      setLocal(valor) // revierte: evita que la fila muestre un dato que en realidad no quedó guardado
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="relative flex items-center gap-1.5">
      <input
        type={tipo}
        value={local}
        placeholder={placeholder}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={confirmarConBoton ? undefined : confirmar}
        onKeyDown={(e) => {
          if (confirmarConBoton && e.key === 'Enter') confirmar()
        }}
        disabled={guardando}
        className="w-full px-2 py-1 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 disabled:bg-slate-50"
      />
      {confirmarConBoton && (
        <button
          type="button"
          onClick={confirmar}
          disabled={!huboCambio || guardando}
          className="shrink-0 px-2 py-1 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {guardando ? '…' : 'Guardar'}
        </button>
      )}
      {error && <p className="absolute top-full left-0 text-[11px] text-red-600 mt-0.5 whitespace-nowrap">{error}</p>}
    </div>
  )
}
