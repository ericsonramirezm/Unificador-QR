import { Usuario, UserRole } from '@/types/index'
import { auth } from '@lib/supabase'
import { useState } from 'react'

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

  const handleLogout = async () => {
    await auth.signOut()
    onLogout()
  }

  return (
    <div className="h-screen bg-slate-50 flex">
      {/* Sidebar: fija (position fixed) para que no se mueva al hacer scroll
          en el contenido — el contenido de al lado compensa con margin-left
          del mismo ancho (ver más abajo), que también anima junto con el
          expand/collapse. */}
      <div className={`${navExpanded ? 'w-64' : 'w-20'} fixed inset-y-0 left-0 z-30 h-screen bg-slate-900 text-white flex flex-col transition-all duration-200`}>
        {/* Toggle */}
        <button
          onClick={() => setNavExpanded(!navExpanded)}
          className="p-4 hover:bg-slate-800 flex items-center justify-center"
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
            onClick={() => onViewChange('inicio')}
            expanded={navExpanded}
          />

          {usuario?.rol === UserRole.COORDINADOR && (
            <>
              <NavItem
                icon="📋"
                label="Documentos"
                active={activeView === 'documentos'}
                onClick={() => onViewChange('documentos')}
                expanded={navExpanded}
              />
              <NavItem
                icon="🗓️"
                label="Historial"
                active={activeView === 'historial'}
                onClick={() => onViewChange('historial')}
                expanded={navExpanded}
              />
            </>
          )}

          {(usuario?.rol === UserRole.APR || usuario?.rol === UserRole.SUPERVISOR) && (
            <NavItem
              icon="🕒"
              label="Historial"
              active={activeView === 'documentos'}
              onClick={() => onViewChange('documentos')}
              expanded={navExpanded}
            />
          )}

          {usuario?.rol === UserRole.CONSULTOR && (
            <NavItem
              icon="👁️"
              label="Ver documentos"
              active={activeView === 'documentos'}
              onClick={() => onViewChange('documentos')}
              expanded={navExpanded}
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
              onClick={() => onViewChange('compras')}
              expanded={navExpanded}
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
              onClick={() => onViewChange('parte-diario')}
              expanded={navExpanded}
            />
          )}

          {/* Usuarios va justo arriba de Configuración a propósito (pedido
              explícito) — antes estaba junto a Documentos/Historial. */}
          {usuario?.rol === UserRole.COORDINADOR && (
            <NavItem
              icon="👤"
              label="Usuarios"
              active={activeView === 'usuarios'}
              onClick={() => onViewChange('usuarios')}
              expanded={navExpanded}
            />
          )}

          <NavItem
            icon="⚙️"
            label="Configuración"
            active={activeView === 'config'}
            onClick={() => onViewChange('config')}
            expanded={navExpanded}
          />
        </nav>

        {/* User info + logout */}
        <div className="border-t border-slate-700 p-3 space-y-2">
          <div className="text-xs text-slate-400">
            {navExpanded && (
              <>
                <p className="font-semibold text-slate-200">{usuario?.nombre}</p>
                <p className="text-slate-500">{usuario?.rol}</p>
              </>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="w-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
          >
            {navExpanded ? 'Cerrar sesión' : '⏻'}
          </button>
        </div>
      </div>

      {/* Main content: margin-left del mismo ancho que la sidebar (que ahora
          es "fixed" y salió del flujo normal), para que no quede tapado
          detrás de ella. */}
      <div className={`flex-1 flex flex-col overflow-hidden ${navExpanded ? 'ml-64' : 'ml-20'} transition-all duration-200`}>
        {/* Topbar */}
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900">Unificador QR</h1>
          <div className="text-sm text-slate-600">
            {usuario?.nombre} · {usuario?.rol}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
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
