import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { auth } from '@lib/supabase'
import { traducirError } from '@lib/errores'

interface LoginFormData {
  email: string
  password: string
}

interface LoginProps {
  onLoginSuccess: (userId: string) => void
}

export const Login = ({ onLoginSuccess }: LoginProps) => {
  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormData>()
  const [isLoading, setIsLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true)
    setErrorMsg(null)

    try {
      const result = await auth.signIn(data.email, data.password)
      if (result.user?.id) {
        onLoginSuccess(result.user.id)
      }
    } catch (err) {
      const message = traducirError(err, 'Error al iniciar sesión')
      setErrorMsg(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center px-4">
      {/* Fondo decorativo */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute w-96 h-96 bg-blue-400 rounded-full blur-3xl top-0 left-0 -translate-x-1/2 -translate-y-1/2"></div>
        <div className="absolute w-96 h-96 bg-blue-300 rounded-full blur-3xl bottom-0 right-0 translate-x-1/2 translate-y-1/2"></div>
      </div>

      {/* Card de login */}
      <div className="relative z-10 w-full max-w-md bg-white rounded-xl shadow-2xl p-8">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="w-12 h-12 bg-blue-600 text-white rounded-lg flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="9" y1="9" x2="15" y2="9"></line>
              <line x1="9" y1="15" x2="15" y2="15"></line>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Unificador QR</h1>
          <p className="text-sm text-slate-500 mt-1">Gestión de documentos SPCI</p>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Email */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Correo electrónico
            </label>
            <input
              type="email"
              placeholder="admin@example.com"
              {...register('email', {
                required: 'El correo es requerido',
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: 'Correo inválido',
                },
              })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
            />
            {errors.email && (
              <p className="text-red-600 text-xs mt-1">{errors.email.message}</p>
            )}
          </div>

          {/* Contraseña */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Contraseña
            </label>
            <input
              type="password"
              placeholder="••••••••"
              {...register('password', {
                required: 'La contraseña es requerida',
                minLength: {
                  value: 6,
                  message: 'Mínimo 6 caracteres',
                },
              })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
            />
            {errors.password && (
              <p className="text-red-600 text-xs mt-1">{errors.password.message}</p>
            )}
          </div>

          {/* Error general */}
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {errorMsg}
            </div>
          )}

          {/* Botón */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white font-semibold py-2 rounded-lg hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? 'Iniciando sesión...' : 'Iniciar sesión'}
          </button>
        </form>

        {/* Footer */}
        <p className="text-center text-xs text-slate-500 mt-6">
          Sesión local — Contacta al administrador para acceso
        </p>
      </div>
    </div>
  )
}
