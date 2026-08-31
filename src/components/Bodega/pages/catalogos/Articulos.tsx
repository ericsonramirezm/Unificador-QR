import { lazy, Suspense, useCallback, useState } from 'react'
import { Aviso, Boton, claseControl, claseInput } from '../../components/Campo'
import { FormularioArticulo } from '../../components/FormularioArticulo'
import { MiniaturaArticulo } from '../../components/FotoArticulo'
import { TablaCatalogo, type Columna } from '../../components/TablaCatalogo'
import { useCargar } from '../../lib/useCargar'
import {
  eliminarArticulo,
  listarArticulos,
  listarEquivalenciasProveedor,
  listarProveedores,
  listarTiposArticulo,
} from '../../lib/servicios/catalogos'
import type { RolBodega } from '@/types/index'
import type { Articulo, TipoArticulo } from '../../tipos'

/** Reserva si la lista de tipos todavía no cargó o el dato no calzara con ninguno. */
const TIPO_RESERVA = { nombre: '', color: 'bg-slate-100 text-slate-500' }

/**
 * SheetJS pesa ~600 kB y solo hace falta al importar una planilla — algo que se
 * hace una vez. Cargarlo bajo demanda deja el arranque de la app liviano, que es
 * lo que importa cuando se abre desde el celular en faena con mala señal.
 */
const ImportarArticulos = lazy(() =>
  import('../../components/ImportarArticulos').then((m) => ({ default: m.ImportarArticulos })),
)

export function Articulos({ rolBodega }: { rolBodega: RolBodega | null }) {
  const [texto, setTexto] = useState('')
  const [tipo, setTipo] = useState<TipoArticulo | 'TODOS'>('TODOS')
  const [incluirInactivos, setIncluirInactivos] = useState(false)
  const [editando, setEditando] = useState<Articulo | 'nuevo' | null>(null)
  const [importando, setImportando] = useState(false)

  // Debe ir memoizado: `useCargar` lo usa como dependencia del efecto.
  const cargar = useCallback(
    () => listarArticulos({ texto, tipo, incluirInactivos }),
    [texto, tipo, incluirInactivos],
  )
  const { datos, cargando, error, recargar } = useCargar(cargar)
  const articulos = datos ?? []

  const { datos: tipos } = useCargar(listarTiposArticulo)
  const tipoPorCodigo = (codigo: string) => tipos?.find((t) => t.codigo === codigo) ?? { ...TIPO_RESERVA, nombre: codigo }

  // Igual que en Stock.tsx: no depende de los filtros, se pide una sola vez. Un
  // artículo puede tener equivalencias de varios proveedores distintos.
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

  const columnas: Columna<Articulo>[] = [
    {
      clave: 'codigo',
      titulo: 'Código Defontana',
      principal: true,
      render: (a) => (
        <div>
          <span className="font-mono font-medium">
            {a.codigo_defontana}
            {!a.activo && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs font-sans">inactivo</span>}
          </span>
          {(equivalenciasPorArticulo?.get(a.id) ?? []).map((e) => (
            <div key={e.id} className="mt-1">
              <div className="font-mono text-sm italic">{e.codigo}</div>
              {e.descripcion && <div className="text-sm italic text-slate-600">{e.descripcion}</div>}
              <div className="text-xs text-slate-400">Código Proveedor · {e.proveedor}</div>
            </div>
          ))}
        </div>
      ),
    },
    { clave: 'descripcion', titulo: 'Descripción', render: (a) => a.descripcion },
    {
      clave: 'tipo',
      titulo: 'Tipo',
      render: (a) => {
        const t = tipoPorCodigo(a.tipo)
        return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.color}`}>{t.nombre}</span>
      },
    },
    { clave: 'unidad', titulo: 'Unidad', render: (a) => a.unidad },
    { clave: 'marca', titulo: 'Marca', render: (a) => a.marca || '—', soloEscritorio: true },
    {
      clave: 'serie',
      titulo: 'Serie',
      render: (a) => (a.controla_serie ? 'Sí' : 'No'),
      soloEscritorio: true,
    },
    { clave: 'minimo', titulo: 'Mínimo', render: (a) => a.stock_minimo, className: 'text-right' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por código, descripción o marca…"
          className={`${claseInput} min-w-0 flex-1 sm:max-w-md`}
        />
        <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoArticulo | 'TODOS')} className={claseControl}>
          <option value="TODOS">Todos los tipos</option>
          {(tipos ?? []).map((t) => (
            <option key={t.codigo} value={t.codigo}>
              {t.nombre}
            </option>
          ))}
        </select>
        <Boton variante="secundario" onClick={() => setImportando(true)}>
          Importar Excel
        </Boton>
        <Boton onClick={() => setEditando('nuevo')}>Nuevo artículo</Boton>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={incluirInactivos}
          onChange={(e) => setIncluirInactivos(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        Mostrar también los inactivos
      </label>

      {error && <Aviso tono="error">{error}</Aviso>}
      {cargando && <p className="text-sm text-slate-500">Cargando…</p>}

      {!cargando && (
        <>
          <TablaCatalogo
            columnas={columnas}
            filas={articulos}
            onFila={setEditando}
            miniatura={(a) => <MiniaturaArticulo path={a.foto_miniatura_path} alt={a.descripcion} />}
            onEliminar={async (a) => {
              await eliminarArticulo(a.id)
              recargar()
            }}
            etiquetaFila={(a) => `${a.codigo_defontana} — ${a.descripcion}`}
            vacio={
              texto || tipo !== 'TODOS'
                ? 'Ningún artículo coincide con la búsqueda.'
                : 'Todavía no hay artículos. Crea el primero o importa una planilla.'
            }
          />
          <p className="text-xs text-slate-500">
            {articulos.length} artículo{articulos.length === 1 ? '' : 's'}
            {articulos.length === 300 && ' (se muestran los primeros 300; afina la búsqueda)'}
          </p>
        </>
      )}

      {editando && (
        <FormularioArticulo
          articulo={editando === 'nuevo' ? null : editando}
          rolBodega={rolBodega}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null)
            recargar()
          }}
        />
      )}

      {importando && (
        <Suspense fallback={<p className="text-sm text-slate-500">Cargando el lector de Excel…</p>}>
          <ImportarArticulos
            onCerrar={() => setImportando(false)}
            onImportado={() => {
              setImportando(false)
              recargar()
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
