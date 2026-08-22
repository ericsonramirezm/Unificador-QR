import { useEffect, useState } from 'react'
import { db } from '@lib/supabase'
import { DocumentStatus, ParteDiarioEstado, UserRole, Usuario } from '@/types/index'

interface InicioProps {
  usuario: Usuario
  contrato: any
  onNavigate: (vista: 'documentos' | 'parte-diario') => void
}

interface Tarjeta {
  label: string
  valor: number
  detalle?: string
  icon: string
  onClick: () => void
  destacar?: boolean
}

// Pantalla de inicio estilo Aconex: un resumen de tarjetas por rol, con
// link directo al módulo correspondiente. Reutiliza los mismos helpers
// (obtenerDocumentos, obtenerPartesDiarios) que ya usan Documentos QR y
// Daily Report — las filas que cada rol puede ver ya vienen acotadas por
// RLS (Daily Report) o por la misma convención que ya usa DocumentList
// (Documentos QR: coordinador ve todo el contrato, el resto solo lo
// suyo). El rol "mandante" no ve Documentos QR (nunca lo vio); el rol
// "supervisor" no ve Daily Report (ver remove_supervisor_daily_report.sql).
// Pensada para que sumar un módulo nuevo más adelante solo agregue su
// propia tarjeta acá, sin rediseñar la pantalla.
export const Inicio = ({ usuario, contrato, onNavigate }: InicioProps) => {
  const [documentos, setDocumentos] = useState<any[] | null>(null)
  const [partes, setPartes] = useState<any[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const veDocumentos = usuario.rol !== UserRole.MANDANTE
  const veDailyReport = usuario.rol !== UserRole.SUPERVISOR

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contrato?.id])

  const cargar = async () => {
    if (!contrato?.id) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const filtrosDocs: any = usuario.rol === UserRole.COORDINADOR ? {} : { creado_por: usuario.id }
      const [docs, partesData] = await Promise.all([
        veDocumentos ? db.obtenerDocumentos(filtrosDocs) : Promise.resolve(null),
        veDailyReport ? db.obtenerPartesDiarios(contrato.id) : Promise.resolve(null),
      ])
      setDocumentos(docs)
      setPartes(partesData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el resumen')
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">Cargando…</div>
  }

  const docsPendientes = documentos?.filter((d) => d.estado === DocumentStatus.PENDIENTE).length ?? 0
  const docsTotal = documentos?.length ?? 0

  const partesBorrador = partes?.filter((p) => p.estado === ParteDiarioEstado.BORRADOR).length ?? 0
  const partesEnviados = partes?.filter((p) => p.estado === ParteDiarioEstado.ENVIADO).length ?? 0
  const partesComentados = partes?.filter((p) => p.estado === ParteDiarioEstado.COMENTADO_MANDANTE).length ?? 0
  const partesTotal = partes?.length ?? 0

  const tarjetas: Tarjeta[] = []

  if (veDocumentos) {
    tarjetas.push({
      label: usuario.rol === UserRole.COORDINADOR ? 'Documentos pendientes de aprobar' : 'Mis documentos pendientes',
      valor: docsPendientes,
      detalle: `${docsTotal} en total`,
      icon: '📋',
      onClick: () => onNavigate('documentos'),
      destacar: docsPendientes > 0,
    })
  }

  if (veDailyReport) {
    if (usuario.rol === UserRole.MANDANTE) {
      tarjetas.push({
        label: 'Daily Reports esperando tu comentario',
        valor: partesEnviados,
        detalle: `${partesComentados} ya comentados`,
        icon: '📝',
        onClick: () => onNavigate('parte-diario'),
        destacar: partesEnviados > 0,
      })
    } else if (usuario.rol === UserRole.CONSULTOR) {
      tarjetas.push({
        label: 'Daily Reports enviados',
        valor: partesTotal,
        icon: '📝',
        onClick: () => onNavigate('parte-diario'),
      })
    } else if (usuario.rol === UserRole.COORDINADOR) {
      tarjetas.push({
        label: 'Daily Reports del contrato',
        valor: partesTotal,
        detalle: `${partesEnviados} sin comentario del mandante`,
        icon: '📝',
        onClick: () => onNavigate('parte-diario'),
      })
    } else {
      // apr
      tarjetas.push({
        label: 'Mis Daily Reports',
        valor: partesBorrador + partesEnviados,
        detalle: `${partesBorrador} en borrador`,
        icon: '📝',
        onClick: () => onNavigate('parte-diario'),
        destacar: partesBorrador > 0,
      })
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Hola, {usuario.nombre.split(' ')[0]}</h2>
        <p className="text-sm text-slate-500">
          {contrato?.codigo} · {contrato?.nombre}
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

      {tarjetas.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
          No hay nada pendiente por ahora.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tarjetas.map((t) => (
            <button
              key={t.label}
              onClick={t.onClick}
              className={`text-left bg-white rounded-lg border p-6 hover:shadow-md transition-shadow ${
                t.destacar ? 'border-blue-300 ring-1 ring-blue-100' : 'border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between">
                <span className="text-2xl">{t.icon}</span>
                <span className="text-xs text-blue-600 font-medium">Ver →</span>
              </div>
              <p className="text-3xl font-bold text-slate-900 mt-3">{t.valor}</p>
              <p className="text-sm text-slate-600 mt-1">{t.label}</p>
              {t.detalle && <p className="text-xs text-slate-400 mt-1">{t.detalle}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
