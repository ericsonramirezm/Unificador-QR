import { useCallback, useState } from 'react'
import { Aviso, claseControl } from '../components/Campo'
import { Modal } from '../components/Modal'
import { FotoArticulo, MiniaturaArticulo } from '../components/FotoArticulo'
import { TablaCatalogo, type Columna } from '../components/TablaCatalogo'
import { useCargar } from '../lib/useCargar'
import {
  listarBodegas,
  listarEquivalenciasProveedor,
  listarProveedores,
  listarTiposArticulo,
  obtenerArticulo,
} from '../lib/servicios/catalogos'
import { contarStock, historialArticulo, listarStock, seriesDeArticulo } from '../lib/servicios/movimientos'
import {
  COLOR_MOVIMIENTO,
  ETIQUETA_MOVIMIENTO,
  SIGNO_MOVIMIENTO,
  type Articulo,
  type FilaStock,
  type TipoArticulo,
} from '../tipos'
import { RolBodega } from '@/types/index'

/** Reserva si la lista de tipos todavía no cargó o el dato no calzara con ninguno. */
const TIPO_RESERVA = { nombre: '', color: 'bg-slate-100 text-slate-500' }

export function Stock({ rolBodega, bodegaActualId }: { rolBodega: RolBodega | null; bodegaActualId: string }) {
  // Bodeguero y Prevencionista trabajan en una sola bodega por sesión: ven
  // solo la suya, sin "Todas las bodegas". Consulta y Administrador siguen
  // viendo el stock completo.
  const puedeVerTodas = rolBodega === RolBodega.ADMIN || rolBodega === RolBodega.CONSULTA

  const [texto, setTexto] = useState('')
  const [tipo, setTipo] = useState<TipoArticulo | 'TODOS'>('TODOS')
  // Punto de partida: la bodega elegida en la sesión. Quien puede ver todas
  // puede cambiarlo o volver a "Todas"; quien no, queda fijo aquí.
  const [bodegaId, setBodegaId] = useState(bodegaActualId)
  const [soloBajoMinimo, setSoloBajoMinimo] = useState(false)
  const [ficha, setFicha] = useState<FilaStock | null>(null)

  // Las bodegas se piden una sola vez: no dependen de los filtros y cambian
  // muy de vez en cuando.
  const cargarBodegas = useCallback(async () => (await listarBodegas()).filter((b) => b.activo), [])
  const { datos: bodegas } = useCargar(cargarBodegas)
  const hayVariasBodegas = (bodegas?.length ?? 0) > 1
  const mostrarColumnaBodega = hayVariasBodegas && puedeVerTodas

  // Igual que las bodegas: no depende de los filtros de búsqueda, se pide una
  // sola vez. Un artículo puede tener equivalencias de varios proveedores
  // distintos, así que el mapa guarda una lista, no un valor único.
  const cargarEquivalencias = useCallback(async () => {
    const [equivalencias, proveedores] = await Promise.all([listarEquivalenciasProveedor(), listarProveedores()])
    const nombrePorProveedor = new Map(proveedores.map((p) => [p.id, p.nombre]))
    const porArticulo = new Map<string, { id: string; codigo: string; descripcion: string | null; proveedor: string }[]>()
    for (const e of equivalencias) {
      const lista = porArticulo.get(e.articulo_id) ?? []
      lista.push({
        id: e.id,
        codigo: e.codigo_proveedor,
        descripcion: e.descripcion_proveedor,
        proveedor: nombrePorProveedor.get(e.proveedor_id) ?? '—',
      })
      porArticulo.set(e.articulo_id, lista)
    }
    return porArticulo
  }, [])
  const { datos: equivalenciasPorArticulo } = useCargar(cargarEquivalencias)

  const { datos: tipos } = useCargar(listarTiposArticulo)
  const tipoPorCodigo = (codigo: string) => tipos?.find((t) => t.codigo === codigo) ?? { ...TIPO_RESERVA, nombre: codigo }

  const cargar = useCallback(async () => {
    // Los conteos van con los mismos filtros de búsqueda pero SIN el de
    // criticidad: así el marcador general no cambia al activar el crítico.
    const [filas, conteo] = await Promise.all([
      listarStock({ texto, tipo, bodegaId, soloBajoMinimo }),
      contarStock({ texto, tipo, bodegaId }),
    ])
    return { filas, conteo }
  }, [texto, tipo, bodegaId, soloBajoMinimo])
  const { datos, cargando, error, recargar } = useCargar(cargar)
  const filas = datos?.filas ?? []
  const conteo = datos?.conteo ?? { total: 0, criticos: 0 }

  const columnas: Columna<FilaStock & { id: string }>[] = [
    {
      clave: 'codigo',
      titulo: 'Código Defontana',
      principal: true,
      render: (f) => (
        <div>
          <div className="font-mono font-medium">{f.codigo_defontana}</div>
          <div className="text-xs text-slate-400">Código Defontana</div>
          {(equivalenciasPorArticulo?.get(f.articulo_id) ?? []).map((e) => (
            <div key={e.id} className="mt-1">
              <div className="font-mono text-sm italic">{e.codigo}</div>
              {e.descripcion && <div className="text-sm italic text-slate-600">{e.descripcion}</div>}
              <div className="text-xs text-slate-400">Código Proveedor · {e.proveedor}</div>
            </div>
          ))}
        </div>
      ),
    },
    { clave: 'descripcion', titulo: 'Descripción', render: (f) => f.descripcion },
    {
      clave: 'tipo',
      titulo: 'Tipo',
      render: (f) => {
        const t = tipoPorCodigo(f.tipo)
        return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.color}`}>{t.nombre}</span>
      },
      soloEscritorio: true,
    },
    // Dónde está físicamente. Con una sola bodega es una columna que repite lo
    // mismo en todas las filas, así que solo aparece cuando hay más de una.
    ...(mostrarColumnaBodega
      ? [{ clave: 'bodega', titulo: 'Bodega', render: (f: FilaStock) => f.bodega }]
      : []),
    {
      clave: 'saldo',
      titulo: 'Saldo',
      className: 'text-right',
      render: (f) => (
        <span className={`font-medium ${f.bajo_minimo ? 'text-red-700' : ''}`}>
          {Number(f.cantidad)} {f.unidad}
        </span>
      ),
    },
    {
      clave: 'minimo',
      titulo: 'Mínimo',
      className: 'text-right',
      render: (f) =>
        f.bajo_minimo ? (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">
            bajo mínimo ({Number(f.stock_minimo)})
          </span>
        ) : (
          <span className="text-slate-500">{Number(f.stock_minimo)}</span>
        ),
    },
  ]

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Stock</h1>
      <p className="mb-4 text-sm text-slate-500">
        El saldo se calcula sumando el libro de movimientos. No es un número que se edite a mano.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por código, descripción o marca…"
          className={`${claseControl} min-w-0 flex-1 sm:max-w-md`}
        />
        <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoArticulo | 'TODOS')} className={claseControl}>
          <option value="TODOS">Todos los tipos</option>
          {(tipos ?? []).map((t) => (
            <option key={t.codigo} value={t.codigo}>
              {t.nombre}
            </option>
          ))}
        </select>
        {puedeVerTodas ? (
          hayVariasBodegas ? (
            <select value={bodegaId} onChange={(e) => setBodegaId(e.target.value)} className={claseControl}>
              <option value="">Todas las bodegas</option>
              {(bodegas ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nombre}
                </option>
              ))}
            </select>
          ) : (
            // Con una sola bodega activa no hay nada que elegir, pero sin este texto
            // tampoco quedaba ningún indicio en pantalla de cuál es — el selector
            // completo desaparecía y no lo reemplazaba nada.
            bodegas?.[0] && <span className="text-sm text-slate-600">{bodegas[0].nombre}</span>
          )
        ) : (
          // Bodeguero/Prevencionista: siempre su bodega, nunca "Todas las bodegas".
          <span className="text-sm text-slate-600">
            {bodegas?.find((b) => b.id === bodegaId)?.nombre ?? '—'}
          </span>
        )}
      </div>

      {/* Los dos marcadores hacen de filtro: el activo queda resaltado. */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Marcador
          titulo="Stock General"
          valor={conteo.total}
          detalle="artículos en bodega, incluidos los críticos"
          activo={!soloBajoMinimo}
          tono="general"
          onClick={() => setSoloBajoMinimo(false)}
        />
        <Marcador
          titulo="Stock Crítico"
          valor={conteo.criticos}
          detalle={conteo.criticos === 1 ? 'artículo bajo su mínimo' : 'artículos bajo su mínimo'}
          activo={soloBajoMinimo}
          tono="critico"
          onClick={() => setSoloBajoMinimo(true)}
        />
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}
      {cargando ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <TablaCatalogo
          columnas={columnas}
          filas={filas.map((f) => ({ ...f, id: `${f.articulo_id}-${f.bodega_id}` }))}
          onFila={setFicha}
          miniatura={(f) => <MiniaturaArticulo path={f.foto_miniatura_path} alt={f.descripcion} />}
          vacio={
            soloBajoMinimo
              ? 'Ningún artículo está bajo su mínimo.'
              : texto
                ? 'Ningún artículo coincide con la búsqueda.'
                : 'Todavía no hay artículos con movimiento. Registra una recepción para empezar.'
          }
        />
      )}

      {/* Al cambiar la foto se recarga la lista: si no, la miniatura de la fila
          seguiría mostrando la anterior hasta la próxima búsqueda. */}
      {ficha && (
        <FichaArticulo fila={ficha} rolBodega={rolBodega} onCerrar={() => setFicha(null)} onFotoCambiada={recargar} />
      )}
    </div>
  )
}

function Marcador({
  titulo,
  valor,
  detalle,
  activo,
  tono,
  onClick,
}: {
  titulo: string
  valor: number
  detalle: string
  activo: boolean
  tono: 'general' | 'critico'
  onClick: () => void
}) {
  const critico = tono === 'critico'
  // El marcador crítico solo se pinta de rojo si hay algo que reponer: en cero
  // sería una alarma permanente, y una alarma que siempre está encendida deja
  // de mirarse.
  const alarma = critico && valor > 0

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`rounded-xl border p-4 text-left transition ${
        activo
          ? alarma
            ? 'border-red-400 bg-red-50 ring-2 ring-red-200'
            : 'border-blue-400 bg-blue-50 ring-2 ring-blue-200'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <p className="text-sm font-medium text-slate-600">{titulo}</p>
      <p className={`text-3xl font-semibold ${alarma ? 'text-red-700' : 'text-slate-800'}`}>{valor}</p>
      <p className="mt-0.5 text-xs text-slate-500">{detalle}</p>
    </button>
  )
}

function FichaArticulo({
  fila,
  rolBodega,
  onCerrar,
  onFotoCambiada,
}: {
  fila: FilaStock
  rolBodega: RolBodega | null
  onCerrar: () => void
  onFotoCambiada: () => void
}) {
  const cargar = useCallback(async () => {
    const [historial, series, articulo] = await Promise.all([
      historialArticulo(fila.articulo_id),
      fila.controla_serie ? seriesDeArticulo(fila.articulo_id) : Promise.resolve([]),
      obtenerArticulo(fila.articulo_id),
    ])
    return { historial, series, articulo }
  }, [fila.articulo_id, fila.controla_serie])
  const { datos, cargando, error } = useCargar(cargar)

  // Tras cambiar la foto, el artículo recién devuelto manda sobre el que se
  // cargó al abrir: así la ficha muestra la foto nueva sin volver a consultar.
  const [reciente, setReciente] = useState<Articulo | null>(null)
  const articulo = reciente ?? datos?.articulo ?? null

  return (
    <Modal abierto onCerrar={onCerrar} titulo={fila.codigo_defontana} descripcion={fila.descripcion} ancho="lg">
      <div className="space-y-5">
        {articulo && (
          <FotoArticulo
            articulo={articulo}
            rolBodega={rolBodega}
            onCambiada={(a) => {
              setReciente(a)
              onFotoCambiada()
            }}
          />
        )}

        <div className="grid grid-cols-3 gap-2 text-center">
          <Dato etiqueta="Saldo" valor={`${Number(fila.cantidad)} ${fila.unidad}`} destacar={fila.bajo_minimo} />
          <Dato etiqueta="Mínimo" valor={String(Number(fila.stock_minimo))} />
          <Dato etiqueta="Bodega" valor={fila.bodega} />
        </div>

        {error && <Aviso tono="error">{error}</Aviso>}
        {cargando && <p className="text-sm text-slate-500">Cargando historial…</p>}

        {datos && fila.controla_serie && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Dónde está cada unidad</h3>
            {datos.series.length === 0 ? (
              <p className="text-sm text-slate-500">Todavía no hay series registradas.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {datos.series.map((s) => (
                  <li key={s.id} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                    <span className="font-mono text-xs">{s.numero_serie}</span>
                    <span className="text-slate-600">{s.ubicacion_actual ?? '—'}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{s.estado}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {datos && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Historial</h3>
            {datos.historial.length === 0 ? (
              <p className="text-sm text-slate-500">Este artículo todavía no tiene movimientos.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {datos.historial.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className="w-24 shrink-0 text-xs text-slate-500">{l.fecha}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${COLOR_MOVIMIENTO[l.movimiento_tipo]}`}
                    >
                      {ETIQUETA_MOVIMIENTO[l.movimiento_tipo]}
                    </span>
                    <span className="font-medium">
                      {SIGNO_MOVIMIENTO[l.movimiento_tipo]}
                      {Math.abs(Number(l.cantidad))} {l.unidad}
                    </span>
                    {l.diferencia !== null && Number(l.diferencia) !== 0 && (
                      <span className="text-xs text-amber-700">
                        guía decía {Number(l.cantidad_guia)} (diferencia {Number(l.diferencia)})
                      </span>
                    )}
                    {l.series.length > 0 && (
                      <span className="text-xs text-slate-500">series: {l.series.join(', ')}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Modal>
  )
}

function Dato({ etiqueta, valor, destacar }: { etiqueta: string; valor: string; destacar?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${destacar ? 'bg-red-50 text-red-800' : 'bg-slate-50'}`}>
      <p className="text-lg font-semibold">{valor}</p>
      <p className="text-xs text-slate-500">{etiqueta}</p>
    </div>
  )
}
