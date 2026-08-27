import { useEffect, useState } from 'react'
import { db, type FiltrosDocumentos } from '@lib/supabase'
import { traducirError } from '@lib/errores'
import { DocumentStatus, ParteDiarioEstado, UserRole, Usuario } from '@/types/index'

interface Conteos {
  docsPendientes: number
  docsTotal: number
  partesBorrador: number
  partesEnviados: number
  partesComentados: number
  partesTotal: number
}

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
  const [conteos, setConteos] = useState<Conteos>({
    docsPendientes: 0,
    docsTotal: 0,
    partesBorrador: 0,
    partesEnviados: 0,
    partesComentados: 0,
    partesTotal: 0,
  })
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
      // Solo se piden números (count exacto, sin traer filas). Son seis
      // consultas diminutas en paralelo en vez de dos descargas completas.
      const base: FiltrosDocumentos = {
        contrato_id: contrato.id,
        ...(usuario.rol === UserRole.COORDINADOR ? {} : { creado_por: usuario.id }),
      }
      const cero = Promise.resolve(0)

      const [docsPendientes, docsTotal, partesBorrador, partesEnviados, partesComentados, partesTotal] =
        await Promise.all([
          veDocumentos ? db.contarDocumentos({ ...base, estado: DocumentStatus.PENDIENTE }) : cero,
          veDocumentos ? db.contarDocumentos(base) : cero,
          veDailyReport ? db.contarPartesDiarios(contrato.id, ParteDiarioEstado.BORRADOR) : cero,
          veDailyReport ? db.contarPartesDiarios(contrato.id, ParteDiarioEstado.ENVIADO) : cero,
          veDailyReport ? db.contarPartesDiarios(contrato.id, ParteDiarioEstado.COMENTADO_MANDANTE) : cero,
          veDailyReport ? db.contarPartesDiarios(contrato.id) : cero,
        ])

      setConteos({ docsPendientes, docsTotal, partesBorrador, partesEnviados, partesComentados, partesTotal })
    } catch (err) {
      setError(traducirError(err, 'No se pudo cargar el resumen'))
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">Cargando…</div>
  }

  const { docsPendientes, docsTotal, partesBorrador, partesEnviados, partesComentados, partesTotal } = conteos

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
