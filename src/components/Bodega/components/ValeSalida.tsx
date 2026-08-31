import { useEffect } from 'react'
import { Boton } from './Campo'
import type { LineaCapturada } from './CapturaLineaMovimiento'

export interface DatosVale {
  folio: number
  fecha: string
  bodega: string
  sala: string
  retiradoPor: string
  observacion?: string | null
  lineas: LineaCapturada[]
}

/**
 * Vale de salida imprimible.
 *
 * Se imprime con el navegador, no generando un PDF: el texto sale vectorial y
 * nítido, y se reutiliza el mismo marcado que ya se ve en pantalla en vez de
 * mantener una segunda representación del documento.
 *
 * La clase `imprimiendo` en el `<body>` es la que hace que `@media print` de
 * `index.css` oculte todo lo demás por visibilidad — ocultar por `display`
 * dejaría el hueco en blanco del layout desaparecido.
 */
export function ValeSalida({ datos, onCerrar }: { datos: DatosVale; onCerrar: () => void }) {
  useEffect(() => {
    const quitar = () => document.body.classList.remove('imprimiendo')
    window.addEventListener('afterprint', quitar)
    return () => {
      window.removeEventListener('afterprint', quitar)
      quitar()
    }
  }, [])

  function imprimir() {
    document.body.classList.add('imprimiendo')
    window.print()
  }

  const total = datos.lineas.reduce((s, l) => s + l.cantidad, 0)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="no-imprimir mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-emerald-800">
          Salida registrada como movimiento N° {datos.folio}.
        </p>
        <div className="flex gap-2">
          <Boton variante="secundario" onClick={onCerrar}>
            Cerrar
          </Boton>
          <Boton onClick={imprimir}>Imprimir vale</Boton>
        </div>
      </div>

      <div className="area-impresion border-t border-slate-200 pt-4 text-sm text-slate-800">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Vale de salida de bodega</h2>
            <p className="text-slate-600">Artículos de Seguridad WILUG Ltda</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-lg font-semibold">N° {datos.folio}</p>
            <p className="text-slate-600">{datos.fecha}</p>
          </div>
        </div>

        <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1">
          <Fila etiqueta="Bodega" valor={datos.bodega} />
          <Fila etiqueta="Destino" valor={datos.sala} />
          <Fila etiqueta="Retira" valor={datos.retiradoPor} />
          {datos.observacion && <Fila etiqueta="Observación" valor={datos.observacion} />}
        </dl>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-slate-400 text-left">
              <th className="py-1.5 pr-2 font-semibold">Código</th>
              <th className="py-1.5 pr-2 font-semibold">Descripción</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Cantidad</th>
              <th className="py-1.5 font-semibold">Series</th>
            </tr>
          </thead>
          <tbody>
            {datos.lineas.map((l) => (
              <tr key={l.clave} className="border-b border-slate-200 align-top">
                <td className="py-1.5 pr-2 font-mono text-xs">{l.articulo.codigo_defontana}</td>
                <td className="py-1.5 pr-2">{l.articulo.descripcion}</td>
                <td className="py-1.5 pr-2 text-right">
                  {l.cantidad} {l.articulo.unidad}
                </td>
                <td className="py-1.5 font-mono text-xs">{l.series.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-400 font-medium">
              <td className="py-1.5" colSpan={2}>
                {datos.lineas.length} línea(s)
              </td>
              <td className="py-1.5 text-right">{total}</td>
              <td />
            </tr>
          </tfoot>
        </table>

        <div className="mt-12 grid grid-cols-2 gap-12">
          <Firma rotulo="Entrega (bodega)" />
          <Firma rotulo={`Retira — ${datos.retiradoPor}`} />
        </div>
      </div>
    </div>
  )
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-slate-500">{etiqueta}:</dt>
      <dd className="font-medium">{valor}</dd>
    </div>
  )
}

function Firma({ rotulo }: { rotulo: string }) {
  return (
    <div>
      <div className="border-b border-slate-400 pb-10" />
      <p className="pt-1 text-xs text-slate-600">{rotulo}</p>
    </div>
  )
}
