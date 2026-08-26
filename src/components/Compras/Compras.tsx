import { useState } from 'react'
import { NuevaSolicitudCompraModal } from './NuevaSolicitudCompraModal'

// Módulo de Compras. Todavía no tiene listado de solicitudes ni guardado
// en Supabase (no existe tabla para esto aún) — solo el botón "Nueva
// Solicitud de Compra" y su formulario (carga de documento de respaldo +
// vista previa + tabla dinámica de ítems), ver NuevaSolicitudCompraModal.tsx.
// El resto del módulo (listado, guardado real) se construye en pedidos
// aparte.
export const Compras = () => {
  const [mostrarNuevaSolicitud, setMostrarNuevaSolicitud] = useState(false)

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-900">Módulo de Compras</h2>
        <button
          type="button"
          onClick={() => setMostrarNuevaSolicitud(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors shrink-0"
        >
          <span className="text-base leading-none">+</span>
          {/* En pantallas angostas se muestra solo el ícono, para que el
              botón no empuje el título fuera del encabezado. */}
          <span className="hidden sm:inline">Nueva Solicitud de Compra</span>
        </button>
      </div>

      {mostrarNuevaSolicitud && (
        <NuevaSolicitudCompraModal onCerrar={() => setMostrarNuevaSolicitud(false)} />
      )}
    </div>
  )
}
