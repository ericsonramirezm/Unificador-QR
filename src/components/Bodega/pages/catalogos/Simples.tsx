import { useCallback, useState } from 'react'
import { Aviso, Boton, Campo, claseInput } from '../../components/Campo'
import { Modal } from '../../components/Modal'
import { TablaCatalogo, type Columna } from '../../components/TablaCatalogo'
import { useCargar } from '../../lib/useCargar'
import {
  actualizarProveedor,
  actualizarSala,
  actualizarTrabajador,
  crearProveedor,
  crearSala,
  crearTrabajador,
  eliminarProveedor,
  eliminarTrabajador,
  listarProveedores,
  listarSalas,
  listarTrabajadores,
} from '../../lib/servicios/catalogos'
import type { Proveedor, SalaElectrica, Trabajador } from '../../tipos'

/**
 * Proveedores, salas eléctricas y trabajadores comparten exactamente la misma
 * forma: una lista de registros con unos pocos campos de texto y un interruptor
 * de activo. Se resuelven con un componente configurable en vez de tres
 * pantallas casi idénticas que después haya que corregir tres veces.
 */

interface CampoDef<T> {
  clave: keyof T & string
  etiqueta: string
  requerido?: boolean
  ayuda?: string
  mono?: boolean
  principal?: boolean
}

interface Base {
  id: string
  activo: boolean
}

function CatalogoSimple<T extends Base>({
  titulo,
  singular,
  campos,
  listar,
  crear,
  actualizar,
  eliminar,
  etiquetaFila,
  vacio,
}: {
  titulo: string
  singular: string
  campos: CampoDef<T>[]
  listar: () => Promise<T[]>
  crear: (v: Record<string, unknown>) => Promise<T>
  actualizar: (id: string, v: Record<string, unknown>) => Promise<T>
  /** Sin esto, la tabla no ofrece "Eliminar" en su menú contextual. */
  eliminar?: (id: string) => Promise<void>
  etiquetaFila?: (fila: T) => string
  vacio: string
}) {
  const [editando, setEditando] = useState<T | 'nuevo' | null>(null)
  const [mostrarInactivos, setMostrarInactivos] = useState(false)

  const cargar = useCallback(() => listar(), [listar])
  const { datos, cargando, error, recargar } = useCargar(cargar)
  const filas = (datos ?? []).filter((f) => mostrarInactivos || f.activo)

  const columnas: Columna<T>[] = campos.map((c) => ({
    clave: c.clave,
    titulo: c.etiqueta,
    principal: c.principal,
    render: (fila) => {
      const valor = (fila[c.clave] as string | null) || '—'
      return (
        <span className={c.mono ? 'font-mono' : undefined}>
          {valor}
          {c.principal && !fila.activo && (
            <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 font-sans text-xs">inactivo</span>
          )}
        </span>
      )
    },
  }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={mostrarInactivos}
            onChange={(e) => setMostrarInactivos(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Mostrar inactivos
        </label>
        <Boton onClick={() => setEditando('nuevo')}>Nuevo {singular}</Boton>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}
      {cargando ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <TablaCatalogo
          columnas={columnas}
          filas={filas}
          onFila={setEditando}
          onEliminar={
            eliminar
              ? async (fila) => {
                  await eliminar(fila.id)
                  recargar()
                }
              : undefined
          }
          etiquetaFila={etiquetaFila}
          vacio={vacio}
        />
      )}

      {editando && (
        <Formulario
          titulo={editando === 'nuevo' ? `Nuevo ${singular}` : `Editar ${singular}`}
          campos={campos}
          registro={editando === 'nuevo' ? null : editando}
          onCerrar={() => setEditando(null)}
          onGuardar={async (valores) => {
            if (editando === 'nuevo') await crear(valores)
            else await actualizar(editando.id, valores)
            setEditando(null)
            recargar()
          }}
        />
      )}
      <p className="text-xs text-slate-500">
        {filas.length} {titulo.toLowerCase()}
      </p>
    </div>
  )
}

function Formulario<T extends Base>({
  titulo,
  campos,
  registro,
  onCerrar,
  onGuardar,
}: {
  titulo: string
  campos: CampoDef<T>[]
  registro: T | null
  onCerrar: () => void
  onGuardar: (valores: Record<string, unknown>) => Promise<void>
}) {
  const [v, setV] = useState<Record<string, string>>(() =>
    Object.fromEntries(campos.map((c) => [c.clave, registro ? ((registro[c.clave] as string | null) ?? '') : ''])),
  )
  const [activo, setActivo] = useState(registro?.activo ?? true)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setGuardando(true)
    try {
      const valores: Record<string, unknown> = { activo }
      for (const c of campos) {
        const texto = v[c.clave]?.trim() ?? ''
        valores[c.clave] = c.requerido ? texto : texto || null
      }
      await onGuardar(valores)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGuardando(false)
    }
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo={titulo}>
      <form onSubmit={enviar} className="space-y-4">
        {campos.map((c) => (
          <Campo key={c.clave} etiqueta={c.etiqueta} htmlFor={c.clave} requerido={c.requerido} ayuda={c.ayuda}>
            <input
              id={c.clave}
              required={c.requerido}
              value={v[c.clave] ?? ''}
              onChange={(e) => setV((prev) => ({ ...prev, [c.clave]: e.target.value }))}
              className={`${claseInput} ${c.mono ? 'font-mono' : ''}`}
            />
          </Campo>
        ))}

        {registro && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={activo}
              onChange={(e) => setActivo(e.target.checked)}
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
          <Boton type="submit" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      </form>
    </Modal>
  )
}

// --- Las tres configuraciones ------------------------------------------------

export const Proveedores = () => (
  <CatalogoSimple<Proveedor>
    titulo="Proveedores"
    singular="proveedor"
    vacio="Todavía no hay proveedores. Crea el primero para poder registrar una guía de despacho."
    campos={[
      { clave: 'nombre', etiqueta: 'Razón social', requerido: true, principal: true },
      { clave: 'rut', etiqueta: 'RUT', mono: true, ayuda: 'Opcional, pero evita duplicar el mismo proveedor.' },
    ]}
    listar={listarProveedores}
    crear={(v) => crearProveedor(v as Omit<Proveedor, 'id'>)}
    actualizar={(id, v) => actualizarProveedor(id, v as Partial<Proveedor>)}
    eliminar={eliminarProveedor}
    etiquetaFila={(p) => p.nombre}
  />
)

export const Salas = () => (
  <CatalogoSimple<SalaElectrica>
    titulo="Salas eléctricas"
    singular="sala"
    vacio="Todavía no hay salas eléctricas. Son el destino de las salidas de material."
    campos={[
      { clave: 'nombre', etiqueta: 'Nombre', requerido: true, principal: true },
      { clave: 'codigo', etiqueta: 'Código', mono: true, ayuda: 'Opcional.' },
    ]}
    listar={listarSalas}
    crear={(v) => crearSala(v as Omit<SalaElectrica, 'id'>)}
    actualizar={(id, v) => actualizarSala(id, v as Partial<SalaElectrica>)}
  />
)

export const Trabajadores = () => (
  <CatalogoSimple<Trabajador>
    titulo="Trabajadores"
    singular="trabajador"
    vacio="Todavía no hay trabajadores. Son quienes reciben el EPP."
    campos={[
      { clave: 'nombre', etiqueta: 'Nombre', requerido: true, principal: true },
      { clave: 'rut', etiqueta: 'RUT', requerido: true, mono: true },
      { clave: 'cargo', etiqueta: 'Cargo' },
    ]}
    listar={listarTrabajadores}
    crear={(v) => crearTrabajador(v as Omit<Trabajador, 'id'>)}
    actualizar={(id, v) => actualizarTrabajador(id, v as Partial<Trabajador>)}
    eliminar={eliminarTrabajador}
    etiquetaFila={(t) => t.nombre}
  />
)
