import { Usuario, UserRole } from '@/types/index'
import { auth } from '@lib/supabase'
import { formatearCargo } from '@lib/formato'
import { useEffect, useState } from 'react'

type Vista = 'inicio' | 'documentos' | 'config' | 'historial' | 'usuarios' | 'parte-diario' | 'compras'

interface LayoutProps {
  usuario: Usuario | null
  onLogout: () => void
  children: React.ReactNode
  activeView: Vista
  onViewChange: (view: Vista) => void
}

export const Layout = ({ usuario, onLogout, children, activeView, onViewChange }: LayoutProps) => {
  const [navExpanded, setNavExpanded] = useState(false)
  // En celular la barra no ocupa espacio: se abre como panel sobre el
  // contenido y se cierra al elegir. Antes estaba fija en 80 px incluso en
  // pantallas de 360 px, lo que dejaba ~232 px útiles para tablas
  // declaradas con min-w-[640px].
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false)
  const [sinConexion, setSinConexion] = useState(!navigator.onLine)

  useEffect(() => {
    const alConectar = () => setSinConexion(false)
    const alDesconectar = () => setSinConexion(true)
    window.addEventListener('online', alConectar)
    window.addEventListener('offline', alDesconectar)
    return () => {
      window.removeEventListener('online', alConectar)
      window.removeEventListener('offline', alDesconectar)
    }
  }, [])

  const handleLogout = async () => {
    await auth.signOut()
    onLogout()
  }

  // Al elegir una vista en celular, el panel se cierra solo.
  const irA = (vista: Vista) => {
    onViewChange(vista)
    setMenuMovilAbierto(false)
  }

  return (
    <div className="min-h-screen md:h-screen bg-slate-50 md:flex">
      {/* Fondo oscuro detrás del panel en celular */}
      {menuMovilAbierto && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setMenuMovilAbierto(false)}
          aria-hidden="true"
        />
      )}

      {/* Barra lateral. En escritorio (md+) es fija y el contenido compensa
          con margin-left. En celular queda fuera de pantalla y entra
          deslizándose solo cuando se abre. */}
      <div
        className={`${navExpanded ? 'md:w-64' : 'md:w-20'} w-64 fixed inset-y-0 left-0 z-40 h-screen bg-slate-900 text-white flex flex-col transition-transform md:transition-all duration-200
          ${menuMovilAbierto ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        {/* Toggle: en escritorio expande/colapsa; en celular cierra el panel. */}
        <button
          onClick={() => {
            if (window.innerWidth < 768) setMenuMovilAbierto(false)
            else setNavExpanded(!navExpanded)
          }}
          aria-label={navExpanded ? 'Colapsar menú' : 'Expandir menú'}
          className="p-4 hover:bg-slate-800 flex items-center justify-center min-h-[56px]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>

        {/* Nav items */}
        <nav className="flex-1 space-y-1 px-2 py-4">
          <NavItem
            icon="🏠"
            label="Inicio"
            active={activeView === 'inicio'}
            onClick={() => irA('inicio')}
            expanded={navExpanded || menuMovilAbierto}
          />

          {usuario?.rol === UserRole.COORDINADOR && (
            <>
              <NavItem
                icon="📋"
                label="Documentos"
                active={activeView === 'documentos'}
                onClick={() => irA('documentos')}
                expanded={navExpanded || menuMovilAbierto}
              />
              <NavItem
                icon="🗓️"
                label="Historial"
                active={activeView === 'historial'}
                onClick={() => irA('historial')}
                expanded={navExpanded || menuMovilAbierto}
              />
            </>
          )}

          {(usuario?.rol === UserRole.APR || usuario?.rol === UserRole.SUPERVISOR) && (
            <NavItem
              icon="🕒"
              label="Historial"
              active={activeView === 'documentos'}
              onClick={() => irA('documentos')}
              expanded={navExpanded || menuMovilAbierto}
            />
          )}

          {usuario?.rol === UserRole.CONSULTOR && (
            <NavItem
              icon="👁️"
              label="Ver documentos"
              active={activeView === 'documentos'}
              onClick={() => irA('documentos')}
              expanded={navExpanded || menuMovilAbierto}
            />
          )}

          {/* Compras: módulo nuevo, todavía solo con una vista en blanco
              (ver Compras.tsx) — pedido explícito de acceso restringido a
              coordinador y consultor únicamente, ver conversación del
              2026-08-25. Colocado justo encima de Daily Report a pedido. */}
          {(usuario?.rol === UserRole.COORDINADOR || usuario?.rol === UserRole.CONSULTOR) && (
            <NavItem
              icon="🛒"
              label="Compras"
              active={activeView === 'compras'}
              onClick={() => irA('compras')}
              expanded={navExpanded || menuMovilAbierto}
            />
          )}

          {/* Daily Report (ex "Parte Diario"): módulo independiente de
              Documentos QR — mismo login, mismo layout, datos separados
              (ver ARQUITECTURA.md). Visible para coordinador, apr,
              consultor y mandante (el rol "mandante" solo ve este
              módulo). El rol "supervisor" queda excluido a propósito —
              ver remove_supervisor_daily_report.sql, que revoca el mismo
              acceso también a nivel de RLS, no solo en este menú. */}
          {usuario?.rol !== UserRole.SUPERVISOR && (
            <NavItem
              icon="📝"
              label="Daily Report"
              active={activeView === 'parte-diario'}
              onClick={() => irA('parte-diario')}
              expanded={navExpanded || menuMovilAbierto}
            />
          )}

          {/* Usuarios va justo arriba de Configuración a propósito (pedido
              explícito) — antes estaba junto a Documentos/Historial. */}
          {usuario?.rol === UserRole.COORDINADOR && (
            <NavItem
              icon="👤"
              label="Usuarios"
              active={activeView === 'usuarios'}
              onClick={() => irA('usuarios')}
              expanded={navExpanded || menuMovilAbierto}
            />
          )}

          <NavItem
            icon="⚙️"
            label="Configuración"
            active={activeView === 'config'}
            onClick={() => irA('config')}
            expanded={navExpanded || menuMovilAbierto}
          />
        </nav>

        {/* User info + logout */}
        <div className="border-t border-slate-700 p-3 space-y-2">
          <div className="text-xs text-slate-400">
            {(navExpanded || menuMovilAbierto) && (
              <>
                <p className="font-semibold text-slate-200">{usuario?.nombre}</p>
                {/* formatearCargo, no el valor crudo de la base: antes decía
                    "apr" o "coordinador" en minúsculas. */}
                <p className="text-slate-400">{formatearCargo(usuario?.rol)}</p>
              </>
            )}
          </div>
          <button
            onClick={handleLogout}
            aria-label="Cerrar sesión"
            className="w-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
          >
            {navExpanded || menuMovilAbierto ? 'Cerrar sesión' : '⏻'}
          </button>
        </div>
      </div>

      {/* Main content: margin-left del mismo ancho que la sidebar (que ahora
          es "fixed" y salió del flujo normal), para que no quede tapado
          detrás de ella. */}
      {/* En celular no hay margen: la barra flota por encima. En escritorio
          se compensa el ancho de la barra fija. El scroll lo hace el
          documento en celular (así el navegador puede ocultar su barra de
          direcciones) y el <main> en escritorio. */}
      <div
        className={`flex flex-col md:flex-1 md:overflow-hidden ${navExpanded ? 'md:ml-64' : 'md:ml-20'} transition-all duration-200`}
      >
        {/* Topbar */}
        <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 md:py-4 flex items-center gap-3 sticky top-0 z-20 md:static">
          <button
            type="button"
            onClick={() => setMenuMovilAbierto(true)}
            aria-label="Abrir menú"
            className="md:hidden w-11 h-11 -ml-2 flex items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>

          <h1 className="text-lg md:text-xl font-bold text-slate-900 flex-1 truncate">Unificador QR</h1>

          {/* En celular no cabe el nombre completo; se ve al abrir el menú. */}
          <div className="hidden sm:block text-sm text-slate-600 truncate">
            {usuario?.nombre} · {formatearCargo(usuario?.rol)}
          </div>
        </header>

        {/* Aviso de conexión: antes la app se veía perfectamente funcional
            sin red, y el usuario solo se enteraba al intentar guardar. */}
        {sinConexion && (
          <div className="bg-amber-100 border-b border-amber-300 px-4 md:px-6 py-2 text-sm text-amber-900 text-center">
            Sin conexión — puedes seguir llenando, pero no se podrá guardar hasta que vuelva la señal.
          </div>
        )}

        {/* Content */}
        <main className="flex-1 md:overflow-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}

interface NavItemProps {
  icon: string
  label: string
  active: boolean
  onClick: () => void
  expanded: boolean
}

const NavItem = ({ icon, label, active, onClick, expanded }: NavItemProps) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
      active
        ? 'bg-blue-600 text-white'
        : 'text-slate-300 hover:bg-slate-800'
    }`}
  >
    <span className="text-lg">{icon}</span>
    {expanded && <span className="text-sm font-semibold">{label}</span>}
  </button>
)
