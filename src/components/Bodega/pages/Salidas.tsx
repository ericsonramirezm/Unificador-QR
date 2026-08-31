import { useCallback, useMemo, useState } from 'react'
import { Aviso, Boton, Campo, claseInput } from '../components/Campo'
import {
  CapturaLineaMovimiento,
  TablaLineas,
  type LineaCapturada,
} from '../components/CapturaLineaMovimiento'
import { ValeSalida, type DatosVale } from '../components/ValeSalida'
import { useCargar } from '../lib/useCargar'
import { listarBodegas, listarSalas, listarTrabajadores } from '../lib/servicios/catalogos'
import { registrarMovimiento, seriesDisponibles, seriesEntregadas } from '../lib/servicios/movimientos'
import type { LineaMovimiento, TipoMovimiento } from '../tipos'

type Modo = 'SALIDA_SALA' | 'DEVOLUCION' | 'TRASLADO'

const MODOS: { valor: Modo; etiqueta: string; descripcion: string }[] = [
  {
    valor: 'SALIDA_SALA',
    etiqueta: 'Salida a sala',
    descripcion: 'Material que se instala en una sala eléctrica. Descuenta stock.',
  },
  {
    valor: 'DEVOLUCION',
    etiqueta: 'Devolución',
    descripcion: 'Lo que no se instaló y vuelve a bodega. Suma stock.',
  },
  {
    valor: 'TRASLADO',
    etiqueta: 'Traslado',
    descripcion: 'Cambia de bodega. Ni consume ni compra: solo se mueve de lugar.',
  },
]

const hoy = () => new Date().toISOString().slice(0, 10)

export function Salidas({ bodegaActualId }: { bodegaActualId: string }) {
  const cargarCatalogos = useCallback(async () => {
    const [bodegas, salas, trabajadores] = await Promise.all([listarBodegas(), listarSalas(), listarTrabajadores()])
    return {
      bodegas: bodegas.filter((b) => b.activo),
      salas: salas.filter((s) => s.activo),
      trabajadores: trabajadores.filter((t) => t.activo),
    }
  }, [])
  const { datos, cargando, error: errorCarga } = useCargar(cargarCatalogos)

  const [modo, setModo] = useState<Modo>('SALIDA_SALA')
  const [fecha, setFecha] = useState(hoy())
  const [salaId, setSalaId] = useState('')
  const [retiradoPorId, setRetiradoPorId] = useState('')
  const [bodegaDestinoId, setBodegaDestinoId] = useState('')
  const [observacion, setObservacion] = useState('')
  const [lineas, setLineas] = useState<LineaCapturada[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [vale, setVale] = useState<DatosVale | null>(null)

  const bodegas = datos?.bodegas ?? []
  // Ya no se elige aquí: es la bodega de la sesión, fijada al entrar y
  // cambiable solo desde el botón "Bodega" del header de `Bodega.tsx`.
  const bodegaId = bodegaActualId
  const bodegaActual = bodegas.find((b) => b.id === bodegaId)
  const salas = datos?.salas ?? []
  const trabajadores = datos?.trabajadores ?? []
  const hayVariasBodegas = bodegas.length > 1

  /**
   * De dónde salen las series que se pueden elegir. En una devolución son las que
   * están en terreno; en el resto, las que están en la bodega.
   */
  const cargarSeries = useCallback(
    (articuloId: string) =>
      modo === 'DEVOLUCION'
        ? seriesEntregadas(articuloId, { salaId: salaId || null })
        : seriesDisponibles(articuloId, bodegaId),
    [modo, salaId, bodegaId],
  )

  const modosVisibles = useMemo(() => MODOS.filter((m) => m.valor !== 'TRASLADO' || hayVariasBodegas), [hayVariasBodegas])
  const modoActual = MODOS.find((m) => m.valor === modo)!

  function limpiar() {
    setLineas([])
    setObservacion('')
  }

  async function guardar() {
    setError(null)
    if (lineas.length === 0) return setError('No hay ninguna línea que registrar.')
    if (modo === 'SALIDA_SALA' && !salaId) return setError('Elige la sala eléctrica de destino.')
    if (modo === 'SALIDA_SALA' && !retiradoPorId) return setError('Indica quién retira el material.')
    if (modo === 'DEVOLUCION' && !salaId) return setError('Indica desde qué sala vuelve el material.')
    if (modo === 'TRASLADO' && !bodegaDestinoId) return setError('Elige la bodega de destino.')

    setGuardando(true)
    try {
      const r = await registrarMovimiento({
        tipo: modo as TipoMovimiento,
        bodega_id: bodegaId,
        fecha,
        sala_id: modo === 'TRASLADO' ? null : salaId || null,
        retirado_por_id: modo === 'SALIDA_SALA' ? retiradoPorId : null,
        bodega_destino_id: modo === 'TRASLADO' ? bodegaDestinoId : null,
        observacion: observacion.trim() || null,
        lineas: lineas.map<LineaMovimiento>((l) => ({
          articulo_id: l.articulo.id,
          cantidad: l.cantidad,
          series: l.articulo.controla_serie ? l.series : undefined,
        })),
      })

      if (modo === 'SALIDA_SALA') {
        setVale({
          folio: r.folio,
          fecha,
          // Del `bodegaId` que de verdad se descontó, no de la primera de la
          // lista: un vale que nombra otra bodega es un papel que miente.
          bodega: bodegaActual?.nombre ?? '',
          sala: salas.find((s) => s.id === salaId)?.nombre ?? '',
          retiradoPor: trabajadores.find((t) => t.id === retiradoPorId)?.nombre ?? '',
          observacion: observacion.trim() || null,
          lineas,
        })
      } else {
        setVale(null)
        setExito(`${modoActual.etiqueta} registrada como movimiento N° ${r.folio}.`)
      }
      limpiar()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <p className="p-6 text-sm text-slate-500">Cargando…</p>
  if (errorCarga)
    return (
      <div className="p-6">
        <Aviso tono="error">{errorCarga}</Aviso>
      </div>
    )
  if (bodegas.length === 0)
    return (
      <div className="mx-auto max-w-lg p-6">
        <Aviso tono="info">
          Todavía no existe ninguna bodega. Un Administrador debe crearla en Catálogos → Bodegas.
        </Aviso>
      </div>
    )

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <h1 className="mb-4 text-xl font-semibold text-slate-800">Salidas y devoluciones</h1>

      {vale && <div className="mb-4"><ValeSalida datos={vale} onCerrar={() => setVale(null)} /></div>}

      <div className="no-imprimir">
        {/* Selector de tipo de movimiento */}
        <div className="mb-4 flex flex-wrap gap-2">
          {modosVisibles.map((m) => (
            <button
              key={m.valor}
              onClick={() => {
                setModo(m.valor)
                setLineas([])
                setError(null)
              }}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                modo === m.valor ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-300 bg-white text-slate-600'
              }`}
            >
              {m.etiqueta}
            </button>
          ))}
        </div>
        <p className="mb-4 text-sm text-slate-500">{modoActual.descripcion}</p>

        <section className="mb-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Fecha" htmlFor="fecha" requerido>
              <input id="fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={claseInput} />
            </Campo>

            <Campo etiqueta={modo === 'DEVOLUCION' ? 'Bodega que recibe' : 'Bodega desde la que sale'}>
              <p className="py-2.5 text-sm text-slate-700">{bodegaActual?.nombre ?? '—'}</p>
            </Campo>

            {modo !== 'TRASLADO' && (
              <Campo
                etiqueta={modo === 'SALIDA_SALA' ? 'Sala eléctrica de destino' : 'Sala desde la que vuelve'}
                htmlFor="sala"
                requerido
              >
                <select id="sala" value={salaId} onChange={(e) => setSalaId(e.target.value)} className={claseInput}>
                  <option value="">Elige una sala…</option>
                  {salas.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
            )}

            {modo === 'SALIDA_SALA' && (
              <Campo etiqueta="Quién retira" htmlFor="retira" requerido>
                <select id="retira" value={retiradoPorId} onChange={(e) => setRetiradoPorId(e.target.value)} className={claseInput}>
                  <option value="">Elige de la nómina…</option>
                  {trabajadores.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                      {t.cargo ? ` — ${t.cargo}` : ''}
                    </option>
                  ))}
                </select>
              </Campo>
            )}

            {modo === 'TRASLADO' && (
              <Campo etiqueta="Bodega de destino" htmlFor="destino" requerido>
                <select
                  id="destino"
                  value={bodegaDestinoId}
                  onChange={(e) => setBodegaDestinoId(e.target.value)}
                  className={claseInput}
                >
                  <option value="">Elige una bodega…</option>
                  {bodegas
                    .filter((b) => b.id !== bodegaId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nombre}
                      </option>
                    ))}
                </select>
              </Campo>
            )}
          </div>
        </section>

        <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Materiales {lineas.length > 0 && <span className="font-normal text-slate-500">· {lineas.length} línea(s)</span>}
          </h2>
          <CapturaLineaMovimiento
            cargarSeries={cargarSeries}
            onAgregar={(l) => setLineas((ls) => [...ls, l])}
          />
        </section>

        {lineas.length > 0 && (
          <div className="mb-4">
            <TablaLineas lineas={lineas} onQuitar={(c) => setLineas((ls) => ls.filter((l) => l.clave !== c))} />
          </div>
        )}

        <Campo etiqueta="Observación" htmlFor="obs">
          <textarea id="obs" rows={2} value={observacion} onChange={(e) => setObservacion(e.target.value)} className={claseInput} />
        </Campo>

        {error && <div className="mt-3"><Aviso tono="error">{error}</Aviso></div>}
        {exito && <div className="mt-3"><Aviso tono="exito">{exito}</Aviso></div>}

        <div className="mt-4 flex justify-end">
          <Boton onClick={guardar} disabled={guardando || lineas.length === 0}>
            {guardando ? 'Registrando…' : `Registrar ${modoActual.etiqueta.toLowerCase()}`}
          </Boton>
        </div>
      </div>
    </div>
  )
}
