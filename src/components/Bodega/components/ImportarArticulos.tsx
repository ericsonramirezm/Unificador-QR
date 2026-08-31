import { useState } from 'react'
import { Aviso, Boton } from './Campo'
import { Modal } from './Modal'
import { crearArticulosEnBloque, listarCodigosExistentes } from '../lib/servicios/catalogos'
import { leerArticulosXlsx, type FilaImportada, type ResultadoLectura } from '../lib/importar/importarArticulosXlsx'

/**
 * Carga inicial del catálogo desde una planilla. Muestra SIEMPRE la vista previa
 * antes de escribir: importar a ciegas un archivo con códigos repetidos es la
 * forma más rápida de dejar el catálogo inservible.
 */
export function ImportarArticulos({ onCerrar, onImportado }: { onCerrar: () => void; onImportado: () => void }) {
  const [lectura, setLectura] = useState<ResultadoLectura | null>(null)
  const [nombreArchivo, setNombreArchivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [importados, setImportados] = useState<number | null>(null)

  async function elegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    if (!archivo) return
    setError(null)
    setTrabajando(true)
    setNombreArchivo(archivo.name)
    try {
      const existentes = await listarCodigosExistentes()
      setLectura(await leerArticulosXlsx(archivo, existentes))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLectura(null)
    } finally {
      setTrabajando(false)
    }
  }

  async function importar() {
    if (!lectura) return
    setError(null)
    setTrabajando(true)
    try {
      const n = await crearArticulosEnBloque(lectura.nuevos.map((f) => f.datos))
      setImportados(n)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <Modal
      abierto
      onCerrar={importados === null ? onCerrar : onImportado}
      titulo="Importar artículos desde Excel"
      descripcion="Se agregan solo los códigos nuevos. Ninguno existente se modifica."
      ancho="lg"
    >
      {importados !== null ? (
        <div className="space-y-4">
          <Aviso tono="exito">
            Se agregaron {importados} artículo{importados === 1 ? '' : 's'} al catálogo.
          </Aviso>
          <div className="flex justify-end">
            <Boton onClick={onImportado}>Listo</Boton>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {!lectura && (
            <>
              <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                <p className="font-medium text-slate-800">Qué debe traer la planilla</p>
                <p className="mt-1">
                  La primera hoja, con una fila de encabezados. Obligatorias: <b>Código</b> y{' '}
                  <b>Descripción</b>. Opcionales: Tipo (Material/EPP), Unidad, Marca, Familia, Serie (Sí/No) y Stock
                  mínimo. El orden de las columnas no importa.
                </p>
              </div>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={elegirArchivo}
                disabled={trabajando}
                className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700"
              />
            </>
          )}

          {trabajando && <p className="text-sm text-slate-500">Procesando…</p>}
          {error && <Aviso tono="error">{error}</Aviso>}

          {lectura && (
            <>
              <p className="text-sm text-slate-600">
                <b>{nombreArchivo}</b> · hoja «{lectura.hoja}»
              </p>

              <div className="grid grid-cols-3 gap-2 text-center">
                <Resumen n={lectura.nuevos.length} etiqueta="se agregarán" tono="bg-emerald-50 text-emerald-800" />
                <Resumen n={lectura.yaExisten.length} etiqueta="ya existen" tono="bg-amber-50 text-amber-800" />
                <Resumen
                  n={lectura.repetidosEnArchivo.length}
                  etiqueta="repetidos en el archivo"
                  tono="bg-red-50 text-red-800"
                />
              </div>

              {lectura.descartadas > 0 && (
                <p className="text-xs text-slate-500">
                  {lectura.descartadas} fila(s) se ignoraron por no tener código o descripción.
                </p>
              )}

              {lectura.nuevos.length > 0 && (
                <Listado titulo="Se agregarán" filas={lectura.nuevos} />
              )}
              {lectura.yaExisten.length > 0 && (
                <Listado
                  titulo="Ya están en el catálogo — no se tocan"
                  filas={lectura.yaExisten}
                  tono="text-amber-800"
                />
              )}
              {lectura.repetidosEnArchivo.length > 0 && (
                <Listado
                  titulo="Repetidos dentro del archivo — se conserva la primera aparición"
                  filas={lectura.repetidosEnArchivo}
                  tono="text-red-800"
                />
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Boton variante="secundario" onClick={onCerrar}>
                  Cancelar
                </Boton>
                <Boton onClick={importar} disabled={trabajando || lectura.nuevos.length === 0}>
                  Agregar {lectura.nuevos.length} artículo{lectura.nuevos.length === 1 ? '' : 's'}
                </Boton>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}

function Resumen({ n, etiqueta, tono }: { n: number; etiqueta: string; tono: string }) {
  return (
    <div className={`rounded-lg p-3 ${tono}`}>
      <p className="text-2xl font-semibold">{n}</p>
      <p className="text-xs">{etiqueta}</p>
    </div>
  )
}

function Listado({ titulo, filas, tono = 'text-slate-700' }: { titulo: string; filas: FilaImportada[]; tono?: string }) {
  const MOSTRAR = 50
  return (
    <details className="rounded-lg border border-slate-200">
      <summary className={`cursor-pointer px-3 py-2 text-sm font-medium ${tono}`}>
        {titulo} ({filas.length})
      </summary>
      <ul className="max-h-56 overflow-y-auto border-t border-slate-100 px-3 py-2 text-sm">
        {filas.slice(0, MOSTRAR).map((f) => (
          <li key={`${f.fila}-${f.datos.codigo_defontana}`} className="flex gap-2 py-0.5">
            <span className="w-10 shrink-0 text-right text-xs text-slate-400">{f.fila}</span>
            <span className="w-32 shrink-0 font-mono text-xs">{f.datos.codigo_defontana}</span>
            <span className="min-w-0 truncate text-slate-600">{f.datos.descripcion}</span>
          </li>
        ))}
        {filas.length > MOSTRAR && (
          <li className="py-1 text-xs text-slate-500">…y {filas.length - MOSTRAR} más</li>
        )}
      </ul>
    </details>
  )
}
