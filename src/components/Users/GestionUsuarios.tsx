import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Usuario, UserRole } from '@/types/index'
import { db } from '@lib/supabase'
import { formatearCargo } from '@lib/formato'
import { traducirError } from '@lib/errores'

interface GestionUsuariosProps {
  usuario: Usuario
}

interface VincularFormData {
  id: string
  nombre: string
  email: string
  rol: UserRole
}

const ROLES: UserRole[] = [UserRole.COORDINADOR, UserRole.APR, UserRole.SUPERVISOR, UserRole.CONSULTOR]

export const GestionUsuarios = ({ usuario }: GestionUsuariosProps) => {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actualizandoId, setActualizandoId] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<VincularFormData>({ defaultValues: { rol: UserRole.CONSULTOR } })
  const [vinculando, setVinculando] = useState(false)
  const [errorVincular, setErrorVincular] = useState<string | null>(null)
  const [exitoVincular, setExitoVincular] = useState<string | null>(null)

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
      const msg = traducirError(err, 'No se pudieron cargar los usuarios')
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
      const msg = traducirError(err, 'No se pudo actualizar el rol')
      setError(msg)
    } finally {
      setActualizandoId(null)
    }
  }

  const handleVincular = async (data: VincularFormData) => {
    setVinculando(true)
    setErrorVincular(null)
    setExitoVincular(null)
    try {
      const nuevo = await db.crearUsuario({
        id: data.id.trim(),
        nombre: data.nombre.trim(),
        email: data.email.trim(),
        rol: data.rol,
      })
      setUsuarios((prev) => [...prev, nuevo as Usuario].sort((a, b) => a.nombre.localeCompare(b.nombre)))
      setExitoVincular(`${nuevo.nombre} quedó vinculado como ${formatearCargo(nuevo.rol)}.`)
      reset({ id: '', nombre: '', email: '', rol: UserRole.CONSULTOR })
    } catch (err) {
      const msg = traducirError(err, 'No se pudo vincular el usuario')
      setErrorVincular(msg)
    } finally {
      setVinculando(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-xl font-bold text-slate-900 mb-1">Vincular usuario nuevo</h2>
        <p className="text-sm text-slate-500 mb-4">
          Las cuentas se crean en Supabase (Authentication → Users), no acá. Después de crear la cuenta ahí,
          copia su UID y complétalo abajo junto con su nombre, correo y rol para que pueda usar la app.
        </p>

        <form onSubmit={handleSubmit(handleVincular)} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">UID (de Supabase Auth)</label>
            <input
              type="text"
              placeholder="ej. 3fa85f64-5717-4562-b3fc-2c963f66afa6"
              {...register('id', { required: 'El UID es requerido' })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
            />
            {errors.id && <p className="text-red-600 text-xs mt-1">{errors.id.message}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Nombre completo</label>
            <input
              type="text"
              placeholder="Juan Pérez"
              {...register('nombre', { required: 'El nombre es requerido' })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
            />
            {errors.nombre && <p className="text-red-600 text-xs mt-1">{errors.nombre.message}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Correo</label>
            <input
              type="email"
              placeholder="juan@example.com"
              {...register('email', { required: 'El correo es requerido' })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
            />
            {errors.email && <p className="text-red-600 text-xs mt-1">{errors.email.message}</p>}
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">Rol</label>
            <select
              {...register('rol', { required: true })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
            >
              {ROLES.map((rol) => (
                <option key={rol} value={rol}>
                  {formatearCargo(rol)}
                </option>
              ))}
            </select>
          </div>

          {errorVincular && (
            <div className="sm:col-span-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {errorVincular}
            </div>
          )}
          {exitoVincular && (
            <div className="sm:col-span-2 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
              {exitoVincular}
            </div>
          )}

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={vinculando}
              className="w-full sm:w-auto bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-slate-400"
            >
              {vinculando ? 'Vinculando...' : 'Vincular usuario'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-xl font-bold text-slate-900 mb-1">Usuarios</h2>
        <p className="text-sm text-slate-500 mb-4">Cambia el rol de cualquier persona vinculada.</p>

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
