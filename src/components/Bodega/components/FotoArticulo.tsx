import { useEffect, useRef, useState } from 'react'
import { Aviso, Boton } from './Campo'
import { quitarFotoArticulo, subirFotoArticulo, urlFoto } from '../lib/servicios/fotos'
import { puedeRegistrar } from '../permisos'
import type { RolBodega } from '@/types/index'
import type { Articulo } from '../tipos'

/**
 * La foto del artículo: mostrarla, tomarla con la cámara o adjuntarla.
 *
 * En pantalla táctil hay **dos botones**. «Tomar foto» lleva `capture`, que en el
 * celular abre la cámara directamente en vez del explorador de archivos — que es
 * lo que hace falta frente al estante. En escritorio `capture` se ignora, así que
 * allí sobra y se muestra solo «Elegir archivo».
 *
 * No usa `getUserMedia` ni una vista de cámara propia: un `input` nativo obtiene
 * el mismo resultado sin pedir permisos, sin pantalla que mantener y funcionando
 * igual en iOS y en Android.
 */

/** El puntero grueso del dedo. Es la señal fiable de que hay cámara a mano. */
const esTactil = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

// -----------------------------------------------------------------------------
// La interfaz, sin saber nada de Supabase
// -----------------------------------------------------------------------------

/**
 * Elegir una imagen y verla. **No sube nada**: entrega el archivo y ya.
 *
 * Va separado porque hay dos momentos distintos. Sobre un artículo que ya existe
 * se sube al instante; al **crear** uno todavía no hay identificador contra el
 * que guardar la foto, así que el archivo tiene que esperar en memoria hasta que
 * el artículo exista. La cámara y la vista previa son las mismas en ambos casos y
 * no deben escribirse dos veces.
 */
export function SelectorImagen({
  url,
  onArchivo,
  onQuitar,
  ocupado,
  tamano = 'grande',
  puedeEditar = true,
}: {
  /** Lo que se muestra ahora: una URL pública, una vista previa local, o nada. */
  url: string | null
  onArchivo: (archivo: File) => void
  onQuitar?: () => void
  ocupado?: boolean
  tamano?: 'grande' | 'compacto'
  puedeEditar?: boolean
}) {
  const camaraRef = useRef<HTMLInputElement>(null)
  const archivoRef = useRef<HTMLInputElement>(null)

  function elegido(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    // Se limpia el input para que volver a elegir el MISMO archivo dispare el
    // evento otra vez; si no, reintentar tras un error no haría nada.
    e.target.value = ''
    if (archivo) onArchivo(archivo)
  }

  const alto = tamano === 'grande' ? 'h-48' : 'h-28'

  return (
    <div className="space-y-2">
      <div
        className={`relative flex ${alto} items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50`}
      >
        {url ? (
          <img src={url} alt="Foto del artículo" className="h-full w-full object-contain" />
        ) : (
          <p className="px-4 text-center text-sm text-slate-400">Sin foto</p>
        )}
        {ocupado && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-slate-600">
            Guardando…
          </div>
        )}
      </div>

      {puedeEditar && (
        <>
          <div className="flex flex-wrap gap-2">
            {esTactil() && (
              <Boton type="button" variante="secundario" disabled={ocupado} onClick={() => camaraRef.current?.click()}>
                Tomar foto
              </Boton>
            )}
            <Boton type="button" variante="secundario" disabled={ocupado} onClick={() => archivoRef.current?.click()}>
              {url ? 'Cambiar' : 'Elegir archivo'}
            </Boton>
            {url && onQuitar && (
              <Boton type="button" variante="plano" disabled={ocupado} onClick={onQuitar}>
                Quitar
              </Boton>
            )}
          </div>

          {/* `capture` es lo único que separa a estos dos. */}
          <input ref={camaraRef} type="file" accept="image/*" capture="environment" onChange={elegido} className="hidden" />
          <input ref={archivoRef} type="file" accept="image/*" onChange={elegido} className="hidden" />
        </>
      )}
    </div>
  )
}

/** Vista previa de un archivo local, liberada al cambiar o al desmontar. */
export function useVistaPrevia(archivo: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!archivo) {
      setUrl(null)
      return
    }
    const nueva = URL.createObjectURL(archivo)
    setUrl(nueva)
    // Sin esto el blob queda retenido en memoria hasta recargar la página.
    return () => URL.revokeObjectURL(nueva)
  }, [archivo])

  return url
}

// -----------------------------------------------------------------------------
// Sobre un artículo que ya existe: sube al instante
// -----------------------------------------------------------------------------

export function FotoArticulo({
  articulo,
  onCambiada,
  tamano = 'grande',
  rolBodega,
}: {
  articulo: Articulo
  onCambiada: (a: Articulo) => void
  tamano?: 'grande' | 'compacto'
  /** Reemplaza al `rol` que antes venía de `useSesion()` — ver `Bodega.tsx`. */
  rolBodega: RolBodega | null
}) {
  const puedeEditar = puedeRegistrar(rolBodega, 'ENTRADA')

  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Se ve de inmediato, sin esperar a la red: si salió movida se nota ya. */
  const [pendiente, setPendiente] = useState<File | null>(null)
  const previa = useVistaPrevia(pendiente)

  async function subir(archivo: File) {
    setError(null)
    setPendiente(archivo)
    setOcupado(true)
    try {
      onCambiada(await subirFotoArticulo(articulo, archivo))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPendiente(null)
      setOcupado(false)
    }
  }

  async function quitar() {
    setError(null)
    setOcupado(true)
    try {
      onCambiada(await quitarFotoArticulo(articulo))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="space-y-2">
      <SelectorImagen
        url={previa ?? urlFoto(articulo.foto_path)}
        onArchivo={subir}
        onQuitar={articulo.foto_path ? quitar : undefined}
        ocupado={ocupado}
        tamano={tamano}
        puedeEditar={puedeEditar}
      />
      {error && <Aviso tono="error">{error}</Aviso>}
    </div>
  )
}

/**
 * La miniatura de las listas. Cuando no hay foto dibuja un recuadro del mismo
 * tamaño con la inicial: un hueco descuadraría la fila y haría saltar la lista al
 * ir cargando.
 */
export function MiniaturaArticulo({ path, alt }: { path: string | null | undefined; alt: string }) {
  const url = urlFoto(path)
  return url ? (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 object-cover"
    />
  ) : (
    <div
      aria-hidden
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs font-medium text-slate-400"
    >
      {alt.trim().charAt(0).toUpperCase() || '—'}
    </div>
  )
}
