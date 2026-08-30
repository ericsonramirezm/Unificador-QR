import { useState } from 'react'

interface CeldaEditableProps {
  valor: string
  onGuardar: (nuevoValor: string) => Promise<void>
  tipo?: 'text' | 'date'
  placeholder?: string
}

/**
 * Campo "por llenar" de RQ/OC (RQ N°, Fecha de RQ, Código Defontana, OC):
 * llega en blanco al avanzar de etapa y se completa a mano acá mismo, en
 * la tabla — sin abrir un modal aparte. Guarda al perder el foco, solo si
 * el valor cambió.
 */
export const CeldaEditable = ({ valor, onGuardar, tipo = 'text', placeholder = 'por llenar' }: CeldaEditableProps) => {
  const [local, setLocal] = useState(valor)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmar = async () => {
    if (local === valor) return
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
    <div className="relative">
      <input
        type={tipo}
        value={local}
        placeholder={placeholder}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={confirmar}
        disabled={guardando}
        className="w-full px-2 py-1 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 disabled:bg-slate-50"
      />
      {error && <p className="text-[11px] text-red-600 mt-0.5">{error}</p>}
    </div>
  )
}
