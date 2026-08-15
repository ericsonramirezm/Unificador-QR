import { useEffect, useState } from 'react'
import { Usuario, UserRole } from '@/types/index'
import { db } from '@lib/supabase'
import { formatearCargo } from '@lib/formato'

interface GestionUsuariosProps {
  usuario: Usuario
}

const ROLES: UserRole[] = [UserRole.COORDINADOR, UserRole.APR, UserRole.SUPERVISOR, UserRole.CONSULTOR]

export const GestionUsuarios = ({ usuario }: GestionUsuariosProps) => {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actualizandoId, setActualizandoId] = useState<string | null>(null)

  useEffect(() => {
    cargarUsuarios()
  }, [])

  const cargarUsuarios = async () => {
    setCargando(true)
    setError(null)
    try {
      const data = await db.obtenerUsuarios()
      setUsuarios(data as Usuario[])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudieron cargar los usuarios'
      setError(msg)
    } finally {
      setCargando(false)
    }
  }

  const handleCambiarRol = async (id: string, nuevoRol: UserRole) => {
    setActualizandoId(id)
    setError(null)
    try {
      await db.actualizarRolUsuario(id, nuevoRol)
      setUsuarios((prev) => prev.map((u) => (u.id === id ? { ...u, rol: nuevoRol } : u)))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo actualizar el rol'
      setError(msg)
    } finally {
      setActualizandoId(null)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-xl font-bold text-slate-900 mb-1">Usuarios</h2>
        <p className="text-sm text-slate-500 mb-4">
          Asigna el rol de cada persona registrada. Las cuentas nuevas quedan como Consultor hasta que les
          asignes un rol acá.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">{error}</div>
        )}

        {cargando ? (
          <p className="text-sm text-slate-500">Cargando usuarios...</p>
        ) : usuarios.length === 0 ? (
          <p className="text-sm text-slate-500">No hay usuarios registrados todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-4 py-2 rounded-l-lg">Nombre</th>
                  <th className="text-left px-4 py-2">Correo</th>
                  <th className="text-left px-4 py-2 rounded-r-lg">Rol</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u, idx) => {
                  const esUnoMismo = u.id === usuario.id
                  return (
                    <tr key={u.id} className={idx % 2 === 1 ? 'bg-slate-50' : ''}>
                      <td className="px-4 py-3 font-semibold text-slate-900">{u.nombre}</td>
                      <td className="px-4 py-3 text-slate-600">{u.email}</td>
                      <td className="px-4 py-3">
                        <select
                          value={u.rol}
                          disabled={esUnoMismo || actualizandoId === u.id}
                          onChange={(e) => handleCambiarRol(u.id, e.target.value as UserRole)}
                          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm disabled:bg-slate-100 disabled:text-slate-400"
                          title={esUnoMismo ? 'No puedes cambiar tu propio rol desde acá' : undefined}
                        >
                          {ROLES.map((rol) => (
                            <option key={rol} value={rol}>
                              {formatearCargo(rol)}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
