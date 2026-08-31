import { useCallback, useState } from 'react'
import { Aviso, Boton, Campo, claseInput } from '../../components/Campo'
import { Modal } from '../../components/Modal'
import { TablaCatalogo, type Columna } from '../../components/TablaCatalogo'
import { useCargar } from '../../lib/useCargar'
import { actualizarBodega, crearBodega, eliminarBodega, listarBodegas } from '../../lib/servicios/catalogos'
import type { Bodega } from '../../tipos'

export function Bodegas() {
  const cargar = useCallback(() => listarBodegas(), [])
  const { datos, cargando, error, recargar } = useCargar(cargar)
  const bodegas = datos ?? []
  const [editando, setEditando] = useState<Bodega | 'nueva' | null>(null)

  const columnas: Columna<Bodega>[] = [
    {
      clave: 'nombre',
      titulo: 'Nombre',
      principal: true,
      render: (b) => (
        <span>
          {b.nombre}
          {!b.activo && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs">inactiva</span>}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      {!cargando && bodegas.length === 0 && (
        <Aviso tono="info">
          Todavía no existe ninguna bodega. Créala ahora: sin una bodega no se puede registrar ningún movimiento.
        </Aviso>
      )}

      <div className="flex justify-end">
        <Boton onClick={() => setEditando('nueva')}>Nueva bodega</Boton>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}
      {cargando ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <TablaCatalogo
          columnas={columnas}
          filas={bodegas}
          onFila={setEditando}
          onEliminar={async (b) => {
            await eliminarBodega(b.id)
            recargar()
          }}
          etiquetaFila={(b) => b.nombre}
          vacio="No hay bodegas."
        />
      )}

      <p className="text-xs text-slate-500">
        El sistema opera con una sola bodega. La segunda solo hace falta si se abre un depósito en faena, y entonces
        habilita los traslados entre ambas.
      </p>

      {editando && (
        <FormularioBodega
          bodega={editando === 'nueva' ? null : editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null)
            recargar()
          }}
        />
      )}
    </div>
  )
}

function FormularioBodega({
  bodega,
  onCerrar,
  onGuardado,
}: {
  bodega: Bodega | null
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [nombre, setNombre] = useState(bodega?.nombre ?? '')
  const [activo, setActivo] = useState(bodega?.activo ?? true)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setGuardando(true)
    try {
      if (bodega) await actualizarBodega(bodega.id, { nombre: nombre.trim(), activo })
      else await crearBodega(nombre)
      onGuardado()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGuardando(false)
    }
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo={bodega ? 'Editar bodega' : 'Nueva bodega'} ancho="sm">
      <form onSubmit={guardar} className="space-y-4">
        <Campo etiqueta="Nombre" htmlFor="nombre" requerido>
          <input
            id="nombre"
            required
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Bodega Central"
            className={claseInput}
          />
        </Campo>

        {bodega && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={activo}
              onChange={(e) => setActivo(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Activa
          </label>
        )}

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
