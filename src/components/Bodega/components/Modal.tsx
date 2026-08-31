import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'

/**
 * Radix se encarga del foco, el escape y el bloqueo del scroll de fondo — cosas
 * que hechas a mano casi siempre quedan a medias y rompen el teclado en celular.
 */
export function Modal({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  ancho = 'md',
  children,
}: {
  abierto: boolean
  onCerrar: () => void
  titulo: string
  descripcion?: string
  ancho?: 'sm' | 'md' | 'lg'
  children: ReactNode
}) {
  const anchoClase = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' }[ancho]

  return (
    <Dialog.Root open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px]" />
        {/* En celular se ancla abajo y ocupa el ancho completo: es donde llega el
            pulgar y evita que el teclado tape el formulario. En escritorio, centrado. */}
        <Dialog.Content
          className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl bg-white shadow-xl outline-none sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl ${anchoClase}`}
        >
          <div className="border-b border-slate-200 px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-slate-800">{titulo}</Dialog.Title>
            {descripcion && <Dialog.Description className="mt-0.5 text-sm text-slate-500">{descripcion}</Dialog.Description>}
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
