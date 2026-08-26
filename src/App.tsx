import { useEffect, useState } from 'react'
import { Login } from '@components/Auth/Login'
import { Layout } from '@components/Layout/Layout'
import { DocumentList } from '@components/DocumentList/DocumentList'
import { HistorialAprobados } from '@components/History/HistorialAprobados'
import { GestionUsuarios } from '@components/Users/GestionUsuarios'
import { ParteDiarioList } from '@components/ParteDiario/ParteDiarioList'
import { Inicio } from '@components/Inicio/Inicio'
import { Compras } from '@components/Compras/Compras'
import { Usuario, UserRole } from '@/types/index'
import { auth, db } from '@lib/supabase'

type Vista = 'inicio' | 'documentos' | 'config' | 'historial' | 'usuarios' | 'parte-diario' | 'compras'

export function App() {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activeView, setActiveView] = useState<Vista>('inicio')
  const [contratoActivo, setContratoActivo] = useState<any>(null)

  useEffect(() => {
    checkAuth()
  }, [])

  const cargarContratoActivo = async () => {
    try {
      const contrato = await db.getContratoActivo()
      setContratoActivo(contrato || null)
    } catch (err) {
      console.error('Error al cargar el contrato activo:', err)
    }
  }

  const checkAuth = async () => {
    try {
      const currentUser = await auth.getCurrentUser()
      if (currentUser) {
        const profile = await auth.getUserProfile(currentUser.id)
        setUsuario(profile)
        await cargarContratoActivo()
      }
    } catch (err) {
      // Usuario no autenticado, mostrar login
    } finally {
      setIsLoading(false)
    }
  }

  const handleLoginSuccess = async (userId: string) => {
    try {
      const profile = await auth.getUserProfile(userId)
      setUsuario(profile)
      await cargarContratoActivo()
    } catch (err) {
      console.error('Error al cargar perfil:', err)
    }
  }

  const handleLogout = () => {
    setUsuario(null)
    setContratoActivo(null)
    setActiveView('inicio')
  }

  if (isLoading) {
    return (
      <div className="h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Cargando...</p>
        </div>
      </div>
    )
  }

  if (!usuario) {
    return <Login onLoginSuccess={handleLoginSuccess} />
  }

  return (
    <Layout
      usuario={usuario}
      onLogout={handleLogout}
      activeView={activeView}
      onViewChange={setActiveView}
    >
      {activeView === 'inicio' && (
        <Inicio usuario={usuario} contrato={contratoActivo} onNavigate={setActiveView} />
      )}

      {activeView === 'documentos' && <DocumentList usuario={usuario} contrato={contratoActivo} />}

      {activeView === 'historial' && usuario.rol === UserRole.COORDINADOR && (
        <HistorialAprobados usuario={usuario} contrato={contratoActivo} />
      )}

      {activeView === 'usuarios' && usuario.rol === UserRole.COORDINADOR && (
        <GestionUsuarios usuario={usuario} />
      )}

      {activeView === 'parte-diario' && usuario.rol !== UserRole.SUPERVISOR && (
        <ParteDiarioList usuario={usuario} contrato={contratoActivo} />
      )}

      {activeView === 'compras' && (usuario.rol === UserRole.COORDINADOR || usuario.rol === UserRole.CONSULTOR) && (
        <Compras />
      )}

      {activeView === 'config' && (
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Configuración</h2>
          <div className="space-y-4">
            {contratoActivo?.mandante && (
              <div>
                <p className="text-sm text-slate-500">Mandante</p>
                <p className="text-lg font-semibold text-slate-900">{contratoActivo.mandante}</p>
              </div>
            )}
            <div>
              <p className="text-sm text-slate-500">Contrato activo</p>
              <p className="text-lg font-semibold text-slate-900">
                {contratoActivo?.codigo} · {contratoActivo?.nombre}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Tu perfil</p>
              <p className="text-lg font-semibold text-slate-900">{usuario.nombre} ({usuario.rol})</p>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

export default App
