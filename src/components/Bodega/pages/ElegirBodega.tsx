import { useCallback } from 'react'
import { ElegirBodegaLista } from '../components/ElegirBodegaLista'
import { useCargar } from '../lib/useCargar'
import { listarBodegas } from '../lib/servicios/catalogos'

/**
 * Gate obligatorio dentro de `Bodega.tsx`: sin bodega elegida no se ve ni se
 * registra nada, para ningún rol. `onElegir` guarda el id en el `useState`
 * local de `Bodega.tsx` (ver el plan, sección 3 — en esta fase no se persiste
 * contra ningún Supabase, ni el viejo de Bodega ni el de Unificador-QR).
 */
export function ElegirBodega({ onElegir }: { onElegir: (id: string) => void }) {
  const cargar = useCallback(async () => (await listarBodegas()).filter((b) => b.activo), [])
  const { datos: bodegas, cargando, error } = useCargar(cargar)

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-slate-800">¿En qué bodega trabajas?</h1>
          <p className="text-sm text-slate-500">
            Elige una bodega para continuar. Tus entradas y salidas se registrarán ahí durante
            esta sesión.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {cargando ? (
            <p className="text-sm text-slate-500">Cargando…</p>
          ) : error ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : (
            <ElegirBodegaLista
              bodegas={bodegas ?? []}
              valorActual={null}
              onElegir={async (id) => onElegir(id)}
            />
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">
          Puedes cambiarla más tarde desde el botón "Bodega" en la parte superior del módulo.
        </p>
      </div>
    </div>
  )
}
