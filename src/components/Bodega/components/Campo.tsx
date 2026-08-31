import type { ReactNode } from 'react'

/**
 * Estilo compartido de los controles de formulario. Se exporta como constante en
 * vez de envolver cada tipo de input en su propio componente: los inputs nativos
 * ya se comportan bien y envolverlos solo agrega API que mantener.
 *
 * Va **sin ancho** a propósito. Añadir `w-auto` después de un `w-full` en el
 * atributo `class` no lo anula: en Tailwind gana la utilidad que quede después en
 * el CSS generado, no en el orden en que se escriben. Un `select` al que se le
 * pretendía dar ancho automático terminaba ocupando la fila entera. Quien
 * necesite ancho completo usa `claseInput`; quien no, `claseControl`.
 */
export const claseControl =
  'rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none transition ' +
  'focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500'

/** Lo habitual dentro de un formulario: ocupa todo el ancho del campo. */
export const claseInput = `w-full ${claseControl}`

export const claseInputError = 'border-red-400 focus:border-red-500 focus:ring-red-100'

export function Campo({
  etiqueta,
  htmlFor,
  error,
  ayuda,
  requerido,
  children,
}: {
  etiqueta: string
  htmlFor?: string
  error?: string | null
  ayuda?: string
  requerido?: boolean
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">
        {etiqueta}
        {requerido && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {ayuda && !error && <p className="mt-1 text-xs text-slate-500">{ayuda}</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

export function Boton({
  variante = 'primario',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: 'primario' | 'secundario' | 'peligro' | 'plano'
}) {
  const estilos = {
    primario: 'bg-blue-600 text-white hover:bg-blue-700',
    secundario: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    peligro: 'bg-red-600 text-white hover:bg-red-700',
    plano: 'text-slate-600 hover:bg-slate-100',
  }[variante]

  return (
    <button
      // `min-h-11` (44 px) es el mínimo cómodo para tocar con el dedo en bodega.
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${estilos} ${className}`}
      {...props}
    />
  )
}

export function Aviso({ tono, children }: { tono: 'error' | 'exito' | 'info'; children: ReactNode }) {
  const estilos = {
    error: 'bg-red-50 text-red-700 ring-red-200',
    exito: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    info: 'bg-blue-50 text-blue-800 ring-blue-200',
  }[tono]
  return (
    <p role={tono === 'error' ? 'alert' : undefined} className={`rounded-lg px-3 py-2 text-sm ring-1 ${estilos}`}>
      {children}
    </p>
  )
}
