import { useEffect, useMemo, useState } from 'react'
import { db } from '@lib/supabase'
import { calcularHHReales } from '@lib/calculosHH'
import { Faena, FAENA_LABELS, ParteDiario, ParteDiarioEstado, Usuario } from '@/types/index'
import { ParteDiarioForm } from './ParteDiarioForm'
import { ParteDiarioDetalle } from './ParteDiarioDetalle'
import { puedeCrear } from './permisos'
import { traducirError } from '@lib/errores'
import { MetricCard } from './MetricCard'
import { FaenaSummaryTable } from './FaenaSummaryTable'
import { ReportsHistoryTable } from './ReportsHistoryTable'
import { FilterToolbar } from './FilterToolbar'
import { IconReloj, IconMaquinaria, IconMeta, IconChecklist } from '@components/Layout/Icons'

interface ParteDiarioListProps {
  usuario: Usuario
  contrato: any
  faenaActiva: Faena
}

const POR_PAGINA = 10

export const ParteDiarioList = ({ usuario, contrato, faenaActiva }: ParteDiarioListProps) => {
  const [partes, setPartes] = useState<ParteDiario[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [parteAEditar, setParteAEditar] = useState<ParteDiario | null>(null)
  const [parteSeleccionado, setParteSeleccionado] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)

  const cargarPartes = async () => {
    if (!contrato?.id) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await db.obtenerPartesDiarios(contrato.id)
      setPartes(data as ParteDiario[])
    } catch (err) {
      setError(traducirError(err, 'No se pudieron cargar los partes diarios'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    cargarPartes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contrato?.id])

  // Cambiar de faena activa o de texto de búsqueda vuelve a la página 1 —
  // si no, se puede quedar viendo una página vacía que solo tenía sentido
  // para el filtro anterior.
  useEffect(() => {
    setPagina(1)
  }, [faenaActiva, busqueda])

  const eliminarParte = async (parte: ParteDiario) => {
    if (!window.confirm(`¿Eliminar el Daily Report N° ${String(parte.numero_reporte).padStart(3, '0')}? Esta acción no se puede deshacer.`)) {
      return
    }
    try {
      await db.eliminarParteDiario(parte.id)
      cargarPartes()
    } catch (err) {
      setError(traducirError(err, 'No se pudo eliminar el Daily Report'))
    }
  }

  const partesDeLaFaena = useMemo(() => partes.filter((p) => p.faena === faenaActiva), [partes, faenaActiva])

  const partesFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    if (!texto) return partesDeLaFaena
    return partesDeLaFaena.filter(
      (p) =>
        String(p.numero_reporte).padStart(3, '0').includes(texto) ||
        (p.usuario_creador?.nombre ?? '').toLowerCase().includes(texto)
    )
  }, [partesDeLaFaena, busqueda])

  const totalPaginas = Math.max(1, Math.ceil(partesFiltrados.length / POR_PAGINA))
  const partesPagina = useMemo(
    () => partesFiltrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA),
    [partesFiltrados, pagina]
  )

  // Los 4 KPIs se calculan sobre TODOS los reportes de la faena activa (no
  // sobre la página actual) — son un resumen de la faena, no de lo que se
  // está viendo en pantalla en este momento.
  const kpis = useMemo(() => {
    const reales = partesDeLaFaena.map((p) => calcularHHReales(p, p.faena))
    const totalDirectas = reales.reduce((acc, r) => acc + r.directas, 0)
    const totalHm = reales.reduce((acc, r) => acc + r.hm, 0)
    const totalIndirectas = reales.reduce((acc, r) => acc + r.indirectas, 0)
    const totalHH = totalDirectas + totalHm + totalIndirectas

    const equiposConHoras = new Set(
      partesDeLaFaena.flatMap((p) => p.maquinaria.filter((m) => (m.horas_por_actividad ?? []).some((h) => (h || 0) > 0)).map((m) => m.equipo))
    ).size

    const totalProgramado = partesDeLaFaena.reduce(
      (acc, p) => acc + (p.hh_directas_programado ?? 0) + (p.hh_indirectas_programado ?? 0),
      0
    )
    const totalRealDirIndir = totalDirectas + totalIndirectas
    const cumplimiento = totalProgramado > 0 ? (totalRealDirIndir / totalProgramado) * 100 : 0

    const enviados = partesDeLaFaena.filter((p) => p.estado === ParteDiarioEstado.ENVIADO).length
    const borradores = partesDeLaFaena.filter((p) => p.estado === ParteDiarioEstado.BORRADOR).length

    return { totalHH, totalDirectas, totalIndirectas, totalHm, equiposConHoras, cumplimiento, enviados, borradores }
  }, [partesDeLaFaena])

  if (!contrato?.id) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">
        No hay un contrato activo configurado.
      </div>
    )
  }

  if (mostrarFormulario || parteAEditar) {
    return (
      <ParteDiarioForm
        usuario={usuario}
        contrato={contrato}
        parteExistente={parteAEditar ?? undefined}
        onCancelar={() => {
          setMostrarFormulario(false)
          setParteAEditar(null)
        }}
        onGuardado={() => {
          setMostrarFormulario(false)
          setParteAEditar(null)
          cargarPartes()
        }}
      />
    )
  }

  if (parteSeleccionado) {
    return (
      <ParteDiarioDetalle
        usuario={usuario}
        contrato={contrato}
        parteId={parteSeleccionado}
        onVolver={() => {
          setParteSeleccionado(null)
          cargarPartes()
        }}
        onEditar={(parte) => {
          setParteSeleccionado(null)
          setParteAEditar(parte)
        }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Daily Report</h2>
          <p className="text-sm text-slate-500">
            {contrato?.codigo} · {contrato?.nombre} · {FAENA_LABELS[faenaActiva]}
          </p>
        </div>
        {puedeCrear(usuario.rol) && (
          <button
            onClick={() => setMostrarFormulario(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Nuevo Daily Report
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
      )}

      {!isLoading && partesDeLaFaena.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            icon={<IconReloj />}
            label="Total HH"
            value={String(kpis.totalHH)}
            sublabel={`${kpis.totalDirectas + kpis.totalHm} Dir · ${kpis.totalIndirectas} Indir`}
          />
          <MetricCard
            icon={<IconMaquinaria />}
            label="HM Maquinaria"
            value={String(kpis.totalHm)}
            sublabel={`${kpis.equiposConHoras} equipo${kpis.equiposConHoras === 1 ? '' : 's'} con horas registradas`}
          />
          <MetricCard
            icon={<IconMeta />}
            label="Cumplimiento Prog. vs Real"
            value={`${kpis.cumplimiento.toFixed(0)}%`}
            progreso={kpis.cumplimiento}
          />
          <MetricCard
            icon={<IconChecklist />}
            label="Reportes Emitidos"
            value={String(partesDeLaFaena.length)}
            sublabel={`${kpis.enviados} enviado${kpis.enviados === 1 ? '' : 's'} · ${kpis.borradores} borrador${kpis.borradores === 1 ? '' : 'es'}`}
          />
        </div>
      )}

      {!isLoading && partes.length > 0 && <FaenaSummaryTable partes={partes} />}

      <FilterToolbar
        query={busqueda}
        onQueryChange={setBusqueda}
        pagina={pagina}
        totalPaginas={totalPaginas}
        onPaginaChange={setPagina}
        totalFiltrado={partesFiltrados.length}
      />

      <ReportsHistoryTable
        partes={partesPagina}
        usuario={usuario}
        cargando={isLoading}
        onSeleccionar={setParteSeleccionado}
        onEditar={setParteAEditar}
        onEliminar={eliminarParte}
      />
    </div>
  )
}
