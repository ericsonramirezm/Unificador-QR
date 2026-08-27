import { useCallback, useState } from 'react'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import jsPDF from 'jspdf'
import { Documento } from '@/types/index'
import { formatearCargo } from '@lib/formato'
import { traducirError } from '@lib/errores'

interface ContextoCompilado {
  fecha: string // YYYY-MM-DD
  contratoCodigo: string
  contratoNombre: string
  mandante?: string
  compiladoPor: string
  compiladoPorCargo?: string
}

function formatearFechaLegible(fecha: string): string {
  const texto = new Date(`${fecha}T00:00:00`).toLocaleDateString('es-CL', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

async function crearCaratulaBytes(ctx: ContextoCompilado, documentos: Documento[]): Promise<ArrayBuffer> {
  const doc = new jsPDF({ unit: 'in', format: 'letter' })
  const marginLeft = 0.75
  let y = 1

  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('Documentación Diaria — Compilado', marginLeft, y)
  y += 0.45

  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(`Fecha: ${formatearFechaLegible(ctx.fecha)}`, marginLeft, y)
  y += 0.25
  if (ctx.mandante) {
    doc.text(`Mandante: ${ctx.mandante}`, marginLeft, y)
    y += 0.25
  }
  doc.text(`Contrato: ${ctx.contratoCodigo} · ${ctx.contratoNombre}`, marginLeft, y)
  y += 0.25
  doc.text(
    `Compilado por: ${ctx.compiladoPor}${ctx.compiladoPorCargo ? ` (${ctx.compiladoPorCargo})` : ''}`,
    marginLeft,
    y
  )
  y += 0.25
  doc.text(`Generado: ${new Date().toLocaleString('es-CL')}`, marginLeft, y)
  y += 0.4

  doc.setFont('helvetica', 'bold')
  doc.text(`Total de documentos: ${documentos.length}`, marginLeft, y)
  y += 0.4

  doc.text('Documentos incluidos', marginLeft, y)
  y += 0.25

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)

  documentos.forEach((d, i) => {
    if (y > 10) {
      doc.addPage()
      y = 0.75
    }
    const nombreCreador = d.usuario_creador?.nombre || '—'
    const cargo = formatearCargo(d.usuario_creador?.rol)
    const nombreConCargo = cargo ? `${nombreCreador} (${cargo})` : nombreCreador
    const fechaCarga = new Date(d.fecha_creacion).toLocaleDateString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    const horaCarga = new Date(d.fecha_creacion).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
    doc.text(`${i + 1}. ${nombreConCargo} · ${fechaCarga} — ${horaCarga}`, marginLeft, y)
    y += 0.2
  })

  return doc.output('arraybuffer')
}

export function useCompilarDia() {
  const [isCompiling, setIsCompiling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const compilar = useCallback(async (ctx: ContextoCompilado, documentos: Documento[]): Promise<Blob> => {
    setIsCompiling(true)
    setError(null)

    try {
      const mergedPdf = await PDFDocument.create()

      // Carátula con el resumen del día
      const caratulaBytes = await crearCaratulaBytes(ctx, documentos)
      const caratulaDoc = await PDFDocument.load(caratulaBytes)
      const caratulaPaginas = await mergedPdf.copyPages(caratulaDoc, caratulaDoc.getPageIndices())
      caratulaPaginas.forEach((p) => mergedPdf.addPage(p))

      // Cada documento aprobado, en orden
      for (const d of documentos) {
        if (!d.pdf_url) continue
        const res = await fetch(d.pdf_url)
        if (!res.ok) throw new Error(`No se pudo descargar el PDF de "${d.titulo}"`)
        const bytes = await res.arrayBuffer()
        const srcDoc = await PDFDocument.load(bytes)
        const paginas = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices())
        paginas.forEach((p) => mergedPdf.addPage(p))
      }

      // Numeración de página en todas las páginas del compilado (incluida la carátula)
      const font = await mergedPdf.embedFont(StandardFonts.Helvetica)
      const paginas = mergedPdf.getPages()
      paginas.forEach((pagina, idx) => {
        const texto = `Página ${idx + 1} de ${paginas.length}`
        const anchoTexto = font.widthOfTextAtSize(texto, 9)
        pagina.drawText(texto, {
          x: pagina.getWidth() - anchoTexto - 36,
          y: 24,
          size: 9,
          font,
        })
      })

      const mergedBytes = await mergedPdf.save()
      return new Blob([mergedBytes as BlobPart], { type: 'application/pdf' })
    } catch (err) {
      const msg = traducirError(err, 'Error al compilar el PDF del día')
      setError(msg)
      throw err instanceof Error ? err : new Error(msg)
    } finally {
      setIsCompiling(false)
    }
  }, [])

  return { compilar, isCompiling, error }
}
