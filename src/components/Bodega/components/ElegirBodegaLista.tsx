import { useState } from 'react'
import type { Bodega } from '../tipos'

/**
 * Lista de bodegas activas para elegir, con un solo clic (sin paso de
 * "confirmar" aparte). La usan dos consumidores con distinto empaque visual:
 * el gate obligatorio tras el login (`pages/ElegirBodega.tsx`) y el switcher
 * del header de `Bodega.tsx` (`components/CambiarBodegaBoton.tsx`).
 */
export function ElegirBodegaLista({
  bodegas,
  valorActual,
  onElegir,
}: {
  bodegas: Bodega[]
  valorActual: string | null
  onElegir: (id: string) => Promise<void>
}) {
  const [eligiendo, setEligiendo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function elegir(id: string) {
    setError(null)
    setEligiendo(id)
    try {
      await onElegir(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setEligiendo(null)
    }
  }

  if (bodegas.length === 0) {
    return (
      <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
        Todavía no existe ninguna bodega activa. Un Administrador debe crearla en Catálogos →
        Bodegas.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {bodegas.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => elegir(b.id)}
            disabled={eligiendo !== null}
            className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-sm font-medium transition disabled:opacity-60 ${
              b.id === valorActual
                ? 'border-blue-500 bg-blue-50 text-blue-800'
                : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
            }`}
          >
            {b.nombre}
            {eligiendo === b.id && <span className="text-xs text-slate-500">Guardando…</span>}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
