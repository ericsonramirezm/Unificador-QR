import { useCallback, useState } from 'react'
import { Aviso, Boton, Campo, claseInput } from '../components/Campo'
import {
  CapturaLineaMovimiento,
  TablaLineas,
  type LineaCapturada,
} from '../components/CapturaLineaMovimiento'
import { useCargar } from '../lib/useCargar'
import { listarBodegas, listarTrabajadores } from '../lib/servicios/catalogos'
import { eppDeTrabajador, registrarMovimiento, seriesDisponibles } from '../lib/servicios/movimientos'
import type { LineaMovimiento } from '../tipos'

const hoy = () => new Date().toISOString().slice(0, 10)

export function Epp({ bodegaActualId }: { bodegaActualId: string }) {
  const [vista, setVista] = useState<'entregar' | 'ficha'>('entregar')

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Elementos de protección personal</h1>
      <p className="mb-4 text-sm text-slate-500">
        Registro de qué EPP recibió cada trabajador y cuándo.
      </p>

      <div className="mb-5 flex gap-2">
        {(
          [
            ['entregar', 'Entregar EPP'],
            ['ficha', 'Ficha por trabajador'],
          ] as const
        ).map(([v, etiqueta]) => (
          <button
            key={v}
            onClick={() => setVista(v)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
              vista === v ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-300 bg-white text-slate-600'
            }`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {vista === 'entregar' ? <EntregarEpp bodegaActualId={bodegaActualId} /> : <FichaTrabajador />}
    </div>
  )
}

function EntregarEpp({ bodegaActualId }: { bodegaActualId: string }) {
  const cargarCatalogos = useCallback(async () => {
    const [bodegas, trabajadores] = await Promise.all([listarBodegas(), listarTrabajadores()])
    return { bodegas: bodegas.filter((b) => b.activo), trabajadores: trabajadores.filter((t) => t.activo) }
  }, [])
  const { datos, cargando, error: errorCarga } = useCargar(cargarCatalogos)

  const [fecha, setFecha] = useState(hoy())
  const [trabajadorId, setTrabajadorId] = useState('')
  const [observacion, setObservacion] = useState('')
  const [lineas, setLineas] = useState<LineaCapturada[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)

  const bodegas = datos?.bodegas ?? []
  // Ya no se elige aquí: es la bodega de la sesión, fijada al entrar.
  const bodegaId = bodegaActualId
  const trabajadores = datos?.trabajadores ?? []

  const cargarSeries = useCallback((articuloId: string) => seriesDisponibles(articuloId, bodegaId), [bodegaId])

  async function guardar() {
    setError(null)
    setExito(null)
    if (!trabajadorId) return setError('Elige a quién se le entrega el EPP.')
    if (lineas.length === 0) return setError('No hay ninguna línea que entregar.')

    setGuardando(true)
    try {
      const r = await registrarMovimiento({
        tipo: 'ENTREGA_EPP',
        bodega_id: bodegaId,
        fecha,
        trabajador_id: trabajadorId,
        observacion: observacion.trim() || null,
        lineas: lineas.map<LineaMovimiento>((l) => ({
          articulo_id: l.articulo.id,
          cantidad: l.cantidad,
          series: l.articulo.controla_serie ? l.series : undefined,
        })),
      })
      const nombre = trabajadores.find((t) => t.id === trabajadorId)?.nombre ?? ''
      setExito(`Entrega registrada a ${nombre} como movimiento N° ${r.folio}.`)
      setLineas([])
      setObservacion('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <p className="text-sm text-slate-500">Cargando…</p>
  if (errorCarga) return <Aviso tono="error">{errorCarga}</Aviso>
  if (!bodegaId)
    return (
      <Aviso tono="info">
        Todavía no existe ninguna bodega. Un Administrador debe crearla en Catálogos → Bodegas.
      </Aviso>
    )
  if (trabajadores.length === 0)
    return (
      <Aviso tono="info">
        No hay trabajadores en la nómina. Un Administrador debe cargarlos en Catálogos → Trabajadores.
      </Aviso>
    )

  return (
    <div className="space-y-4">
      <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
        <Campo etiqueta="Fecha" htmlFor="fecha" requerido>
          <input id="fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={claseInput} />
        </Campo>
        <Campo etiqueta="Bodega desde la que sale">
          <p className="py-2.5 text-sm text-slate-700">{bodegas.find((b) => b.id === bodegaId)?.nombre ?? '—'}</p>
        </Campo>
        <Campo etiqueta="Trabajador" htmlFor="trabajador" requerido>
          <select id="trabajador" value={trabajadorId} onChange={(e) => setTrabajadorId(e.target.value)} className={claseInput}>
            <option value="">Elige de la nómina…</option>
            {trabajadores.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre} — {t.rut}
              </option>
            ))}
          </select>
        </Campo>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          EPP a entregar {lineas.length > 0 && <span className="font-normal text-slate-500">· {lineas.length} línea(s)</span>}
        </h2>
        {/* Filtrado a EPP: en esta pantalla no tiene sentido ofrecer cable ni conduit. */}
        <CapturaLineaMovimiento
          cargarSeries={cargarSeries}
          onAgregar={(l) => setLineas((ls) => [...ls, l])}
          tipoArticulo="EPP"
        />
      </section>

      <TablaLineas lineas={lineas} onQuitar={(c) => setLineas((ls) => ls.filter((l) => l.clave !== c))} />

      <Campo etiqueta="Observación" htmlFor="obs">
        <textarea id="obs" rows={2} value={observacion} onChange={(e) => setObservacion(e.target.value)} className={claseInput} />
      </Campo>

      {error && <Aviso tono="error">{error}</Aviso>}
      {exito && <Aviso tono="exito">{exito}</Aviso>}

      <div className="flex justify-end">
        <Boton onClick={guardar} disabled={guardando || lineas.length === 0}>
          {guardando ? 'Registrando…' : 'Registrar entrega'}
        </Boton>
      </div>
    </div>
  )
}

function FichaTrabajador() {
  const [trabajadorId, setTrabajadorId] = useState('')

  const cargarTrabajadores = useCallback(async () => (await listarTrabajadores()).filter((t) => t.activo), [])
  const { datos: trabajadores } = useCargar(cargarTrabajadores)

  const cargarFicha = useCallback(
    () => (trabajadorId ? eppDeTrabajador(trabajadorId) : Promise.resolve([])),
    [trabajadorId],
  )
  const { datos: ficha, cargando, error } = useCargar(cargarFicha)

  return (
    <div className="space-y-4">
      <Campo etiqueta="Trabajador" htmlFor="ficha-trabajador">
        <select
          id="ficha-trabajador"
          value={trabajadorId}
          onChange={(e) => setTrabajadorId(e.target.value)}
          className={claseInput}
        >
          <option value="">Elige de la nómina…</option>
          {(trabajadores ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre} — {t.rut}
            </option>
          ))}
        </select>
      </Campo>

      {error && <Aviso tono="error">{error}</Aviso>}
      {trabajadorId && cargando && <p className="text-sm text-slate-500">Cargando…</p>}

      {trabajadorId && !cargando && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {(ficha ?? []).length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">
              A esta persona todavía no se le ha entregado ningún EPP.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800 text-left text-white">
                  <th className="px-3 py-2 font-medium">Código</th>
                  <th className="px-3 py-2 font-medium">Descripción</th>
                  <th className="px-3 py-2 text-right font-medium">Tiene</th>
                  <th className="px-3 py-2 text-right font-medium">Entregado</th>
                  <th className="px-3 py-2 font-medium">Última entrega</th>
                </tr>
              </thead>
              <tbody>
                {(ficha ?? []).map((f: Record<string, unknown>, i: number) => (
                  <tr key={String(f.articulo_id)} className={`border-t border-slate-100 ${i % 2 === 1 ? 'bg-slate-50' : ''}`}>
                    <td className="px-3 py-2 font-mono text-xs">{String(f.codigo_defontana)}</td>
                    <td className="px-3 py-2">{String(f.descripcion)}</td>
                    <td className="px-3 py-2 text-right font-medium">
                      {Number(f.cantidad_vigente)} {String(f.unidad)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">{Number(f.total_entregado)}</td>
                    <td className="px-3 py-2 text-slate-500">{String(f.ultima_fecha)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
