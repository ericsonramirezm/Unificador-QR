import { useCallback, useState } from 'react'
import { Aviso, Boton, Campo, claseControl } from '../components/Campo'
import { DialogoConfirmacion } from '../components/DialogoConfirmacion'
import { Modal } from '../components/Modal'
import { SelectorArticulo } from '../components/SelectorArticulo'
import { useCargar } from '../lib/useCargar'
import { useMenuContextual, type ItemMenuContextual } from '../lib/useMenuContextual'
import { buscarMovimientos, eliminarMovimiento, lineasDeMovimiento, resumenPeriodo } from '../lib/servicios/movimientos'
import { detalleDe, exportarMovimientosExcel } from '../lib/exportar/exportarMovimientosExcel'
import {
  COLOR_MOVIMIENTO,
  ETIQUETA_MOVIMIENTO,
  SIGNO_MOVIMIENTO,
  type Articulo,
  type FilaMovimiento,
  type TipoMovimiento,
} from '../tipos'
import { RolBodega } from '@/types/index'
import { Pendientes } from './movimientos/Pendientes'

const TIPOS: TipoMovimiento[] = ['ENTRADA', 'SALIDA_SALA', 'ENTREGA_EPP', 'DEVOLUCION', 'TRASLADO', 'AJUSTE']

/** Últimos 30 días: la pantalla abre con lo que se está trabajando ahora. */
function rangoPorDefecto() {
  const hasta = new Date()
  const desde = new Date()
  desde.setDate(desde.getDate() - 30)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { desde: iso(desde), hasta: iso(hasta) }
}

export function Movimientos({ rolBodega }: { rolBodega: RolBodega | null }) {
  const [vista, setVista] = useState<'linea' | 'pendientes'>('linea')

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <h1 className="mb-4 text-xl font-semibold text-slate-800">Movimientos</h1>

      <div className="no-imprimir mb-5 flex gap-2">
        {(
          [
            ['linea', 'Línea de tiempo'],
            ['pendientes', 'Pendientes por cobrar'],
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

      {vista === 'linea' ? (
        <LineaDeTiempo rolBodega={rolBodega} onVerPendientes={() => setVista('pendientes')} />
      ) : (
        <Pendientes rolBodega={rolBodega} />
      )}
    </div>
  )
}

function LineaDeTiempo({ rolBodega, onVerPendientes }: { rolBodega: RolBodega | null; onVerPendientes: () => void }) {
  const inicial = rangoPorDefecto()
  const [desde, setDesde] = useState(inicial.desde)
  const [hasta, setHasta] = useState(inicial.hasta)
  const [tipo, setTipo] = useState<TipoMovimiento | 'TODOS'>('TODOS')
  const [texto, setTexto] = useState('')
  const [articulo, setArticulo] = useState<Articulo | null>(null)
  const [mostrarAnulados, setMostrarAnulados] = useState(false)
  const [detalle, setDetalle] = useState<FilaMovimiento | null>(null)
  const [eliminando, setEliminando] = useState<FilaMovimiento | null>(null)
  const [exportando, setExportando] = useState(false)

  const cargar = useCallback(async () => {
    const filtro = { desde, hasta, tipo, texto, articuloId: articulo?.id ?? null, mostrarAnulados }
    const [filas, resumen] = await Promise.all([
      buscarMovimientos(filtro),
      resumenPeriodo({ desde, hasta, mostrarAnulados }),
    ])
    return { filas, resumen }
  }, [desde, hasta, tipo, texto, articulo, mostrarAnulados])
  const { datos, cargando, error, recargar } = useCargar(cargar)

  const filas = datos?.filas ?? []
  const resumen = datos?.resumen ?? { entradas: 0, salidas: 0, eppEntregado: 0, conDiferencia: 0 }
  const descripcionFiltro = `${desde} a ${hasta}${tipo !== 'TODOS' ? ` · ${ETIQUETA_MOVIMIENTO[tipo]}` : ''}${
    articulo ? ` · ${articulo.codigo_defontana}` : ''
  }`

  async function exportarExcel() {
    setExportando(true)
    try {
      await exportarMovimientosExcel(filas, descripcionFiltro)
    } finally {
      setExportando(false)
    }
  }

  function imprimir() {
    document.body.classList.add('imprimiendo')
    const quitar = () => {
      document.body.classList.remove('imprimiendo')
      window.removeEventListener('afterprint', quitar)
    }
    window.addEventListener('afterprint', quitar)
    window.print()
  }

  return (
    <div>
      {/* --- Tablero del período --- */}
      <div className="no-imprimir mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador titulo="Entradas" valor={resumen.entradas} detalle="recepciones en el período" />
        <Indicador titulo="Salidas a sala" valor={resumen.salidas} detalle="despachos a instalación" />
        <Indicador titulo="EPP entregado" valor={resumen.eppEntregado} detalle="entregas a trabajadores" />
        <Indicador
          titulo="Con diferencia"
          valor={resumen.conDiferencia}
          detalle="guías donde faltó material"
          alarma={resumen.conDiferencia > 0}
          onClick={onVerPendientes}
        />
      </div>

      {/* --- Filtros --- */}
      <section className="no-imprimir mb-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por guía, proveedor, sala, trabajador u observación…"
          className={`${claseControl} w-full`}
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Desde" htmlFor="desde">
            <input id="desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={`${claseControl} w-full`} />
          </Campo>
          <Campo etiqueta="Hasta" htmlFor="hasta">
            <input id="hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={`${claseControl} w-full`} />
          </Campo>
          <Campo etiqueta="Tipo" htmlFor="tipo">
            <select
              id="tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoMovimiento | 'TODOS')}
              className={`${claseControl} w-full`}
            >
              <option value="TODOS">Todos los tipos</option>
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {ETIQUETA_MOVIMIENTO[t]}
                </option>
              ))}
            </select>
          </Campo>
        </div>

        {/* El filtro por artículo va aparte: el código pertenece a las líneas, no
            a la cabecera, así que no cabe en el buscador de arriba. */}
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Artículo</span>
          {articulo ? (
            <div className="flex items-baseline gap-3 rounded-lg bg-slate-50 px-3 py-2">
              <span className="font-mono text-sm">{articulo.codigo_defontana}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{articulo.descripcion}</span>
              <button onClick={() => setArticulo(null)} className="text-xs text-slate-500 hover:underline">
                Quitar filtro
              </button>
            </div>
          ) : (
            <SelectorArticulo onElegir={setArticulo} placeholder="Filtrar por un artículo concreto…" />
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={mostrarAnulados}
            onChange={(e) => setMostrarAnulados(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Mostrar movimientos anulados
        </label>
      </section>

      {error && <Aviso tono="error">{error}</Aviso>}

      <div className="no-imprimir mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {cargando ? 'Cargando…' : `${filas.length} movimiento(s)`}
          {filas.length === 300 && ' — se muestran los primeros 300, afina el rango'}
        </p>
        <div className="flex gap-2">
          <Boton variante="secundario" onClick={imprimir} disabled={filas.length === 0}>
            Imprimir / PDF
          </Boton>
          <Boton variante="secundario" onClick={exportarExcel} disabled={exportando || filas.length === 0}>
            {exportando ? 'Generando…' : 'Exportar a Excel'}
          </Boton>
        </div>
      </div>

      {/* `area-impresion` marca lo único que sale en el papel. */}
      <div className="area-impresion">
        <h2 className="mb-2 hidden text-base font-semibold print:block">
          Movimientos de bodega — {descripcionFiltro}
        </h2>

        {!cargando && filas.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            No hay movimientos con esos filtros.
          </div>
        ) : (
          <>
            {/* Escritorio */}
            <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-800 text-left text-white">
                    <th className="px-3 py-2 font-medium">N°</th>
                    <th className="px-3 py-2 font-medium">Fecha</th>
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium">Detalle</th>
                    <th className="px-3 py-2 font-medium">Guía</th>
                    <th className="px-3 py-2 text-right font-medium">Líneas</th>
                    <th className="px-3 py-2 text-right font-medium">Unidades</th>
                    <th className="px-3 py-2 font-medium">Registró</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((m, i) => (
                    <FilaMovimientoEscritorio
                      key={m.id}
                      movimiento={m}
                      indice={i}
                      onAbrir={setDetalle}
                      onEliminar={puedeEliminar(m, rolBodega) ? () => setEliminando(m) : undefined}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Celular */}
            <ul className="space-y-2 md:hidden">
              {filas.map((m) => (
                <TarjetaMovimientoCelular
                  key={m.id}
                  movimiento={m}
                  onAbrir={setDetalle}
                  onEliminar={puedeEliminar(m, rolBodega) ? () => setEliminando(m) : undefined}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {detalle && <DetalleMovimiento movimiento={detalle} onCerrar={() => setDetalle(null)} />}

      {eliminando && (
        <EliminarMovimientoDialogo
          movimiento={eliminando}
          onCerrar={() => setEliminando(null)}
          onEliminado={() => {
            setEliminando(null)
            recargar()
          }}
        />
      )}
    </div>
  )
}

/** Espeja la verificación de `eliminar_movimiento`: solo ADMIN, y no sobre una anulación o algo ya anulado. */
function puedeEliminar(m: FilaMovimiento, rolBodega: RolBodega | null): boolean {
  return rolBodega === RolBodega.ADMIN && !m.anula_movimiento_id && !m.anulado_por_id
}

function FilaMovimientoEscritorio({
  movimiento: m,
  indice,
  onAbrir,
  onEliminar,
}: {
  movimiento: FilaMovimiento
  indice: number
  onAbrir: (m: FilaMovimiento) => void
  onEliminar?: () => void
}) {
  const items: ItemMenuContextual[] = onEliminar
    ? [{ etiqueta: 'Eliminar', tono: 'peligro', onSeleccionar: onEliminar }]
    : []
  const { manejadores, menu, debeIgnorarClic } = useMenuContextual(items)

  return (
    <>
      <tr
        onClick={() => {
          if (!debeIgnorarClic()) onAbrir(m)
        }}
        onContextMenu={manejadores.onContextMenu}
        onTouchStart={manejadores.onTouchStart}
        onTouchMove={manejadores.onTouchMove}
        onTouchEnd={manejadores.onTouchEnd}
        className={`cursor-pointer border-t border-slate-100 hover:bg-blue-50 ${indice % 2 === 1 ? 'bg-slate-50' : ''}`}
      >
        <td className="px-3 py-2 font-mono text-xs">{m.folio}</td>
        <td className="px-3 py-2 whitespace-nowrap">{m.fecha}</td>
        <td className="px-3 py-2">
          <EtiquetaTipo tipo={m.tipo} />
        </td>
        <td className="px-3 py-2">
          {detalleDe(m)}
          {m.anula_movimiento_id && <span className="block text-xs text-slate-500">anula N° {m.anula_folio}</span>}
          {m.anulado_por_id && <span className="block text-xs text-slate-500">anulado por N° {m.anulado_por_folio}</span>}
        </td>
        <td className="px-3 py-2 font-mono text-xs">
          {m.documento_folio ?? '—'}
          {m.tiene_diferencia && (
            <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 font-sans text-[11px] text-amber-800">
              diferencia
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right">{Number(m.n_lineas)}</td>
        <td className="px-3 py-2 text-right font-medium">{Number(m.total_unidades)}</td>
        <td className="px-3 py-2 text-slate-500">{m.registrado_por ?? '—'}</td>
      </tr>
      {menu}
    </>
  )
}

function TarjetaMovimientoCelular({
  movimiento: m,
  onAbrir,
  onEliminar,
}: {
  movimiento: FilaMovimiento
  onAbrir: (m: FilaMovimiento) => void
  onEliminar?: () => void
}) {
  const items: ItemMenuContextual[] = onEliminar
    ? [{ etiqueta: 'Eliminar', tono: 'peligro', onSeleccionar: onEliminar }]
    : []
  const { manejadores, menu, debeIgnorarClic } = useMenuContextual(items)

  return (
    <li>
      <button
        onClick={() => {
          if (!debeIgnorarClic()) onAbrir(m)
        }}
        onContextMenu={manejadores.onContextMenu}
        onTouchStart={manejadores.onTouchStart}
        onTouchMove={manejadores.onTouchMove}
        onTouchEnd={manejadores.onTouchEnd}
        className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm active:bg-blue-50"
      >
        <div className="flex items-center justify-between gap-2">
          <EtiquetaTipo tipo={m.tipo} />
          <span className="text-xs text-slate-500">{m.fecha}</span>
        </div>
        <p className="mt-1.5 font-medium text-slate-800">{detalleDe(m)}</p>
        <p className="text-sm text-slate-500">
          N° {m.folio}
          {m.documento_folio && ` · guía ${m.documento_folio}`} · {Number(m.n_lineas)} línea(s) ·{' '}
          {Number(m.total_unidades)} unidad(es)
          {m.tiene_diferencia && <span className="ml-1 text-amber-700">· con diferencia</span>}
          {m.anula_movimiento_id && <span className="ml-1 text-slate-500">· anula N° {m.anula_folio}</span>}
          {m.anulado_por_id && <span className="ml-1 text-slate-500">· anulado por N° {m.anulado_por_folio}</span>}
        </p>
      </button>
      {menu}
    </li>
  )
}

function EliminarMovimientoDialogo({
  movimiento,
  onCerrar,
  onEliminado,
}: {
  movimiento: FilaMovimiento
  onCerrar: () => void
  onEliminado: () => void
}) {
  return (
    <DialogoConfirmacion
      abierto
      titulo={`Eliminar el movimiento N° ${movimiento.folio}`}
      etiquetaConfirmar="Eliminar"
      mensaje={`Se elimina esta ${ETIQUETA_MOVIMIENTO[movimiento.tipo].toLowerCase()} para siempre. No queda ningún rastro de que existió, y no se puede deshacer.`}
      onCerrar={onCerrar}
      onConfirmar={async () => {
        await eliminarMovimiento(movimiento.id)
        onEliminado()
      }}
    />
  )
}

function EtiquetaTipo({ tipo }: { tipo: TipoMovimiento }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${COLOR_MOVIMIENTO[tipo]}`}>
      {SIGNO_MOVIMIENTO[tipo]} {ETIQUETA_MOVIMIENTO[tipo]}
    </span>
  )
}

function Indicador({
  titulo,
  valor,
  detalle,
  alarma,
  onClick,
}: {
  titulo: string
  valor: number
  detalle: string
  alarma?: boolean
  onClick?: () => void
}) {
  const contenido = (
    <>
      <p className="text-sm font-medium text-slate-600">{titulo}</p>
      <p className={`text-3xl font-semibold ${alarma ? 'text-amber-700' : 'text-slate-800'}`}>{valor}</p>
      <p className="mt-0.5 text-xs text-slate-500">{detalle}</p>
    </>
  )
  const clases = `rounded-xl border p-4 text-left ${
    alarma ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
  }`

  return onClick ? (
    <button type="button" onClick={onClick} className={`${clases} transition hover:border-slate-300`}>
      {contenido}
    </button>
  ) : (
    <div className={clases}>{contenido}</div>
  )
}

function DetalleMovimiento({ movimiento, onCerrar }: { movimiento: FilaMovimiento; onCerrar: () => void }) {
  const cargar = useCallback(() => lineasDeMovimiento(movimiento.id), [movimiento.id])
  const { datos, cargando, error } = useCargar(cargar)

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={`Movimiento N° ${movimiento.folio}`}
      descripcion={`${ETIQUETA_MOVIMIENTO[movimiento.tipo]} · ${movimiento.fecha}`}
      ancho="lg"
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <Dato etiqueta="Bodega" valor={movimiento.bodega} />
          {movimiento.bodega_destino && <Dato etiqueta="Bodega destino" valor={movimiento.bodega_destino} />}
          {movimiento.documento_folio && <Dato etiqueta="Guía" valor={movimiento.documento_folio} />}
          {movimiento.proveedor && <Dato etiqueta="Proveedor" valor={movimiento.proveedor} />}
          {movimiento.origen_nombre && <Dato etiqueta="Procedencia" valor={movimiento.origen_nombre} />}
          {movimiento.orden_compra && <Dato etiqueta="Orden de compra" valor={movimiento.orden_compra} />}
          {movimiento.sala && <Dato etiqueta="Sala eléctrica" valor={movimiento.sala} />}
          {movimiento.retirado_por_nombre && <Dato etiqueta="Retiró" valor={movimiento.retirado_por_nombre} />}
          {movimiento.trabajador && <Dato etiqueta="Trabajador" valor={movimiento.trabajador} />}
          {movimiento.motivo && <Dato etiqueta="Motivo" valor={movimiento.motivo} />}
          <Dato etiqueta="Registró" valor={movimiento.registrado_por ?? '—'} />
          {movimiento.anula_movimiento_id && <Dato etiqueta="Anula" valor={`Movimiento N° ${movimiento.anula_folio}`} />}
          {movimiento.anulado_por_id && (
            <Dato etiqueta="Anulado por" valor={`Movimiento N° ${movimiento.anulado_por_folio}`} />
          )}
        </dl>

        {movimiento.observacion && (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{movimiento.observacion}</p>
        )}

        {error && <Aviso tono="error">{error}</Aviso>}
        {cargando && <p className="text-sm text-slate-500">Cargando líneas…</p>}

        {datos && (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 text-left">
                  <th className="px-3 py-1.5 font-medium">Código</th>
                  <th className="px-3 py-1.5 font-medium">Descripción</th>
                  <th className="px-3 py-1.5 text-right font-medium">Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {datos.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-1.5 font-mono text-xs">{l.codigo_defontana}</td>
                    <td className="px-3 py-1.5">
                      {l.descripcion}
                      {l.series.length > 0 && (
                        <span className="block font-mono text-xs text-slate-500">series: {l.series.join(', ')}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <span className="font-medium">
                        {Number(l.cantidad)} {l.unidad}
                      </span>
                      {l.diferencia !== null && Number(l.diferencia) !== 0 && (
                        <span className="block text-xs text-amber-700">
                          guía: {Number(l.cantidad_guia)} ({Number(l.diferencia)})
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-slate-500">{etiqueta}:</dt>
      <dd className="min-w-0 font-medium">{valor}</dd>
    </div>
  )
}
