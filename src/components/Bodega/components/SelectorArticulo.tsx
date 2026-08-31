import { useEffect, useRef, useState } from 'react'
import { claseControl } from './Campo'
import { listarArticulos, normalizarCodigo } from '../lib/servicios/catalogos'
import type { Articulo, TipoArticulo } from '../tipos'

/**
 * Buscador de artículos pensado para digitar decenas de líneas sin soltar el
 * teclado: se escribe, se baja con las flechas y se elige con Enter.
 *
 * Reconoce el Código Defontana cuando viene **pegado al principio de la
 * descripción**, que es como aparece en las guías reales del contrato
 * (`226011 POLIN IMPREGNADO`, `3509 MARTILLO CARPINTERO`). Sin esto, teclear la
 * línea tal cual figura en el papel no encontraría nada, porque ninguna
 * descripción del catálogo empieza con ese número.
 */
/**
 * Parte lo tecleado en código y descripción para precargar el alta rápida.
 * `226011 POLIN IMPREGNADO` → código `226011`, descripción `POLIN IMPREGNADO`.
 * Si no empieza con un número, todo va a la descripción.
 */
export function partirCodigoDescripcion(texto: string): { codigo: string; descripcion: string } {
  const m = texto.trim().match(/^(\d{3,})\s+(.*)$/)
  return m ? { codigo: m[1], descripcion: m[2].trim() } : { codigo: '', descripcion: texto.trim() }
}

export function SelectorArticulo({
  onElegir,
  onCrearArticulo,
  tipo,
  autoFocus,
  placeholder = 'Código o descripción…',
}: {
  onElegir: (a: Articulo) => void
  /** Si se pasa, aparece «Crear artículo» cuando la búsqueda no encuentra nada. */
  onCrearArticulo?: (textoTecleado: string) => void
  tipo?: TipoArticulo
  autoFocus?: boolean
  placeholder?: string
}) {
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<Articulo[]>([])
  const [indice, setIndice] = useState(0)
  const [buscando, setBuscando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const consulta = texto.trim()
    if (consulta.length < 2) {
      setResultados([])
      return
    }

    // Un número al principio es el Código Defontana; se busca por él y se ignora
    // el resto de la línea copiada de la guía.
    const prefijo = consulta.match(/^(\d{3,})\b/)
    const aBuscar = prefijo ? prefijo[1] : consulta

    const t = setTimeout(async () => {
      setBuscando(true)
      try {
        const lista = await listarArticulos({ texto: aBuscar, tipo: tipo ?? 'TODOS', limite: 25 })
        // La coincidencia exacta de código va primero: si el bodeguero tecleó el
        // código completo, no debería tener que buscarlo entre los parecidos.
        const exacto = normalizarCodigo(aBuscar)
        lista.sort((a, b) => Number(b.codigo_defontana === exacto) - Number(a.codigo_defontana === exacto))
        setResultados(lista)
        setIndice(0)
      } catch {
        setResultados([])
      } finally {
        setBuscando(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [texto, tipo])

  function elegir(a: Articulo) {
    onElegir(a)
    setTexto('')
    setResultados([])
    setIndice(0)
    inputRef.current?.focus()
  }

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndice((i) => Math.min(i + 1, resultados.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndice((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      // Evita que el Enter de "elegir artículo" envíe el formulario entero.
      e.preventDefault()
      if (resultados[indice]) elegir(resultados[indice])
    } else if (e.key === 'Escape') {
      setTexto('')
      setResultados([])
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={teclas}
        placeholder={placeholder}
        className={`${claseControl} w-full`}
        aria-label="Buscar artículo"
        autoComplete="off"
      />

      {texto.trim().length >= 2 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {buscando && resultados.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-500">Buscando…</li>
          )}
          {!buscando && resultados.length === 0 && (
            <li className="px-3 py-2">
              <p className="text-sm text-slate-500">Ningún artículo coincide con «{texto.trim()}».</p>
              {onCrearArticulo && (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onCrearArticulo(texto.trim())
                  }}
                  className="mt-2 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Crear este artículo ahora
                </button>
              )}
            </li>
          )}
          {resultados.map((a, i) => (
            <li key={a.id}>
              <button
                type="button"
                // `onMouseDown` y no `onClick`: al hacer clic, el blur del input
                // cerraría la lista antes de que el clic llegara a dispararse.
                onMouseDown={(e) => {
                  e.preventDefault()
                  elegir(a)
                }}
                onMouseEnter={() => setIndice(i)}
                className={`flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm ${
                  i === indice ? 'bg-blue-50' : ''
                }`}
              >
                <span className="w-28 shrink-0 font-mono text-xs">{a.codigo_defontana}</span>
                <span className="min-w-0 flex-1 truncate">{a.descripcion}</span>
                <span className="shrink-0 text-xs text-slate-500">{a.unidad}</span>
                {a.controla_serie && (
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">serie</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
