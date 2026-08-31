import { useState } from 'react'
import type { Usuario } from '@/types/index'
import { CambiarBodegaBoton } from './components/CambiarBodegaBoton'
import { ElegirBodega } from './pages/ElegirBodega'
import { Stock } from './pages/Stock'
import { Movimientos } from './pages/Movimientos'
import { Recepcion } from './pages/Recepcion'
import { Salidas } from './pages/Salidas'
import { Epp } from './pages/Epp'
import { Catalogos } from './pages/Catalogos'
import { puedeRegistrar, esAdmin } from './permisos'

type SeccionBodega = 'stock' | 'movimientos' | 'recepcion' | 'salidas' | 'epp' | 'catalogos'

interface BodegaProps {
  usuario: Usuario
}

const TODAS_LAS_PESTANAS: { id: SeccionBodega; etiqueta: string }[] = [
  { id: 'stock', etiqueta: 'Stock' },
  { id: 'movimientos', etiqueta: 'Movimientos' },
  { id: 'recepcion', etiqueta: 'Recepción' },
  { id: 'salidas', etiqueta: 'Salidas' },
  { id: 'epp', etiqueta: 'EPP' },
  { id: 'catalogos', etiqueta: 'Catálogos' },
]

/**
 * Shell del módulo Bodega — reemplaza `App.tsx` + rutas de la app standalone
 * original. Navega con pestañas internas (`useState`), igual que `Compras.tsx`:
 * sin React Router, sin deep-linking, como el resto de Unificador-QR.
 *
 * No hay `ProveedorSesion`/`useSesion` propios (esos desaparecieron con
 * `lib/sesion.tsx`, que no se portó): el rol sale de `usuario.rol_bodega`
 * (prop) y la bodega elegida vive en un `useState` local — TEMPORAL mientras
 * el módulo siga apuntando al Supabase viejo de Bodega (ver
 * `lib/supabaseBodega.ts`) y `usuarios` de Unificador-QR no tenga todavía la
 * columna `bodega_actual_id` real (Fase 3/4).
 */
export function Bodega({ usuario }: BodegaProps) {
  const rolBodega = usuario.rol_bodega ?? null
  const [seccion, setSeccion] = useState<SeccionBodega>('stock')
  const [bodegaActualId, setBodegaActualId] = useState<string | null>(null)

  // Sin rol de Bodega: ni siquiera se pide elegir bodega. Versión inline de lo
  // que era `pages/SinRol.tsx` en la app standalone.
  if (!rolBodega) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h1 className="font-semibold text-amber-900">No tienes acceso al módulo Bodega</h1>
          <p className="mt-2 text-sm text-amber-800">
            Tu usuario no tiene un rol asignado en Bodega, así que no puedes ver ni registrar nada acá. Pídele a un
            Administrador que te lo asigne.
          </p>
        </div>
      </div>
    )
  }

  // Con rol pero sin bodega elegida: gate obligatorio, para los cuatro roles —
  // sin eso, Recepción/Salidas/EPP no sabrían dónde registrar, y Stock no
  // sabría qué mostrar por defecto para quien no puede ver todas.
  if (!bodegaActualId) {
    return <ElegirBodega onElegir={setBodegaActualId} />
  }

  // Pestañas visibles según lo que ese rol puede registrar — mismo criterio
  // que antes usaba el guardia de ruta `Restringido` de App.tsx.
  const pestanas = TODAS_LAS_PESTANAS.filter((p) => {
    if (p.id === 'recepcion') return puedeRegistrar(rolBodega, 'ENTRADA')
    if (p.id === 'salidas') return puedeRegistrar(rolBodega, 'SALIDA_SALA')
    if (p.id === 'epp') return puedeRegistrar(rolBodega, 'ENTREGA_EPP')
    if (p.id === 'catalogos') return esAdmin(rolBodega)
    return true
  })

  // Si el rol cambió y la pestaña activa ya no está permitida, se cae a Stock
  // — siempre visible para los cuatro roles.
  const seccionActiva = pestanas.some((p) => p.id === seccion) ? seccion : 'stock'

  // El switcher navega a Stock al confirmar, igual que hacía el original con
  // React Router: es la forma más simple de invalidar cualquier línea ya
  // capturada en Recepción/Salidas/EPP si el cambio de bodega ocurre a mitad
  // de una captura, sin replicar el reseteo pantalla por pantalla.
  function cambiarBodega(id: string) {
    setBodegaActualId(id)
    setSeccion('stock')
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-900">Bodega</h2>
        <CambiarBodegaBoton bodegaActualId={bodegaActualId} onElegir={cambiarBodega} />
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {pestanas.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setSeccion(p.id)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              seccionActiva === p.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      {seccionActiva === 'stock' && <Stock rolBodega={rolBodega} bodegaActualId={bodegaActualId} />}
      {seccionActiva === 'movimientos' && <Movimientos rolBodega={rolBodega} />}
      {seccionActiva === 'recepcion' && <Recepcion rolBodega={rolBodega} bodegaActualId={bodegaActualId} />}
      {seccionActiva === 'salidas' && <Salidas bodegaActualId={bodegaActualId} />}
      {seccionActiva === 'epp' && <Epp bodegaActualId={bodegaActualId} />}
      {seccionActiva === 'catalogos' && <Catalogos rolBodega={rolBodega} usuarioId={usuario.id} />}
    </div>
  )
}
