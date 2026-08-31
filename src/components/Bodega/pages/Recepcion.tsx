import { useCallback, useRef, useState } from 'react'
import { Aviso, Boton, Campo, claseControl, claseInput } from '../components/Campo'
import { Modal } from '../components/Modal'
import { partirCodigoDescripcion, SelectorArticulo } from '../components/SelectorArticulo'
import { FormularioArticulo } from '../components/FormularioArticulo'
import { useCargar } from '../lib/useCargar'
import {
  buscarEquivalenciaProveedor,
  crearProveedor,
  listarBodegas,
  listarProveedores,
  obtenerArticulo,
  registrarEquivalenciaProveedor,
} from '../lib/servicios/catalogos'
import { agregarLineasRecepcion, registrarRecepcion } from '../lib/servicios/movimientos'
import type { Articulo, LineaMovimiento, OrigenDocumento, Proveedor } from '../tipos'
import type { RolBodega } from '@/types/index'

interface LineaBorrador {
  clave: string
  articulo: Articulo
  cantidadGuia: number
  /** Lo que realmente llegó. Puede diferir de lo que declara el papel. */
  cantidad: number
  series: string[]
}

const hoy = () => new Date().toISOString().slice(0, 10)

export function Recepcion({ rolBodega, bodegaActualId }: { rolBodega: RolBodega | null; bodegaActualId: string }) {
  const cargarCatalogos = useCallback(async () => {
    const [bodegas, proveedores] = await Promise.all([listarBodegas(), listarProveedores()])
    return { bodegas: bodegas.filter((b) => b.activo), proveedores: proveedores.filter((p) => p.activo) }
  }, [])
  const { datos, cargando, error: errorCarga } = useCargar(cargarCatalogos)

  // Cabecera de la guía
  const [folio, setFolio] = useState('')
  const [fecha, setFecha] = useState(hoy())
  const [origen, setOrigen] = useState<OrigenDocumento>('TRASLADO_INTERNO')
  const [origenBodegaId, setOrigenBodegaId] = useState('')
  const [proveedorId, setProveedorId] = useState('')
  const [ordenCompra, setOrdenCompra] = useState('')
  const [observacion, setObservacion] = useState('')
  // Creado en esta sesión pero no en el catálogo que ya se cargó: se agrega a
  // mano a la lista en vez de recargar del servidor, igual que Materiales usa
  // directo el artículo recién creado sin volver a pedir el catálogo entero.
  const [proveedorNuevo, setProveedorNuevo] = useState<Proveedor | null>(null)
  const [creandoProveedor, setCreandoProveedor] = useState(false)

  const [lineas, setLineas] = useState<LineaBorrador[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  /** Guías ya registradas sin salir de la pantalla, para el camión que trae varias. */
  const [recibidas, setRecibidas] = useState<
    { movimientoId: string; folio: string; lineas: number; movimiento: number; proveedorId: string }[]
  >([])
  /** La guía (de `recibidas`) a la que se le está agregando más líneas ahora mismo. */
  const [agregandoA, setAgregandoA] = useState<(typeof recibidas)[number] | null>(null)

  const bodegas = datos?.bodegas ?? []
  // Ya no se elige aquí: es la bodega de la sesión, fijada al entrar y
  // cambiable solo desde el botón "Bodega" del header de `Bodega.tsx`.
  const bodegaId = bodegaActualId
  const listaProveedores = proveedorNuevo ? [...(datos?.proveedores ?? []), proveedorNuevo] : (datos?.proveedores ?? [])

  function agregar(linea: LineaBorrador) {
    setLineas((l) => [...l, linea])
    setExito(null)
  }

  function quitar(clave: string) {
    setLineas((l) => l.filter((x) => x.clave !== clave))
  }

  async function guardar() {
    setError(null)
    if (!folio.trim()) return setError('Falta el folio de la guía de despacho.')
    if (lineas.length === 0) return setError('La recepción no tiene ninguna línea.')
    if (origen === 'TRASLADO_INTERNO' && !origenBodegaId) return setError('Falta elegir de qué bodega viene el traslado.')

    setGuardando(true)
    try {
      const payload = {
        documento: {
          folio: folio.trim(),
          fecha,
          origen,
          origen_bodega_id: origen === 'TRASLADO_INTERNO' ? origenBodegaId : null,
          proveedor_id: origen === 'COMPRA_EXTERNA' ? proveedorId || null : null,
          orden_compra: ordenCompra.trim() || null,
        },
        bodega_id: bodegaId,
        observacion: observacion.trim() || null,
        lineas: lineas.map<LineaMovimiento>((l) => ({
          articulo_id: l.articulo.id,
          cantidad: l.cantidad,
          cantidad_guia: l.cantidadGuia,
          series: l.articulo.controla_serie ? l.series : undefined,
        })),
      }
      const r = await registrarRecepcion(payload)
      // Se limpia SOLO lo propio de esta guía: el origen y la fecha se conservan
      // porque el camión que trae cinco guías las trae todas del mismo sitio y el
      // mismo día. Así se encadena una tras otra sin volver a configurar nada.
      const nombreBodega = bodegas.find((b) => b.id === bodegaId)?.nombre ?? ''
      setRecibidas((rs) => [
        ...rs,
        {
          movimientoId: r.movimiento_id,
          folio: folio.trim(),
          lineas: lineas.length,
          movimiento: r.folio,
          proveedorId: origen === 'COMPRA_EXTERNA' ? proveedorId : '',
        },
      ])
      setExito(
        `Guía ${folio.trim()} registrada como movimiento N° ${r.folio}${
          nombreBodega ? ` en ${nombreBodega}` : ''
        }. Puedes seguir con la siguiente.`,
      )
      setLineas([])
      setFolio('')
      setOrdenCompra('')
      setObservacion('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <p className="p-6 text-sm text-slate-500">Cargando…</p>
  if (errorCarga) return <div className="p-6"><Aviso tono="error">{errorCarga}</Aviso></div>

  if (bodegas.length === 0) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Aviso tono="info">
          Todavía no existe ninguna bodega, así que no se puede registrar una recepción. Un Administrador debe
          crearla en Catálogos → Bodegas.
        </Aviso>
      </div>
    )
  }

  const totalUnidades = lineas.reduce((s, l) => s + l.cantidad, 0)
  const conDiferencia = lineas.filter((l) => l.cantidad !== l.cantidadGuia)

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <h1 className="mb-4 text-xl font-semibold text-slate-800">Recepción de material</h1>

      {recibidas.length > 0 && (
        <section className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">
            Recibidas en esta sesión: {recibidas.length} guía(s)
          </p>
          <ul className="mt-1 space-y-0.5 text-sm text-emerald-800">
            {recibidas.map((g) => (
              <li key={g.movimiento} className="flex flex-wrap items-center justify-between gap-x-2">
                <span>
                  Guía <span className="font-mono">{g.folio}</span> · {g.lineas} línea(s) · movimiento N° {g.movimiento}
                </span>
                <button
                  type="button"
                  onClick={() => setAgregandoA(g)}
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  + Agregar más líneas
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- Cabecera de la guía --- */}
      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Guía de despacho</h2>

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Origen</span>
          <div className="flex flex-wrap gap-2">
            {(['TRASLADO_INTERNO', 'COMPRA_EXTERNA'] as OrigenDocumento[]).map((o) => (
              <label
                key={o}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  origen === o ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-300'
                }`}
              >
                <input type="radio" name="origen" checked={origen === o} onChange={() => setOrigen(o)} className="h-4 w-4" />
                {o === 'TRASLADO_INTERNO' ? 'Traslado interno WILUG' : 'Compra a proveedor'}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {origen === 'TRASLADO_INTERNO' ? (
            <Campo
              etiqueta="Viene desde"
              htmlFor="origen-bodega"
              requerido
              ayuda="La bodega que despacha: se descuenta de ahí y se acredita en la que recibe."
            >
              <select
                id="origen-bodega"
                value={origenBodegaId}
                onChange={(e) => setOrigenBodegaId(e.target.value)}
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
          ) : (
            <Campo etiqueta="Proveedor" htmlFor="proveedor" requerido>
              <select id="proveedor" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className={claseInput}>
                <option value="">Elige un proveedor…</option>
                {listaProveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setCreandoProveedor(true)}
                className="mt-1 text-xs font-medium text-blue-600 hover:underline"
              >
                + Nuevo proveedor
              </button>
            </Campo>
          )}

          <Campo etiqueta="Bodega que recibe" ayuda="Es la bodega elegida en la sesión. Se cambia desde el botón «Bodega» arriba.">
            <p className="py-2.5 text-sm text-slate-700">{bodegas.find((b) => b.id === bodegaId)?.nombre ?? '—'}</p>
          </Campo>

          <Campo etiqueta="Folio de la guía" htmlFor="folio" requerido>
            <input
              id="folio"
              autoFocus
              inputMode="numeric"
              pattern="[0-9]*"
              value={folio}
              onChange={(e) => setFolio(e.target.value)}
              placeholder="26423"
              className={`${claseInput} font-mono`}
            />
          </Campo>

          <Campo etiqueta="Fecha" htmlFor="fecha" requerido>
            <input id="fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={claseInput} />
          </Campo>

          <Campo etiqueta="Orden de compra" htmlFor="oc" ayuda="Opcional.">
            <input id="oc" value={ordenCompra} onChange={(e) => setOrdenCompra(e.target.value)} className={claseInput} />
          </Campo>
        </div>
      </section>

      {/* --- Captura de líneas --- */}
      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Materiales {lineas.length > 0 && <span className="font-normal text-slate-500">· {lineas.length} línea(s)</span>}
        </h2>
        <CapturaLinea
          onAgregar={agregar}
          yaAgregados={lineas.map((l) => l.articulo.id)}
          proveedorId={origen === 'COMPRA_EXTERNA' ? proveedorId : ''}
          rolBodega={rolBodega}
        />
      </section>

      {/* --- Líneas capturadas --- */}
      {lineas.length > 0 && (
        <section className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-left text-white">
                <th className="px-3 py-2 font-medium">Código</th>
                <th className="px-3 py-2 font-medium">Descripción</th>
                <th className="px-3 py-2 text-right font-medium">Guía</th>
                <th className="px-3 py-2 text-right font-medium">Recibido</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => {
                const dif = l.cantidad !== l.cantidadGuia
                return (
                  <tr key={l.clave} className={`border-t border-slate-100 ${i % 2 === 1 ? 'bg-slate-50' : ''}`}>
                    <td className="px-3 py-2 font-mono text-xs">{l.articulo.codigo_defontana}</td>
                    <td className="px-3 py-2">
                      {l.articulo.descripcion}
                      {l.series.length > 0 && (
                        <span className="ml-2 text-xs text-slate-500">series: {l.series.join(', ')}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">{l.cantidadGuia}</td>
                    <td className={`px-3 py-2 text-right font-medium ${dif ? 'text-amber-700' : ''}`}>
                      {l.cantidad} {l.articulo.unidad}
                      {dif && <span className="block text-xs font-normal">diferencia {l.cantidad - l.cantidadGuia}</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => quitar(l.clave)}
                        className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                        aria-label={`Quitar ${l.articulo.codigo_defontana}`}
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-600">
              {lineas.length} línea(s) · {totalUnidades} unidad(es)
            </span>
            {conDiferencia.length > 0 && (
              <span className="text-amber-700">
                {conDiferencia.length} línea(s) con diferencia respecto de la guía
              </span>
            )}
          </div>
        </section>
      )}

      <Campo etiqueta="Observación de la recepción" htmlFor="obs">
        <textarea
          id="obs"
          rows={2}
          value={observacion}
          onChange={(e) => setObservacion(e.target.value)}
          className={claseInput}
        />
      </Campo>

      {error && <div className="mt-3"><Aviso tono="error">{error}</Aviso></div>}
      {exito && <div className="mt-3"><Aviso tono="exito">{exito}</Aviso></div>}

      <div className="mt-4 flex justify-end">
        <Boton onClick={guardar} disabled={guardando || lineas.length === 0}>
          {guardando ? 'Registrando…' : `Registrar recepción de ${lineas.length} línea(s)`}
        </Boton>
      </div>

      {creandoProveedor && (
        <CrearProveedorRapido
          onCerrar={() => setCreandoProveedor(false)}
          onGuardado={(p) => {
            setProveedorNuevo(p)
            setProveedorId(p.id)
            setCreandoProveedor(false)
          }}
        />
      )}

      {agregandoA && (
        <AgregarLineasModal
          guia={agregandoA}
          rolBodega={rolBodega}
          onCerrar={() => setAgregandoA(null)}
          onGuardado={(n) => {
            setRecibidas((rs) =>
              rs.map((g) => (g.movimientoId === agregandoA.movimientoId ? { ...g, lineas: g.lineas + n } : g)),
            )
            setExito(`Se agregaron ${n} línea(s) a la guía ${agregandoA.folio}.`)
            setAgregandoA(null)
          }}
        />
      )}
    </div>
  )
}

/** Agrega líneas nuevas a una recepción ya guardada, bajo el mismo folio de guía. */
function AgregarLineasModal({
  guia,
  rolBodega,
  onCerrar,
  onGuardado,
}: {
  guia: { movimientoId: string; folio: string; proveedorId: string }
  rolBodega: RolBodega | null
  onCerrar: () => void
  onGuardado: (n: number) => void
}) {
  const [lineas, setLineas] = useState<LineaBorrador[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function agregar(linea: LineaBorrador) {
    setLineas((l) => [...l, linea])
  }

  function quitar(clave: string) {
    setLineas((l) => l.filter((x) => x.clave !== clave))
  }

  async function guardar() {
    setError(null)
    if (lineas.length === 0) return setError('Agrega al menos una línea.')
    setGuardando(true)
    try {
      await agregarLineasRecepcion(
        guia.movimientoId,
        lineas.map<LineaMovimiento>((l) => ({
          articulo_id: l.articulo.id,
          cantidad: l.cantidad,
          cantidad_guia: l.cantidadGuia,
          series: l.articulo.controla_serie ? l.series : undefined,
        })),
      )
      onGuardado(lineas.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setGuardando(false)
    }
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo={`Agregar líneas a la guía ${guia.folio}`} ancho="lg">
      <div className="space-y-4">
        <CapturaLinea
          onAgregar={agregar}
          yaAgregados={lineas.map((l) => l.articulo.id)}
          proveedorId={guia.proveedorId}
          rolBodega={rolBodega}
        />

        {lineas.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
            {lineas.map((l) => (
              <li key={l.clave} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="font-mono text-xs">{l.articulo.codigo_defontana}</span>
                <span className="min-w-0 flex-1 truncate">{l.articulo.descripcion}</span>
                <span className="shrink-0">
                  {l.cantidad} {l.articulo.unidad}
                </span>
                <button type="button" onClick={() => quitar(l.clave)} className="shrink-0 text-xs text-red-600 hover:underline">
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <Aviso tono="error">{error}</Aviso>}

        <div className="flex justify-end gap-2">
          <Boton type="button" variante="secundario" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="button" disabled={guardando || lineas.length === 0} onClick={guardar}>
            {guardando ? 'Guardando…' : `Agregar ${lineas.length} línea(s)`}
          </Boton>
        </div>
      </div>
    </Modal>
  )
}

/** Alta rápida de proveedor, para no cortar una recepción por uno que falta. */
function CrearProveedorRapido({
  onCerrar,
  onGuardado,
}: {
  onCerrar: () => void
  onGuardado: (p: Proveedor) => void
}) {
  const [nombre, setNombre] = useState('')
  const [rut, setRut] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setGuardando(true)
    try {
      const creado = await crearProveedor({
        nombre: nombre.trim(),
        rut: rut.trim() || null,
        activo: true,
      })
      onGuardado(creado)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGuardando(false)
    }
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo="Nuevo proveedor" ancho="sm">
      <form onSubmit={guardar} className="space-y-4">
        <Campo etiqueta="Razón social" htmlFor="prov-nombre" requerido>
          <input
            id="prov-nombre"
            required
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={claseInput}
          />
        </Campo>
        <Campo etiqueta="RUT" htmlFor="prov-rut" ayuda="Opcional, pero evita duplicar el mismo proveedor.">
          <input id="prov-rut" value={rut} onChange={(e) => setRut(e.target.value)} className={`${claseInput} font-mono`} />
        </Campo>

        {error && <Aviso tono="error">{error}</Aviso>}

        <div className="flex justify-end gap-2">
          <Boton type="button" variante="secundario" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Captura de una línea. El flujo está pensado para meter decenas de materiales:
 * buscar → Enter elige → cantidad → Enter agrega → el foco vuelve al buscador.
 */
function CapturaLinea({
  onAgregar,
  yaAgregados,
  proveedorId,
  rolBodega,
}: {
  onAgregar: (l: LineaBorrador) => void
  yaAgregados: string[]
  /** Vacío si la recepción no es "Compra a proveedor" o todavía no se eligió uno. */
  proveedorId: string
  rolBodega: RolBodega | null
}) {
  const [articulo, setArticulo] = useState<Articulo | null>(null)
  const [cantidadGuia, setCantidadGuia] = useState('')
  const [distinta, setDistinta] = useState(false)
  const [recibida, setRecibida] = useState('')
  const [series, setSeries] = useState<string[]>([])
  const [aviso, setAviso] = useState<string | null>(null)
  const [creando, setCreando] = useState<{ codigo: string; descripcion: string } | null>(null)
  const [codigoProveedor, setCodigoProveedor] = useState('')
  const [descripcionProveedor, setDescripcionProveedor] = useState('')
  const cantidadRef = useRef<HTMLInputElement>(null)

  function elegir(a: Articulo) {
    setArticulo(a)
    setCantidadGuia('')
    setRecibida('')
    setDistinta(false)
    setSeries([])
    setAviso(yaAgregados.includes(a.id) ? 'Este artículo ya está en la recepción; se agregará como otra línea.' : null)
    // El foco salta solo a la cantidad: es el siguiente dato que se teclea.
    setTimeout(() => cantidadRef.current?.focus(), 0)
  }

  /**
   * Al perder el foco del código de proveedor: si ya se enseñó a qué artículo
   * corresponde, lo elige solo. Si no hay equivalencia, no hace nada — sigue el
   * buscador manual de siempre.
   */
  async function buscarPorCodigoProveedor() {
    const codigo = codigoProveedor.trim()
    if (!codigo || !proveedorId) return
    try {
      const equivalencia = await buscarEquivalenciaProveedor(proveedorId, codigo)
      if (equivalencia) {
        const a = await obtenerArticulo(equivalencia.articulo_id)
        elegir(a)
        setDescripcionProveedor(equivalencia.descripcion_proveedor ?? '')
      }
    } catch {
      // Ayuda de búsqueda, no un requisito: si falla, se sigue a mano.
    }
  }

  const nGuia = Number(cantidadGuia)
  const nRecibida = distinta ? Number(recibida) : nGuia
  const seriesNecesarias = articulo?.controla_serie ? Math.abs(Math.round(nRecibida)) || 0 : 0

  function cambiarCantidadGuia(v: string) {
    setCantidadGuia(v)
    if (articulo?.controla_serie && !distinta) {
      const n = Math.abs(Math.round(Number(v))) || 0
      setSeries((s) => Array.from({ length: n }, (_, i) => s[i] ?? ''))
    }
  }

  function cambiarRecibida(v: string) {
    setRecibida(v)
    if (articulo?.controla_serie) {
      const n = Math.abs(Math.round(Number(v))) || 0
      setSeries((s) => Array.from({ length: n }, (_, i) => s[i] ?? ''))
    }
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!articulo) return
    if (!Number.isFinite(nRecibida) || nRecibida <= 0) return setAviso('La cantidad recibida debe ser mayor que cero.')
    if (seriesNecesarias > 0) {
      const limpias = series.map((s) => s.trim()).filter(Boolean)
      if (limpias.length !== seriesNecesarias) {
        return setAviso(`Faltan números de serie: se esperaban ${seriesNecesarias} y hay ${limpias.length}.`)
      }
      if (new Set(limpias.map((s) => s.toUpperCase())).size !== limpias.length) {
        return setAviso('Hay números de serie repetidos en esta línea.')
      }
    }

    onAgregar({
      clave: `${articulo.id}-${Date.now()}`,
      articulo,
      cantidadGuia: Number.isFinite(nGuia) && nGuia > 0 ? nGuia : nRecibida,
      cantidad: nRecibida,
      series: series.map((s) => s.trim()).filter(Boolean),
    })

    if (proveedorId && codigoProveedor.trim()) {
      registrarEquivalenciaProveedor({
        proveedor_id: proveedorId,
        codigo_proveedor: codigoProveedor.trim(),
        descripcion_proveedor: descripcionProveedor.trim() || null,
        articulo_id: articulo.id,
      }).catch(() => {
        // Ayuda de búsqueda, no un requisito: si falla, la recepción ya se agregó igual.
      })
    }

    setArticulo(null)
    setCantidadGuia('')
    setRecibida('')
    setDistinta(false)
    setSeries([])
    setAviso(null)
    setCodigoProveedor('')
    setDescripcionProveedor('')
  }

  if (!articulo) {
    return (
      <div>
        {proveedorId && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              etiqueta="Código del proveedor"
              htmlFor="codigo-proveedor"
              ayuda="Opcional. Si ya se enseñó a qué material corresponde, lo elige solo."
            >
              <input
                id="codigo-proveedor"
                inputMode="numeric"
                pattern="[0-9]*"
                value={codigoProveedor}
                onChange={(e) => setCodigoProveedor(e.target.value)}
                onBlur={buscarPorCodigoProveedor}
                className={`${claseInput} font-mono`}
              />
            </Campo>

            <Campo
              etiqueta="Descripción del proveedor"
              htmlFor="descripcion-proveedor"
              ayuda="Cómo lo llama el proveedor en su guía. Opcional."
            >
              <input
                id="descripcion-proveedor"
                value={descripcionProveedor}
                onChange={(e) => setDescripcionProveedor(e.target.value)}
                className={`${claseInput} italic`}
              />
            </Campo>
          </div>
        )}

        <SelectorArticulo
          onElegir={elegir}
          onCrearArticulo={(t) => setCreando(partirCodigoDescripcion(t))}
          // La primera vez, el foco lo tiene Folio: recién a partir de la
          // segunda línea el buscador se lo gana solo, para no cortar la
          // captura rápida ("buscar → Enter → cantidad → Enter → buscar…").
          autoFocus={yaAgregados.length > 0}
          placeholder="Busca por código o descripción y presiona Enter…"
        />
        <p className="mt-2 text-xs text-slate-500">
          Si la guía trae el código al principio de la descripción, puedes teclearlo tal cual: se reconoce solo. Y si
          el material no está en el catálogo, se crea sin salir de aquí.
        </p>

        {creando && (
          <FormularioArticulo
            articulo={null}
            codigoInicial={creando.codigo}
            descripcionInicial={creando.descripcion}
            rolBodega={rolBodega}
            onCerrar={() => setCreando(null)}
            onGuardado={(a) => {
              setCreando(null)
              // Recién creado y ya elegido para esta línea: la captura no se corta.
              elegir(a)
            }}
          />
        )}
      </div>
    )
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <div className="flex items-baseline gap-3 rounded-lg bg-slate-50 px-3 py-2">
        <span className="font-mono text-sm">{articulo.codigo_defontana}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{articulo.descripcion}</span>
        <button type="button" onClick={() => setArticulo(null)} className="text-xs text-slate-500 hover:underline">
          Cambiar
        </button>
      </div>

      {codigoProveedor.trim() && (
        <p className="text-xs text-slate-500">
          Código de proveedor <span className="font-mono">{codigoProveedor.trim()}</span>
          {descripcionProveedor.trim() ? (
            <span className="italic"> · {descripcionProveedor.trim()}</span>
          ) : (
            ' (se enseñará al agregar la línea)'
          )}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta={`Cantidad según la guía (${articulo.unidad})`} htmlFor="cant-guia" requerido>
          <input
            id="cant-guia"
            ref={cantidadRef}
            type="number"
            step="0.001"
            min="0"
            value={cantidadGuia}
            onChange={(e) => cambiarCantidadGuia(e.target.value)}
            className={claseInput}
          />
        </Campo>

        {distinta && (
          <Campo etiqueta={`Cantidad realmente recibida (${articulo.unidad})`} htmlFor="cant-recibida" requerido>
            <input
              id="cant-recibida"
              type="number"
              step="0.001"
              min="0"
              value={recibida}
              onChange={(e) => cambiarRecibida(e.target.value)}
              className={claseInput}
            />
          </Campo>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={distinta}
          onChange={(e) => {
            setDistinta(e.target.checked)
            if (e.target.checked) setRecibida(cantidadGuia)
          }}
          className="h-4 w-4 rounded border-slate-300"
        />
        Llegó una cantidad distinta de la que dice la guía
      </label>

      {seriesNecesarias > 0 && (
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Números de serie ({seriesNecesarias})
          </span>
          <div className="grid gap-2 sm:grid-cols-3">
            {Array.from({ length: seriesNecesarias }, (_, i) => (
              <input
                key={i}
                value={series[i] ?? ''}
                onChange={(e) => setSeries((s) => s.map((v, j) => (j === i ? e.target.value : v)))}
                placeholder={`Serie ${i + 1}`}
                className={`${claseControl} w-full font-mono`}
              />
            ))}
          </div>
        </div>
      )}

      {aviso && <Aviso tono="info">{aviso}</Aviso>}

      <div className="flex justify-end gap-2">
        <Boton type="button" variante="secundario" onClick={() => setArticulo(null)}>
          Cancelar
        </Boton>
        <Boton type="submit">Agregar línea</Boton>
      </div>
    </form>
  )
}
