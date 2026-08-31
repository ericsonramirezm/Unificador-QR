import { useState } from 'react'
import type { RolBodega } from '@/types/index'
import { Articulos } from './catalogos/Articulos'
import { Bodegas } from './catalogos/Bodegas'
import { Proveedores, Salas, Trabajadores } from './catalogos/Simples'
import { Usuarios } from './catalogos/Usuarios'

const SECCIONES = ['articulos', 'proveedores', 'salas', 'trabajadores', 'usuarios', 'bodegas'] as const
type Seccion = (typeof SECCIONES)[number]

const ETIQUETAS: Record<Seccion, string> = {
  articulos: 'Artículos',
  proveedores: 'Proveedores',
  salas: 'Salas eléctricas',
  trabajadores: 'Trabajadores',
  usuarios: 'Usuarios',
  bodegas: 'Bodegas',
}

export function Catalogos({ rolBodega, usuarioId }: { rolBodega: RolBodega | null; usuarioId: string }) {
  const [seccion, setSeccion] = useState<Seccion>('articulos')

  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-4 text-xl font-semibold text-slate-800">Catálogos</h1>

      {/* Tira desplazable: en 375 px las seis secciones no caben, y partirlas en
          dos filas deja la navegación saltando de sitio al cambiar de pestaña. */}
      <div className="-mx-4 mb-5 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="flex w-max gap-1 border-b border-slate-200 pb-px">
          {SECCIONES.map((s) => (
            <button
              key={s}
              onClick={() => setSeccion(s)}
              className={`whitespace-nowrap rounded-t-lg px-3 py-2.5 text-sm font-medium transition ${
                s === seccion
                  ? 'border-b-2 border-blue-600 text-blue-700'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`}
            >
              {ETIQUETAS[s]}
            </button>
          ))}
        </div>
      </div>

      {seccion === 'articulos' && <Articulos rolBodega={rolBodega} />}
      {seccion === 'proveedores' && <Proveedores />}
      {seccion === 'salas' && <Salas />}
      {seccion === 'trabajadores' && <Trabajadores />}
      {seccion === 'usuarios' && <Usuarios usuarioId={usuarioId} />}
      {seccion === 'bodegas' && <Bodegas />}
    </div>
  )
}
