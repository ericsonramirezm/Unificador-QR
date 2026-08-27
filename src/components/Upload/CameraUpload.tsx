import { useRef, useState } from 'react'
import { usePDFGenerator, generatePDFFilename } from '@hooks/usePDFGenerator'
import { db, storage } from '@lib/supabase'
import { formatearCargo } from '@lib/formato'
import { generarMiniaturaPDF } from '@lib/renderizarPDF'
import { Documento, DocumentType, Priority } from '@/types/index'
import { AjustarEsquinasModal } from '@components/Upload/AjustarEsquinasModal'
import { traducirError } from '@lib/errores'
import { comprimirImagen, DOCUMENTO_ESCANEADO } from '@lib/comprimirImagen'

interface CameraUploadProps {
  contratoId: string
  usuarioId: string
  usuarioNombre: string
  usuarioRol?: string
  // Solo el Coordinador puede adjuntar documentos ya existentes (descargados de otra
  // plataforma, incluyendo PDF reales). APR y Supervisor cargan exclusivamente con
  // la cámara del celular.
  permitirSeleccionArchivo?: boolean
  // Cuando es true (Supervisor/APR), cada foto capturada pasa primero por el
  // ajuste de esquinas (recorte + enderezado + mejora de color) antes de
  // entrar al carrusel. El Coordinador no usa esto: sus fotos y PDFs
  // adjuntados entran tal cual.
  permitirEscaneo?: boolean
}

interface ItemCarrusel {
  file: File
  preview: string
  esPDF: boolean
  // Solo para PDF ya existentes: miniatura de la página 1, generada en el navegador,
  // que se sube como "foto" (no hay una foto real que subir en ese caso).
  miniaturaBlob?: Blob
}

export const CameraUpload = ({
  contratoId,
  usuarioId,
  usuarioNombre,
  usuarioRol,
  permitirSeleccionArchivo = false,
  permitirEscaneo = false,
}: CameraUploadProps) => {
  const { generatePDFFromImage, isGenerating } = usePDFGenerator()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  // Carrusel de fotos/PDFs
  const [fotos, setFotos] = useState<ItemCarrusel[]>([])
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  // Progreso real de la subida: antes el botón decía "Subiendo N documentos…"
  // de forma estática, sin indicar cuántos llevaba. Con señal mala eso puede
  // ser un minuto largo sin saber si avanza.
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const [uploadedDocs, setUploadedDocs] = useState<Documento[]>([])

  // Cola de fotos pendientes de pasar por el ajuste de esquinas (permitirEscaneo).
  // Hoy la cámara captura una foto por toque, así que la cola casi siempre
  // queda vacía, pero soporta correctamente varias fotos a la vez.
  const [colaEscaneo, setColaEscaneo] = useState<File[]>([])
  const [archivoEnEscaneo, setArchivoEnEscaneo] = useState<File | null>(null)

  const agregarItem = (item: ItemCarrusel) => {
    setFotos((prev) => {
      const actualizadas = [...prev, item]
      setCurrentPhotoIndex(actualizadas.length - 1)
      return actualizadas
    })
  }

  const handleFilesSelect = async (files: FileList) => {
    const lista = Array.from(files)

    if (permitirEscaneo) {
      // Solo las fotos pasan por el ajuste de esquinas; un PDF (si llegara
      // por este input) se agrega directo, igual que en el flujo normal.
      const imagenes = lista.filter((f) => f.type !== 'application/pdf')
      const pdfs = lista.filter((f) => f.type === 'application/pdf')

      for (const pdf of pdfs) {
        try {
          const { previewDataUrl, miniaturaBlob } = await generarMiniaturaPDF(pdf)
          agregarItem({ file: pdf, preview: previewDataUrl, esPDF: true, miniaturaBlob })
          setUploadError(null)
        } catch {
          setUploadError(`No se pudo generar la vista previa de "${pdf.name}"`)
        }
      }

      if (imagenes.length > 0) {
        setColaEscaneo((prev) => [...prev, ...imagenes.slice(1)])
        setArchivoEnEscaneo(imagenes[0])
      }
      return
    }

    for (const file of lista) {
      if (file.type === 'application/pdf') {
        try {
          const { previewDataUrl, miniaturaBlob } = await generarMiniaturaPDF(file)
          agregarItem({ file, preview: previewDataUrl, esPDF: true, miniaturaBlob })
          setUploadError(null)
        } catch {
          setUploadError(`No se pudo generar la vista previa de "${file.name}"`)
        }
        continue
      }

      await new Promise<void>((resolve) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          const preview = e.target?.result as string
          agregarItem({ file, preview, esPDF: false })
          setUploadError(null)
          resolve()
        }
        reader.onerror = () => {
          setUploadError('Error al leer una de las imágenes seleccionadas')
          resolve()
        }
        reader.readAsDataURL(file)
      })
    }
  }

  const avanzarColaEscaneo = () => {
    setColaEscaneo((prev) => {
      if (prev.length === 0) {
        setArchivoEnEscaneo(null)
        return prev
      }
      const [siguiente, ...resto] = prev
      setArchivoEnEscaneo(siguiente)
      return resto
    })
  }

  const handleAplicarEscaneo = (blob: Blob, nombreOriginal: string) => {
    const file = new File([blob], nombreOriginal, { type: 'image/jpeg' })
    const reader = new FileReader()
    reader.onload = (e) => {
      const preview = e.target?.result as string
      agregarItem({ file, preview, esPDF: false })
      setUploadError(null)
      avanzarColaEscaneo()
    }
    reader.onerror = () => {
      setUploadError('Error al procesar el documento escaneado')
      avanzarColaEscaneo()
    }
    reader.readAsDataURL(blob)
  }

  const handleCancelarEscaneo = () => {
    avanzarColaEscaneo()
  }

  const eliminarFoto = (index: number) => {
    const newFotos = fotos.filter((_, i) => i !== index)
    setFotos(newFotos)
    if (currentPhotoIndex >= newFotos.length && currentPhotoIndex > 0) {
      setCurrentPhotoIndex(currentPhotoIndex - 1)
    }
  }

  const navegar = (direccion: 'prev' | 'next') => {
    if (direccion === 'prev' && currentPhotoIndex > 0) {
      setCurrentPhotoIndex(currentPhotoIndex - 1)
    } else if (direccion === 'next' && currentPhotoIndex < fotos.length - 1) {
      setCurrentPhotoIndex(currentPhotoIndex + 1)
    }
  }

  const handleUpload = async () => {
    if (fotos.length === 0) return

    setIsUploading(true)
    setUploadError(null)
    setUploadSuccess(false)
    setUploadedDocs([])

    try {
      const nuevosDocumentos: Documento[] = []
      const fechaHoy = new Date()
      const fechaLabel = fechaHoy.toLocaleDateString('es-CL', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })

      // Las que fallen quedan acá para reintentarlas sin volver a subir las
      // que ya pasaron. Antes, si la señal se cortaba en la foto 5 de 8, las
      // 1-4 ya estaban comprometidas en la base y en Storage, pero setFotos([])
      // nunca se ejecutaba: el usuario volvía a tocar "Enviar" con las 8 y
      // terminaba con 4 documentos duplicados en el pasillo del coordinador.
      const fallidas: typeof fotos = []
      let ultimoError: unknown = null

      // Procesar cada foto o PDF
      for (let i = 0; i < fotos.length; i++) {
        try {
        const { file, esPDF, miniaturaBlob } = fotos[i]
        const cargo = formatearCargo(usuarioRol)
        const titulo = `${usuarioNombre}${cargo ? ` (${cargo})` : ''} · ${fechaLabel} (${i + 1}/${fotos.length})`

        // 1. El PDF a subir: si ya es un PDF real, se sube tal cual (sin pasar por
        // el generador de foto→PDF); si es una foto, se convierte con encabezado.
        const pdfBlob = esPDF ? file : await generatePDFFromImage(file, usuarioNombre, cargo)

        // 2. Generar nombre de archivo (secuencia atómica del servidor,
        // única entre TODOS los usuarios que carguen ese día para este contrato)
        const secuencia = await db.obtenerSiguienteSecuenciaPDF(contratoId, fechaHoy)
        const pdfFilename = generatePDFFilename(fechaHoy, secuencia)

        // 3. Subir la "foto": la imagen original, o si es un PDF ya existente,
        // la miniatura generada de su primera página.
        const fotoOriginal = esPDF ? miniaturaBlob! : file
        // Se comprime antes de subir: una foto de cámara pesa 3-5 MB y
        // viajaba intacta. Con DOCUMENTO_ESCANEADO baja a ~1,5 MB sin
        // comprometer la legibilidad del texto ni los sellos.
        const fotoBlob = await comprimirImagen(fotoOriginal, DOCUMENTO_ESCANEADO)
        const fotoNombre = esPDF ? `${file.name.replace(/\.pdf$/i, '')}_miniatura.jpg` : file.name
        const fotoPath = `fotos/${contratoId}/${Date.now()}_${i}_${fotoNombre}`
        const fotoResult = await storage.uploadFoto('documentos', fotoPath, fotoBlob)
        const fotoUrl = await storage.getPublicUrl('documentos', fotoResult.path)

        // 4. Subir PDF a Storage
        const pdfPath = `pdfs/${contratoId}/${pdfFilename}`
        const pdfResult = await storage.uploadFoto('documentos', pdfPath, pdfBlob)
        const pdfUrl = await storage.getPublicUrl('documentos', pdfResult.path)

        // 5. Crear registro en BD (sin metadatos manuales: tipo genérico y
        // prioridad media por defecto, editables luego por el Coordinador)
        const documento = await db.crearDocumento({
          contrato_id: contratoId,
          creado_por: usuarioId,
          tipo: DocumentType.REGISTRO_FOTOGRAFICO,
          titulo,
          descripcion: null,
          prioridad: Priority.MEDIA,
          estado: 'pendiente',
          foto_url: fotoUrl,
          pdf_url: pdfUrl,
          fecha_creacion: fechaHoy.toISOString(),
        })

        // 6. Crear entrada en historial
        await db.crearHistorial({
          documento_id: documento.id,
          usuario_id: usuarioId,
          accion: 'creado',
          detalle: `${esPDF ? 'PDF' : 'Foto'} ${i + 1}/${fotos.length} cargado por ${usuarioNombre}`,
        })

        nuevosDocumentos.push(documento)
        setProgreso({ hechas: nuevosDocumentos.length, total: fotos.length })
        } catch (err) {
          ultimoError = err
          fallidas.push(fotos[i])
        }
      }

      setUploadedDocs(nuevosDocumentos)
      setCurrentPhotoIndex(0)

      if (fallidas.length > 0) {
        // Solo quedan las que faltan: reintentar no vuelve a subir las que
        // ya se guardaron, así que no se generan duplicados.
        setFotos(fallidas)
        setUploadError(
          `Se cargaron ${nuevosDocumentos.length} de ${nuevosDocumentos.length + fallidas.length} documentos. ` +
            `${fallidas.length === 1 ? 'Queda 1 pendiente' : `Quedan ${fallidas.length} pendientes`} — ` +
            `${traducirError(ultimoError, 'vuelve a intentarlo cuando tengas mejor señal.')}`
        )
        return
      }

      setUploadSuccess(true)
      setFotos([])

      // Limpiar después de 5 segundos
      setTimeout(() => {
        setUploadSuccess(false)
      }, 5000)
    } catch (err) {
      const msg = traducirError(err, 'Error desconocido')
      setUploadError(msg)
    } finally {
      setIsUploading(false)
      setProgreso(null)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Carrusel de fotos/PDFs */}
      {fotos.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-slate-900">
              Documentos: {fotos.length}
            </h3>
            <span className="text-sm text-slate-500">
              {currentPhotoIndex + 1} / {fotos.length}
            </span>
          </div>

          {/* Preview actual */}
          <div className="bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center h-96 relative">
            {fotos[currentPhotoIndex].esPDF && (
              <span className="absolute top-2 left-2 bg-slate-800 text-white text-xs font-semibold px-2 py-1 rounded">
                📄 PDF
              </span>
            )}
            <img
              src={fotos[currentPhotoIndex].preview}
              alt={`Documento ${currentPhotoIndex + 1}`}
              className="max-h-full max-w-full object-contain"
            />
          </div>

          {/* Controles de carrusel */}
          <div className="flex gap-3 justify-between items-center">
            <button
              type="button"
              onClick={() => navegar('prev')}
              disabled={currentPhotoIndex === 0}
              className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 disabled:bg-slate-300"
            >
              ← Anterior
            </button>

            {/* Miniatura */}
            <div className="flex gap-2 overflow-x-auto flex-1 px-2">
              {fotos.map((foto, idx) => (
                <button
                  key={idx}
                  type="button"
                  aria-label={`Ver documento ${idx + 1} de ${fotos.length}`}
                  aria-current={idx === currentPhotoIndex}
                  className={`flex-shrink-0 w-16 h-16 rounded-lg cursor-pointer overflow-hidden border-2 transition-all relative ${
                    idx === currentPhotoIndex
                      ? 'border-blue-600 ring-2 ring-blue-400'
                      : 'border-slate-300 hover:border-slate-400'
                  }`}
                  onClick={() => setCurrentPhotoIndex(idx)}
                >
                  {foto.esPDF && (
                    <span className="absolute top-0 right-0 bg-slate-800 text-white text-[9px] font-bold px-1">
                      PDF
                    </span>
                  )}
                  <img
                    src={foto.preview}
                    alt={`Miniatura ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => navegar('next')}
              disabled={currentPhotoIndex === fotos.length - 1}
              className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 disabled:bg-slate-300"
            >
              Siguiente →
            </button>
          </div>

          {/* Botón eliminar foto actual */}
          <button
            type="button"
            onClick={() => {
              // Una foto recién capturada no está subida a ninguna parte: si
              // se borra por error hay que volver a caminar al punto. El
              // resto de acciones destructivas de la app sí confirman; esta
              // era la única que no lo hacía.
              const ok = window.confirm(
                '¿Eliminar este documento del carrusel? La foto no está guardada en ninguna parte todavía.'
              )
              if (ok) eliminarFoto(currentPhotoIndex)
            }}
            className="w-full text-sm text-red-600 hover:text-red-700 font-semibold py-3 border border-red-300 rounded-lg hover:bg-red-50"
          >
            🗑️ Eliminar este documento
          </button>
        </div>
      )}

      {/* Botones de captura */}
      <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-3">
        <p className="text-sm text-slate-600 font-semibold">
          {fotos.length === 0
            ? permitirSeleccionArchivo
              ? 'Captura fotos con la cámara (de a una) o elige fotos/PDF desde tu equipo'
              : 'Captura fotos con la cámara. Sigue tocando el botón hasta tener todas las que necesitas.'
            : 'Sigue agregando documentos o continúa con estos'}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex-1 bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700"
          >
            📷 Capturar foto
          </button>
          {permitirSeleccionArchivo && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 bg-slate-600 text-white font-semibold py-3 rounded-lg hover:bg-slate-700"
            >
              📁 Seleccionar archivo
            </button>
          )}
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) handleFilesSelect(e.target.files)
            e.target.value = ''
          }}
          className="hidden"
        />
        {permitirSeleccionArchivo && (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) handleFilesSelect(e.target.files)
              e.target.value = ''
            }}
            className="hidden"
          />
        )}
      </div>

      {/* Enviar al pasillo de revisión (solo si hay documentos) */}
      {fotos.length > 0 && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={handleUpload}
            disabled={isUploading || isGenerating}
            className="w-full bg-green-600 text-white font-semibold py-3 rounded-lg hover:bg-green-700 disabled:bg-slate-400 disabled:cursor-not-allowed"
          >
            {isUploading || isGenerating
              ? progreso
                ? `Subiendo… ${progreso.hechas} de ${progreso.total} listos`
                : `Preparando ${fotos.length} documento${fotos.length > 1 ? 's' : ''}…`
              : `✓ Enviar ${fotos.length} documento${fotos.length > 1 ? 's' : ''} al pasillo de revisión`}
          </button>

          {uploadError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
              {uploadError}
            </div>
          )}
        </div>
      )}

      {/* Éxito y lista de documentos */}
      {uploadSuccess && uploadedDocs.length > 0 && (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-700 text-sm font-semibold">
            ✓ {uploadedDocs.length} documento{uploadedDocs.length > 1 ? 's' : ''} subido{uploadedDocs.length > 1 ? 's' : ''} exitosamente
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <h3 className="font-bold text-slate-900 mb-4">Documentos cargados:</h3>
            <div className="space-y-2">
              {uploadedDocs.map((doc) => (
                <div key={doc.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                  <span className="text-green-600 text-lg">✓</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{doc.titulo}</p>
                    <p className="text-xs text-slate-500">{new Date(doc.fecha_creacion).toLocaleString('es-ES')}</p>
                  </div>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">Pendiente</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {permitirEscaneo && (
        <AjustarEsquinasModal
          open={archivoEnEscaneo !== null}
          imagenFile={archivoEnEscaneo}
          restantes={colaEscaneo.length}
          onAplicar={handleAplicarEscaneo}
          onCancelar={handleCancelarEscaneo}
        />
      )}
    </div>
  )
}
