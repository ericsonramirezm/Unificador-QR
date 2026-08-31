import { useState } from 'react'
import { Aviso, Boton, Campo, claseInput, claseInputError } from './Campo'
import { Modal } from './Modal'
import { FotoArticulo, SelectorImagen, useVistaPrevia } from './FotoArticulo'
import { subirFotoArticulo } from '../lib/servicios/fotos'
import { useCargar } from '../lib/useCargar'
import {
  actualizarArticulo,
  crearArticulo,
  crearTipoArticulo,
  listarTiposArticulo,
  normalizarCodigo,
  obtenerArticuloPorCodigo,
  type DatosArticulo,
} from '../lib/servicios/catalogos'
import type { RolBodega } from '@/types/index'
import type { Articulo, TipoArticulo, TipoArticuloCatalogo } from '../tipos'

/**
 * Paleta fija: Tailwind solo genera CSS de las clases que ve escritas en el
 * código fuente, así que un color guardado como texto libre en la base no
 * pintaría nada. Se elige una de esta lista al crear un tipo, y esa clase
 * completa es lo que queda guardado en `tipos_articulo.color`.
 */
const PALETA_COLOR_TIPO = [
  'bg-slate-100 text-slate-700',
  'bg-blue-100 text-blue-800',
  'bg-emerald-100 text-emerald-800',
  'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-800',
  'bg-violet-100 text-violet-800',
  'bg-cyan-100 text-cyan-800',
  'bg-orange-100 text-orange-800',
]

/**
 * Alta y edición de artículos. Vive aquí, y no dentro de la pantalla de
 * Catálogos, porque también se usa desde la Recepción para dar de alta material
 * que llegó sin estar en el catálogo.
 *
 * **Es a propósito un solo componente compartido.** La validación de Código
 * Defontana duplicado es justo lo que no debe existir en dos versiones capaces
 * de separarse: una copia que se quedara atrás dejaría entrar por Recepción lo
 * que Catálogos rechaza.
 */

/** Unidades habituales. Es una sugerencia, no una lista cerrada. */
const UNIDADES = ['UN', 'MT', 'KG', 'LT', 'PAR', 'CJ', 'RLL', 'JGO', 'M2', 'M3', 'GL']

const VACIO: DatosArticulo = {
  codigo_defontana: '',
  descripcion: '',
  tipo: 'MATERIAL',
  unidad: 'UN',
  marca: '',
  familia: '',
  controla_serie: false,
  stock_minimo: 0,
  activo: true,
}

export function FormularioArticulo({
  articulo,
  codigoInicial,
  descripcionInicial,
  rolBodega,
  onCerrar,
  onGuardado,
}: {
  /** `null` para crear uno nuevo. */
  articulo: Articulo | null
  /** Precarga al abrirlo desde el buscador de la Recepción. */
  codigoInicial?: string
  descripcionInicial?: string
  /** Reemplaza al `rol` que antes venía de `useSesion()` — pasa a `FotoArticulo`. */
  rolBodega: RolBodega | null
  onCerrar: () => void
  onGuardado: (a: Articulo) => void
}) {
  const [v, setV] = useState<DatosArticulo>(
    articulo
      ? {
          codigo_defontana: articulo.codigo_defontana,
          descripcion: articulo.descripcion,
          tipo: articulo.tipo,
          unidad: articulo.unidad,
          marca: articulo.marca ?? '',
          familia: articulo.familia ?? '',
          controla_serie: articulo.controla_serie,
          stock_minimo: articulo.stock_minimo,
          activo: articulo.activo,
        }
      : { ...VACIO, codigo_defontana: codigoInicial ?? '', descripcion: descripcionInicial ?? '' },
  )
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const { datos: tiposCargados } = useCargar(listarTiposArticulo)
  // Igual que el proveedor recién creado en la Recepción: se agrega a mano a
  // la lista en vez de recargar el catálogo entero, para que quede elegido
  // de inmediato.
  const [tipoNuevo, setTipoNuevo] = useState<TipoArticuloCatalogo | null>(null)
  const [creandoTipo, setCreandoTipo] = useState(false)
  const listaTipos = tipoNuevo ? [...(tiposCargados ?? []), tipoNuevo] : (tiposCargados ?? [])

  /** El artículo que ya existe, sobre el que la foto se sube al instante. */
  const [conFoto, setConFoto] = useState<Articulo | null>(articulo)

  /**
   * Al **crear**, la foto no se puede subir todavía: su ruta lleva el
   * identificador del artículo, que aún no existe. El archivo espera aquí y se
   * sube dentro del mismo Guardar, en cuanto el artículo tiene identificador.
   */
  const [fotoPendiente, setFotoPendiente] = useState<File | null>(null)
  const previaPendiente = useVistaPrevia(fotoPendiente)

  /**
   * Solo aparece si el artículo se creó **pero su foto falló**. El camino normal
   * no pasa por aquí: es una pantalla de recuperación, no un segundo paso.
   */
  const [fotoFallida, setFotoFallida] = useState<{ articulo: Articulo; motivo: string } | null>(null)

  const cambiar = <K extends keyof DatosArticulo>(k: K, valor: DatosArticulo[K]) =>
    setV((prev) => ({ ...prev, [k]: valor }))

  /**
   * Aviso temprano del duplicado, mientras el usuario sigue en el campo. El
   * control de verdad es el índice único de Postgres — este solo evita que
   * escriba el formulario completo para enterarse al guardar.
   */
  async function comprobarCodigo() {
    const codigo = normalizarCodigo(v.codigo_defontana)
    if (!codigo) return setErrorCodigo(null)
    try {
      const existente = await obtenerArticuloPorCodigo(codigo)
      setErrorCodigo(
        existente && existente.id !== articulo?.id
          ? `Ese código ya lo usa "${existente.descripcion}". Los Códigos Defontana no se pueden repetir.`
          : null,
      )
    } catch {
      // Si la comprobación falla (red), no se bloquea: la base tiene la última palabra.
      setErrorCodigo(null)
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setGuardando(true)
    try {
      const datos: DatosArticulo = {
        ...v,
        marca: v.marca?.trim() || null,
        familia: v.familia?.trim() || null,
        descripcion: v.descripcion.trim(),
      }
      const guardado = articulo ? await actualizarArticulo(articulo.id, datos) : await crearArticulo(datos)

      // La foto elegida antes de existir el artículo se sube ahora, dentro del
      // mismo Guardar. Si falla, el artículo NO se deshace: ya está en el
      // catálogo y la recepción tiene que poder seguir. Detener la descarga de un
      // camión porque no subió una foto sería la prioridad equivocada.
      if (!articulo && fotoPendiente) {
        try {
          onGuardado(await subirFotoArticulo(guardado, fotoPendiente))
          return
        } catch (e) {
          setFotoFallida({ articulo: guardado, motivo: e instanceof Error ? e.message : String(e) })
          setGuardando(false)
          return
        }
      }

      onGuardado(guardado)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setGuardando(false)
    }
  }

  /** Reintento de la foto sobre el artículo que ya quedó creado. */
  async function reintentarFoto() {
    if (!fotoFallida || !fotoPendiente) return
    setGuardando(true)
    try {
      onGuardado(await subirFotoArticulo(fotoFallida.articulo, fotoPendiente))
    } catch (e) {
      setFotoFallida({ ...fotoFallida, motivo: e instanceof Error ? e.message : String(e) })
      setGuardando(false)
    }
  }

  // Camino de recuperación: el artículo existe, la foto no llegó.
  if (fotoFallida) {
    return (
      <Modal
        abierto
        onCerrar={() => onGuardado(fotoFallida.articulo)}
        titulo="El artículo se creó, la foto no"
        descripcion={fotoFallida.articulo.codigo_defontana}
      >
        <div className="space-y-4">
          <Aviso tono="exito">
            {fotoFallida.articulo.descripcion} ya está en el catálogo y puedes seguir con la recepción.
          </Aviso>
          <Aviso tono="error">{fotoFallida.motivo}</Aviso>

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Boton type="button" variante="secundario" onClick={() => onGuardado(fotoFallida.articulo)}>
              Continuar sin foto
            </Boton>
            <Boton type="button" disabled={guardando} onClick={reintentarFoto}>
              {guardando ? 'Subiendo…' : 'Reintentar la foto'}
            </Boton>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <>
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={articulo ? 'Editar artículo' : 'Nuevo artículo'}
      descripcion={articulo ? articulo.codigo_defontana : 'El Código Defontana no se puede repetir.'}
    >
      <form onSubmit={guardar} className="space-y-4">
        {/* Al editar sube al instante. Al crear solo retiene el archivo, porque
            la ruta de la foto lleva el identificador del artículo y todavía no
            existe: lo sube `guardar()` en cuanto lo tiene. */}
        {conFoto ? (
          <FotoArticulo articulo={conFoto} onCambiada={setConFoto} tamano="compacto" rolBodega={rolBodega} />
        ) : (
          <SelectorImagen
            url={previaPendiente}
            onArchivo={setFotoPendiente}
            onQuitar={() => setFotoPendiente(null)}
            ocupado={guardando}
            tamano="compacto"
          />
        )}

        <Campo
          etiqueta="Código Defontana"
          htmlFor="codigo"
          requerido
          error={errorCodigo}
          ayuda="Se guarda en mayúsculas y sin espacios."
        >
          <input
            id="codigo"
            required
            autoFocus={!articulo && !codigoInicial}
            inputMode="numeric"
            pattern="[0-9]*"
            value={v.codigo_defontana}
            onChange={(e) => {
              cambiar('codigo_defontana', e.target.value)
              setErrorCodigo(null)
            }}
            onBlur={comprobarCodigo}
            className={`${claseInput} font-mono ${errorCodigo ? claseInputError : ''}`}
          />
        </Campo>

        <Campo etiqueta="Descripción" htmlFor="descripcion" requerido>
          <input
            id="descripcion"
            required
            value={v.descripcion}
            onChange={(e) => cambiar('descripcion', e.target.value)}
            className={claseInput}
          />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Tipo" htmlFor="tipo" requerido>
            <select
              id="tipo"
              value={v.tipo}
              onChange={(e) => cambiar('tipo', e.target.value as TipoArticulo)}
              className={claseInput}
            >
              {listaTipos.map((t) => (
                <option key={t.codigo} value={t.codigo}>
                  {t.nombre}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setCreandoTipo(true)}
              className="mt-1 text-xs font-medium text-blue-600 hover:underline"
            >
              + Nuevo tipo
            </button>
          </Campo>

          <Campo etiqueta="Unidad" htmlFor="unidad" requerido>
            <input
              id="unidad"
              required
              list="unidades"
              value={v.unidad}
              onChange={(e) => cambiar('unidad', e.target.value)}
              className={claseInput}
            />
            <datalist id="unidades">
              {UNIDADES.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </Campo>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Marca" htmlFor="marca">
            <input id="marca" value={v.marca ?? ''} onChange={(e) => cambiar('marca', e.target.value)} className={claseInput} />
          </Campo>
          <Campo etiqueta="Familia" htmlFor="familia">
            <input
              id="familia"
              value={v.familia ?? ''}
              onChange={(e) => cambiar('familia', e.target.value)}
              className={claseInput}
            />
          </Campo>
        </div>

        <Campo etiqueta="Stock mínimo" htmlFor="minimo" ayuda="Bajo esta cantidad el artículo se marca como crítico.">
          <input
            id="minimo"
            type="number"
            min={0}
            step="0.001"
            value={v.stock_minimo}
            onChange={(e) => cambiar('stock_minimo', Number(e.target.value))}
            className={claseInput}
          />
        </Campo>

        <label className="flex items-start gap-2.5 rounded-lg bg-slate-50 p-3">
          <input
            type="checkbox"
            checked={v.controla_serie}
            onChange={(e) => cambiar('controla_serie', e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span className="text-sm">
            <span className="font-medium text-slate-800">Se controla por número de serie</span>
            <span className="block text-slate-500">
              Al recibirlo habrá que digitar una serie por unidad, y al entregarlo elegir cuál sale. Úsalo en equipos
              como paneles o detectores, no en cable ni guantes.
            </span>
          </span>
        </label>

        {articulo && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={v.activo}
              onChange={(e) => cambiar('activo', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Activo
          </label>
        )}

        {error && <Aviso tono="error">{error}</Aviso>}

        <div className="flex justify-end gap-2 pt-2">
          <Boton type="button" variante="secundario" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" disabled={guardando || Boolean(errorCodigo)}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      </form>
    </Modal>

    {creandoTipo && (
      <CrearTipoArticuloRapido
        onCerrar={() => setCreandoTipo(false)}
        onGuardado={(t) => {
          setTipoNuevo(t)
          cambiar('tipo', t.codigo)
          setCreandoTipo(false)
        }}
      />
    )}
    </>
  )
}

/** Alta rápida de un tipo de artículo, para no cortar el alta de un artículo por uno que falta. */
function CrearTipoArticuloRapido({
  onCerrar,
  onGuardado,
}: {
  onCerrar: () => void
  onGuardado: (t: TipoArticuloCatalogo) => void
}) {
  const [nombre, setNombre] = useState('')
  const [color, setColor] = useState(PALETA_COLOR_TIPO[0])
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setGuardando(true)
    try {
      onGuardado(await crearTipoArticulo({ nombre: nombre.trim(), color }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGuardando(false)
    }
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo="Nuevo tipo de artículo" ancho="sm">
      <form onSubmit={guardar} className="space-y-4">
        <Campo etiqueta="Nombre" htmlFor="tipo-nombre" requerido>
          <input
            id="tipo-nombre"
            required
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={claseInput}
          />
        </Campo>

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Color</span>
          <div className="flex flex-wrap gap-2">
            {PALETA_COLOR_TIPO.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-pressed={color === c}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-2 ${c} ${
                  color === c ? 'ring-blue-500' : 'ring-transparent'
                }`}
              >
                {nombre.trim() || 'Vista previa'}
              </button>
            ))}
          </div>
        </div>

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
