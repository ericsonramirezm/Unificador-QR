import { useCallback, useState } from 'react'
import { Aviso, Boton, Campo, claseControl, claseInput } from '../../components/Campo'
import { Modal } from '../../components/Modal'
import { useCargar } from '../../lib/useCargar'
import { listarPendientes, resolverPendiente } from '../../lib/servicios/movimientos'
import { puedeRegistrar } from '../../permisos'
import type { RolBodega } from '@/types/index'
import {
  ETIQUETA_MOTIVO,
  type FilaPendiente,
  type MotivoResolucion,
} from '../../tipos'

const MOTIVOS: MotivoResolucion[] = ['LLEGO_DESPUES', 'MERMA_ACEPTADA', 'ERROR_GUIA']

/**
 * Lo que el origen quedó debiendo: recepciones donde llegó menos de lo que
 * declaraba la guía.
 *
 * La lista **se deriva del libro**, no de una tabla de pendientes. Cerrar uno no
 * modifica el movimiento: agrega su resolución, y el faltante original queda
 * registrado para siempre.
 */
export function Pendientes({ rolBodega }: { rolBodega: RolBodega | null }) {
  const [soloAbiertos, setSoloAbiertos] = useState(true)
  const [resolviendo, setResolviendo] = useState<FilaPendiente | null>(null)

  const cargar = useCallback(() => listarPendientes(soloAbiertos), [soloAbiertos])
  const { datos, cargando, error, recargar } = useCargar(cargar)
  const filas = datos ?? []

  const puedeCerrar = puedeRegistrar(rolBodega, 'ENTRADA')
  const totalFaltante = filas.filter((f) => f.pendiente).length

  return (
    <div className="space-y-4">
      <Aviso tono="info">
        Aquí aparecen las recepciones donde llegó <b>menos</b> de lo que decía la guía. El material sigue debiéndose
        hasta que alguien cierre el pendiente.
      </Aviso>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={soloAbiertos}
            onChange={(e) => setSoloAbiertos(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Ver solo los que siguen abiertos
        </label>
        <p className="text-sm text-slate-600">
          {cargando ? 'Cargando…' : `${filas.length} registro(s)${soloAbiertos ? '' : ` · ${totalFaltante} abierto(s)`}`}
        </p>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}

      {!cargando && filas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          {soloAbiertos
            ? 'No hay nada pendiente: todo lo recibido calzó con su guía.'
            : 'Todavía no se ha registrado ninguna recepción con faltante.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {filas.map((p) => (
            <li
              key={p.linea_id}
              className={`rounded-xl border p-3 shadow-sm ${
                p.pendiente ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">
                    <span className="font-mono text-sm">{p.codigo_defontana}</span> — {p.descripcion}
                  </p>
                  <p className="text-sm text-slate-600">
                    Faltan <b>{Number(p.cantidad_faltante)} {p.unidad}</b> de {Number(p.cantidad_guia)} declaradas ·
                    guía <span className="font-mono">{p.guia_folio ?? '—'}</span> ·{' '}
                    {p.proveedor ?? p.origen_nombre ?? 'origen sin indicar'}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-xs text-slate-500">{p.fecha}</p>
                  {p.pendiente ? (
                    <p className="text-xs font-medium text-amber-800">
                      {Number(p.dias_abierto)} día{Number(p.dias_abierto) === 1 ? '' : 's'} abierto
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      {ETIQUETA_MOTIVO[p.motivo!]}
                      {p.resuelto_por_nombre ? ` · ${p.resuelto_por_nombre}` : ''}
                    </p>
                  )}
                </div>
              </div>

              {!p.pendiente && p.nota && <p className="mt-1.5 text-sm text-slate-600">«{p.nota}»</p>}

              {p.pendiente && puedeCerrar && (
                <div className="mt-2 flex justify-end">
                  <Boton variante="secundario" onClick={() => setResolviendo(p)}>
                    Cerrar pendiente
                  </Boton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {resolviendo && (
        <DialogoResolver
          pendiente={resolviendo}
          onCerrar={() => setResolviendo(null)}
          onResuelto={() => {
            setResolviendo(null)
            recargar()
          }}
        />
      )}
    </div>
  )
}

function DialogoResolver({
  pendiente,
  onCerrar,
  onResuelto,
}: {
  pendiente: FilaPendiente
  onCerrar: () => void
  onResuelto: () => void
}) {
  const [motivo, setMotivo] = useState<MotivoResolucion>('LLEGO_DESPUES')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setGuardando(true)
    try {
      await resolverPendiente(pendiente.linea_id, motivo, nota)
      onResuelto()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setGuardando(false)
    }
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo="Cerrar pendiente"
      descripcion={`${pendiente.codigo_defontana} — faltan ${Number(pendiente.cantidad_faltante)} ${pendiente.unidad}`}
    >
      <form onSubmit={guardar} className="space-y-4">
        <Aviso tono="info">
          El movimiento original no se modifica. Se registra que este faltante quedó resuelto, con quién y cuándo.
        </Aviso>

        <Campo etiqueta="Motivo" htmlFor="motivo" requerido>
          <select
            id="motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value as MotivoResolucion)}
            className={`${claseControl} w-full`}
          >
            {MOTIVOS.map((m) => (
              <option key={m} value={m}>
                {ETIQUETA_MOTIVO[m]}
              </option>
            ))}
          </select>
        </Campo>

        <Campo
          etiqueta="Nota"
          htmlFor="nota"
          ayuda="Por ejemplo, en qué guía posterior llegó el material. Opcional pero muy útil dentro de seis meses."
        >
          <textarea id="nota" rows={3} value={nota} onChange={(e) => setNota(e.target.value)} className={claseInput} />
        </Campo>

        {error && <Aviso tono="error">{error}</Aviso>}

        <div className="flex justify-end gap-2">
          <Boton type="button" variante="secundario" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Cerrar pendiente'}
          </Boton>
        </div>
      </form>
    </Modal>
  )
}
