import { useEffect, useState } from 'react'
import { db } from '@lib/supabase'
import { ParteDiario, ParteDiarioEstado, UserRole, Usuario } from '@/types/index'
import { descargarBlob, generarExcelParteDiario, nombreArchivoParteDiario } from '@lib/generarExcelParteDiario'
import { puedeEditar, puedeEliminar } from './permisos'

interface ParteDiarioDetalleProps {
  usuario: Usuario
  parteId: string
  onVolver: () => void
  // Opcional porque no todos los que muestran este detalle necesariamente
  // ofrecen edición (por ahora ParteDiarioList siempre la pasa).
  onEditar?: (parte: ParteDiario) => void
}

const sumarHoras = (items: any[], campo: string) =>
  items.reduce((acc, item) => acc + (Array.isArray(item[campo]) ? item[campo].reduce((a: number, h: number) => a + (h || 0), 0) : 0), 0)

export const ParteDiarioDetalle = ({ usuario, parteId, onVolver, onEditar }: ParteDiarioDetalleProps) => {
  const [parte, setParte] = useState<ParteDiario | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [comentarioAutor, setComentarioAutor] = useState(usuario.nombre)
  const [comentario, setComentario] = useState('')
  const [isComentando, setIsComentando] = useState(false)

  const [isGenerandoExcel, setIsGenerandoExcel] = useState(false)
  const [isEliminando, setIsEliminando] = useState(false)

  const cargar = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await db.obtenerParteDiario(parteId)
      setParte(data as ParteDiario)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el Daily Report')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parteId])

  const enviarComentarioMandante = async () => {
    if (!parte || !comentario.trim()) return
    setIsComentando(true)
    setError(null)
    try {
      const actualizado = await db.comentarComoMandante(parte.id, comentario, comentarioAutor, usuario.id)
      setParte(actualizado as ParteDiario)
      setComentario('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el comentario')
    } finally {
      setIsComentando(false)
    }
  }

  const descargarExcel = async () => {
    if (!parte) return
    setIsGenerandoExcel(true)
    setError(null)
    try {
      const blob = await generarExcelParteDiario(parte)
      descargarBlob(blob, nombreArchivoParteDiario(parte))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el Excel')
    } finally {
      setIsGenerandoExcel(false)
    }
  }

  const eliminar = async () => {
    if (!parte) return
    if (!window.confirm(`¿Eliminar el Daily Report N° ${String(parte.numero_reporte).padStart(3, '0')}? Esta acción no se puede deshacer.`)) {
      return
    }
    setIsEliminando(true)
    setError(null)
    try {
      await db.eliminarParteDiario(parte.id)
      onVolver()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el Daily Report')
      setIsEliminando(false)
    }
  }

  if (isLoading) return <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-slate-500">Cargando…</div>
  if (!parte) return <div className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-red-600">{error ?? 'No encontrado'}</div>

  const totalHhDirectas = sumarHoras(parte.mano_obra_directa, 'horas_por_actividad')
  const totalHm = sumarHoras(parte.maquinaria, 'horas_por_actividad')
  const totalHhIndirectas = parte.mano_obra_indirecta.reduce((acc, f) => acc + 11 * (f.operativos || 0), 0)

  const puedeComentar =
    usuario.rol === UserRole.MANDANTE &&
    (parte.estado === ParteDiarioEstado.ENVIADO || parte.estado === ParteDiarioEstado.COMENTADO_MANDANTE)

  return (
    <div className="space-y-4">
      <button onClick={onVolver} className="text-sm font-semibold text-blue-600 hover:text-blue-700">
        ← Volver al listado
      </button>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              Daily Report N° {String(parte.numero_reporte).padStart(3, '0')}
            </h2>
            <p className="text-sm text-slate-500">{parte.fecha} · {parte.condicion_climatica ?? 'Sin condición registrada'}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">{parte.estado}</span>
            {onEditar && puedeEditar(usuario, parte) && (
              <button
                onClick={() => onEditar(parte)}
                className="px-3 py-1.5 border border-blue-200 text-blue-600 text-sm font-semibold rounded-lg hover:bg-blue-50 transition-colors"
              >
                ✎ Editar
              </button>
            )}
            {puedeEliminar(usuario) && (
              <button
                onClick={eliminar}
                disabled={isEliminando}
                className="px-3 py-1.5 border border-red-200 text-red-600 text-sm font-semibold rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isEliminando ? 'Eliminando…' : '🗑 Eliminar'}
              </button>
            )}
            <button
              onClick={descargarExcel}
              disabled={isGenerandoExcel}
              className="px-3 py-1.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
            >
              {isGenerandoExcel ? 'Generando…' : '⬇ Descargar Excel'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-xs text-slate-500 uppercase">HH Directas</p>
            <p className="text-2xl font-bold text-slate-900">{totalHhDirectas}</p>
            <p className="text-xs text-slate-400">Acum.: {parte.hh_directas_acumuladas ?? '—'}</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-xs text-slate-500 uppercase">HM Maquinaria</p>
            <p className="text-2xl font-bold text-slate-900">{totalHm}</p>
            <p className="text-xs text-slate-400">Acum.: {parte.hm_acumuladas ?? '—'}</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-xs text-slate-500 uppercase">HH Indirectas</p>
            <p className="text-2xl font-bold text-slate-900">{totalHhIndirectas}</p>
            <p className="text-xs text-slate-400">Acum.: {parte.hh_indirectas_acumuladas ?? '—'}</p>
          </div>
        </div>

        <section>
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Actividades ejecutadas</h3>
          {parte.actividades.length === 0 ? (
            <p className="text-sm text-slate-400">Sin actividades registradas.</p>
          ) : (
            <ul className="text-sm text-slate-700 space-y-1 list-disc list-inside">
              {parte.actividades.map((a, i) => (
                <li key={i}>
                  <span className="font-medium">{a.area}</span> — {a.descripcion}
                  {a.cantidad != null && <span className="text-slate-400"> ({a.cantidad})</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {parte.comentario_contratista && (
          <section>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-1">
              Comentario del contratista
            </h3>
            <p className="text-sm text-slate-700">{parte.comentario_contratista}</p>
            {parte.comentario_contratista_autor && (
              <p className="text-xs text-slate-400 mt-1">— {parte.comentario_contratista_autor}</p>
            )}
          </section>
        )}

        <section>
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">
            Comentario del mandante
          </h3>
          {parte.comentario_mandante ? (
            <div>
              <p className="text-sm text-slate-700">{parte.comentario_mandante}</p>
              <p className="text-xs text-slate-400 mt-1">
                — {parte.comentario_mandante_autor}
                {parte.comentario_mandante_fecha && ` · ${new Date(parte.comentario_mandante_fecha).toLocaleString('es-CL')}`}
              </p>
            </div>
          ) : puedeComentar ? (
            <div className="space-y-2 max-w-lg">
              <input
                type="text"
                value={comentarioAutor}
                onChange={(e) => setComentarioAutor(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
              <textarea
                placeholder="Escribe tu comentario u observación…"
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
              <button
                onClick={enviarComentarioMandante}
                disabled={isComentando || !comentario.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed"
              >
                {isComentando ? 'Guardando…' : 'Guardar comentario'}
              </button>
            </div>
          ) : (
            <p className="text-sm text-slate-400">Sin comentario todavía.</p>
          )}
        </section>

        {parte.fotos?.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Fotos</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {parte.fotos.map((foto, i) => (
                <div key={i} className="border border-slate-200 rounded-lg overflow-hidden">
                  <img src={foto.url} alt={foto.caption ?? ''} className="w-full h-24 object-cover" />
                  {foto.caption && <p className="text-xs text-slate-500 p-1.5">{foto.caption}</p>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
