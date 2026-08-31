import { useCallback, useState } from 'react'
import { Aviso, claseControl } from '../../components/Campo'
import { TablaCatalogo, type Columna } from '../../components/TablaCatalogo'
import { useCargar } from '../../lib/useCargar'
import {
  cambiarActivo,
  cambiarRol,
  esElUltimoAdmin,
  listarPerfiles,
  type PerfilBodegaAntiguo,
} from '../../lib/servicios/catalogos'
import { ETIQUETA_ROL } from '../../permisos'
import { RolBodega } from '@/types/index'

const ROLES: RolBodega[] = [RolBodega.ADMIN, RolBodega.BODEGUERO, RolBodega.PREVENCIONISTA, RolBodega.CONSULTA]

/**
 * Administra `perfiles` del Supabase VIEJO de Bodega (ver la nota en
 * `lib/servicios/catalogos.ts`) — NO es lo mismo que el usuario ya
 * autenticado en Unificador-QR. `usuarioId` solo sirve para resaltar "tú" si
 * por coincidencia calza con el `id` de alguna fila de ese proyecto viejo;
 * en esta fase (sin login propio de Bodega) lo normal es que no calce con
 * ninguna, y la insignia simplemente no aparece. No es un error.
 */
export function Usuarios({ usuarioId }: { usuarioId: string }) {
  const cargar = useCallback(() => listarPerfiles(), [])
  const { datos, cargando, error, recargar } = useCargar(cargar)
  const perfiles = datos ?? []
  const [errorAccion, setErrorAccion] = useState<string | null>(null)

  /**
   * Deja al sistema sin ningún administrador activo, y entonces ya no hay quien
   * pueda arreglarlo desde la app: habría que volver al SQL Editor de Supabase.
   * Por eso se bloquea aquí. No está en la base a propósito — un trigger que lo
   * impidiera dejaría un proyecto recién creado sin forma de asignar el primer rol.
   */
  function motivoBloqueo(p: PerfilBodegaAntiguo, accion: 'rol' | 'activo'): string | null {
    if (!esElUltimoAdmin(perfiles, p.id)) return null
    return accion === 'rol'
      ? 'Es el único administrador activo: si le quitas el rol, nadie podrá volver a asignarlo desde la app.'
      : 'Es el único administrador activo: si lo desactivas, nadie podrá administrar el sistema.'
  }

  async function accion(fn: () => Promise<unknown>) {
    setErrorAccion(null)
    try {
      await fn()
      recargar()
    } catch (e) {
      setErrorAccion(e instanceof Error ? e.message : String(e))
    }
  }

  const columnas: Columna<PerfilBodegaAntiguo>[] = [
    {
      clave: 'nombre',
      titulo: 'Nombre',
      principal: true,
      render: (p) => (
        <span>
          {p.nombre}
          {p.id === usuarioId && <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">tú</span>}
        </span>
      ),
    },
    {
      clave: 'rol',
      titulo: 'Rol',
      render: (p) => {
        const bloqueo = motivoBloqueo(p, 'rol')
        return (
          <select
            value={p.rol}
            title={bloqueo ?? undefined}
            onChange={(e) => {
              const nuevo = e.target.value as RolBodega
              if (nuevo !== RolBodega.ADMIN && bloqueo) return setErrorAccion(bloqueo)
              accion(() => cambiarRol(p.id, nuevo))
            }}
            className={`${claseControl} py-1.5`}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ETIQUETA_ROL[r]}
              </option>
            ))}
          </select>
        )
      },
    },
    {
      clave: 'activo',
      titulo: 'Activo',
      render: (p) => {
        const bloqueo = motivoBloqueo(p, 'activo')
        return (
          <label className="flex items-center gap-2" title={bloqueo ?? undefined}>
            <input
              type="checkbox"
              checked={p.activo}
              onChange={(e) => {
                if (!e.target.checked && bloqueo) return setErrorAccion(bloqueo)
                accion(() => cambiarActivo(p.id, e.target.checked))
              }}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span className="text-sm text-slate-600">{p.activo ? 'Sí' : 'No'}</span>
          </label>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <Aviso tono="info">
        Las cuentas se crean invitando a la persona desde el panel de Supabase (Authentication → Users). Aquí solo se
        les asigna el rol. Un usuario nuevo aparece siempre como <b>Consulta</b>.
      </Aviso>

      {error && <Aviso tono="error">{error}</Aviso>}
      {errorAccion && <Aviso tono="error">{errorAccion}</Aviso>}

      {cargando ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <TablaCatalogo columnas={columnas} filas={perfiles} vacio="No hay usuarios registrados." />
      )}
    </div>
  )
}
