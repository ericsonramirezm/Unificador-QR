import * as Dialog from '@radix-ui/react-dialog'
import {
  CARGOS_DIRECTOS,
  CARGOS_INDIRECTOS,
  EQUIPOS_MAQUINARIA,
  FAENA_LABELS,
  HH_TURNO_POR_FAENA,
  ParteDiario,
} from '@/types/index'
import { descargarBlob, generarExcelParteDiario, nombreArchivoParteDiario } from '@lib/generarExcelParteDiario'
import { useState } from 'react'

interface DailyReportExcelPreviewProps {
  parte: ParteDiario
  contrato?: any
  onCerrar: () => void
}

const sumarHoras = (horas: (number | null | undefined)[] | undefined) =>
  (horas ?? []).reduce((acc: number, h) => acc + (h ?? 0), 0)

const COLUMNAS_ACT = ['Act.1', 'Act.2', 'Act.3', 'Act.4', 'Act.5', 'Act.6', 'Act.7']

// Vista "tipo Excel" del Daily Report recién guardado: reproduce, en HTML,
// la misma estructura fila-por-fila que genera generarExcelParteDiario.ts
// (mismo orden fijo de CARGOS_DIRECTOS/CARGOS_INDIRECTOS/EQUIPOS_MAQUINARIA,
// mismas columnas Act.1..Act.7, mismos totales/acumulados) — pensada para
// que el usuario pueda revisar el Daily Report tal como va a verse en el
// Excel real, sin tener que descargarlo. El texto de encabezado que la
// plantilla trae fijo (Contratista, Cliente, Gerencia, Superintendencia,
// Calendario de Trabajo) no viene de ningún campo de la app — ver
// generarExcelParteDiario.ts, esas celdas nunca se escriben desde código —
// así que acá se reproduce el mismo texto estático tal cual está en la
// plantilla, para que la vista previa calce con el archivo real.
export const DailyReportExcelPreview = ({ parte, contrato, onCerrar }: DailyReportExcelPreviewProps) => {
  const [isGenerando, setIsGenerando] = useState(false)
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null)

  const hhTurno = HH_TURNO_POR_FAENA[parte.faena]

  const totalHhDirectas = parte.mano_obra_directa.reduce((acc, f) => acc + sumarHoras(f.horas_por_actividad), 0)
  const totalHm = parte.maquinaria.reduce((acc, f) => acc + sumarHoras(f.horas_por_actividad), 0)
  const totalHhIndirectas = parte.mano_obra_indirecta.reduce((acc, f) => acc + hhTurno * (f.operativos || 0), 0)

  // Mismo cálculo que la sección "Acumulados de turno: Anterior + Actual"
  // de generarExcelParteDiario.ts — "Actual" es directamente el
  // acumulado guardado en el reporte (ya incluye el turno de hoy).
  const anteriorDirectas = (parte.hh_directas_acumuladas ?? 0) - totalHhDirectas
  const anteriorHm = (parte.hm_acumuladas ?? 0) - totalHm
  const anteriorIndirectas = (parte.hh_indirectas_acumuladas ?? 0) - totalHhIndirectas

  const descargarExcel = async () => {
    setIsGenerando(true)
    setErrorDescarga(null)
    try {
      const blob = await generarExcelParteDiario(parte)
      descargarBlob(blob, nombreArchivoParteDiario(parte))
    } catch (err) {
      setErrorDescarga(err instanceof Error ? err.message : 'No se pudo generar el Excel')
    } finally {
      setIsGenerando(false)
    }
  }

  // Estilos compartidos para que las tablas se vean "tipo planilla": bordes
  // finos en todas las celdas, encabezados con fondo gris, números
  // alineados a la derecha — igual que el Excel real.
  const celda = 'border border-slate-300 px-2 py-1 whitespace-nowrap'
  const celdaTexto = celda + ' text-left'
  const celdaNum = celda + ' text-right tabular-nums'
  const th = celda + ' bg-slate-100 font-semibold text-slate-700 text-center'
  const thTotal = celda + ' bg-slate-200 font-semibold text-right'

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[96vw] max-w-5xl max-h-[92vh] overflow-hidden bg-white rounded-lg shadow-xl z-50 flex flex-col">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
            <Dialog.Title className="text-base font-bold text-slate-900">
              Daily Report N° {String(parte.numero_reporte).padStart(3, '0')} — vista previa
            </Dialog.Title>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={descargarExcel}
                disabled={isGenerando}
                className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
              >
                {isGenerando ? 'Generando…' : '⬇ Descargar Excel'}
              </button>
              <button
                type="button"
                onClick={onCerrar}
                className="text-slate-400 hover:text-slate-700 text-2xl leading-none px-1"
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>
          </div>

          {errorDescarga && (
            <div className="mx-5 mt-3 bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-700 shrink-0">
              {errorDescarga}
            </div>
          )}

          <div className="overflow-auto p-5 text-xs">
            {/* ---------- Encabezado ---------- */}
            <div className="text-center font-bold text-lg mb-3">DAILY REPORT</div>
            <table className="border-collapse mb-4 w-full max-w-3xl">
              <tbody>
                <tr>
                  <td className={celdaTexto + ' bg-slate-50 font-semibold w-40'}>Report N°</td>
                  <td className={celdaNum + ' w-24'}>{String(parte.numero_reporte).padStart(3, '0')}</td>
                  <td className={celdaTexto + ' bg-slate-50 font-semibold w-24'}>Fecha :</td>
                  <td className={celdaNum}>{parte.fecha}</td>
                </tr>
                <tr>
                  <td className={celdaTexto + ' bg-slate-50 font-semibold'}>Contratista:</td>
                  <td className={celdaTexto}>Wilug</td>
                  <td className={celdaTexto + ' bg-slate-50 font-semibold'}>Cliente :</td>
                  <td className={celdaTexto}>ANGLO AMERICAN LB</td>
                </tr>
                <tr>
                  <td className={celdaTexto + ' bg-slate-50 font-semibold'}>Contrato:</td>
                  <td className={celdaTexto} colSpan={1}>
                    {contrato?.nombre ?? 'Upgrade SPCI 17 Salas Eléctricas Los Bronces - Las Tórtolas'}
                  </td>
                  <td className={celdaTexto + ' bg-slate-50 font-semibold'}>Gerencia :</td>
                  <td className={celdaTexto}>Infraestructura y Servicio</td>
                </tr>
                <tr>
                  <td className={celdaTexto + ' bg-slate-50 font-semibold'}>Contrato N°</td>
                  <td className={celdaNum}>{contrato?.codigo ?? '12501191'}</td>
                  <td className={celdaTexto + ' bg-slate-50 font-semibold'}>Superintendencia:</td>
                  <td className={celdaTexto}>Servicio a la Operacion</td>
                </tr>
                <tr>
                  <td className={celdaTexto + ' bg-slate-50 font-semibold'}>Calendario de Trabajo</td>
                  <td className={celdaTexto}>8x6</td>
                  <td className={celdaTexto + ' bg-slate-50 font-semibold'}>HH por Día :</td>
                  <td className={celdaNum}>{hhTurno}</td>
                </tr>
                <tr>
                  <td className={celdaTexto + ' bg-slate-50 font-semibold'} />
                  <td className={celdaTexto} />
                  <td className={celdaTexto + ' bg-slate-50 font-semibold'}>Condición Climática :</td>
                  <td className={celdaTexto}>{parte.condicion_climatica || '—'}</td>
                </tr>
                <tr>
                  <td className={celdaTexto + ' bg-slate-50 font-semibold'}>Faena :</td>
                  <td className={celdaTexto} colSpan={3}>
                    {FAENA_LABELS[parte.faena]}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* ---------- Actividades ejecutadas ---------- */}
            <div className="font-bold bg-slate-800 text-white px-2 py-1 mb-0">ACTIVIDADES EJECUTADAS</div>
            <table className="border-collapse mb-4 w-full">
              <thead>
                <tr>
                  <th className={th}>Área</th>
                  <th className={th}>Descripción</th>
                  <th className={th}>Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 7 }, (_, i) => parte.actividades[i]).map((a, i) => (
                  <tr key={i}>
                    <td className={celdaTexto}>{a?.area ?? ''}</td>
                    <td className={celdaTexto}>{a?.descripcion ?? ''}</td>
                    <td className={celdaNum}>{a?.cantidad ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* ---------- Fuerza laboral directa ---------- */}
            <div className="font-bold bg-slate-800 text-white px-2 py-1 mb-0">FUERZA LABORAL DIRECTA</div>
            <div className="overflow-x-auto">
              <table className="border-collapse mb-4 w-full">
                <thead>
                  <tr>
                    <th className={th} rowSpan={2}>
                      Cargos
                    </th>
                    <th className={th} colSpan={4}>
                      Total
                    </th>
                    <th className={th} colSpan={7}>
                      HH Gastadas
                    </th>
                  </tr>
                  <tr>
                    <th className={th}>N° Contratados</th>
                    <th className={th}>Operativos en Obra</th>
                    <th className={th}>Permiso-Descanso</th>
                    <th className={th}>HH Total x Act.</th>
                    {COLUMNAS_ACT.map((c) => (
                      <th key={c} className={th}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CARGOS_DIRECTOS.map((cargo, i) => {
                    const f = parte.mano_obra_directa[i]
                    const horas = f?.horas_por_actividad ?? []
                    return (
                      <tr key={cargo}>
                        <td className={celdaTexto}>{cargo}</td>
                        <td className={celdaNum}>{f?.contratados || 0}</td>
                        <td className={celdaNum}>{f?.operativos || 0}</td>
                        <td className={celdaNum}>{(f?.contratados || 0) - (f?.operativos || 0)}</td>
                        <td className={celdaNum}>{sumarHoras(horas)}</td>
                        {COLUMNAS_ACT.map((_, actIdx) => (
                          <td key={actIdx} className={celdaNum}>
                            {horas[actIdx] || ''}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                  <tr>
                    <td className={thTotal}>Total</td>
                    <td className={thTotal}>{parte.mano_obra_directa.reduce((a, f) => a + (f.contratados || 0), 0)}</td>
                    <td className={thTotal}>{parte.mano_obra_directa.reduce((a, f) => a + (f.operativos || 0), 0)}</td>
                    <td className={thTotal}>
                      {parte.mano_obra_directa.reduce((a, f) => a + (f.contratados || 0) - (f.operativos || 0), 0)}
                    </td>
                    <td className={thTotal}>{totalHhDirectas}</td>
                    {COLUMNAS_ACT.map((_, actIdx) => (
                      <td key={actIdx} className={thTotal}>
                        {parte.mano_obra_directa.reduce((a, f) => a + (f.horas_por_actividad?.[actIdx] || 0), 0) || ''}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ---------- Jornada ---------- */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 max-w-2xl">
              <table className="border-collapse w-full">
                <thead>
                  <tr>
                    <th className={th}>Inicio jornada</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={celdaNum}>{parte.jornada?.inicio ?? '—'}</td>
                  </tr>
                </tbody>
              </table>
              <table className="border-collapse w-full">
                <thead>
                  <tr>
                    <th className={th}>Fin jornada</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={celdaNum}>{parte.jornada?.fin ?? '—'}</td>
                  </tr>
                </tbody>
              </table>
              <table className="border-collapse w-full">
                <thead>
                  <tr>
                    <th className={th} colSpan={2}>
                      Horas efectivas de trabajo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={celdaTexto}>Entrada</td>
                    <td className={celdaNum}>{parte.jornada?.horas_efectivas.entrada ?? '—'}</td>
                  </tr>
                  <tr>
                    <td className={celdaTexto}>Salida</td>
                    <td className={celdaNum}>{parte.jornada?.horas_efectivas.salida ?? '—'}</td>
                  </tr>
                </tbody>
              </table>
              <table className="border-collapse w-full">
                <thead>
                  <tr>
                    <th className={th} colSpan={2}>
                      Horas perdidas de trabajo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={celdaTexto}>Entrada</td>
                    <td className={celdaNum}>{parte.jornada?.horas_perdidas.entrada ?? '—'}</td>
                  </tr>
                  <tr>
                    <td className={celdaTexto}>Salida</td>
                    <td className={celdaNum}>{parte.jornada?.horas_perdidas.salida ?? '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ---------- Maquinaria ---------- */}
            <div className="font-bold bg-slate-800 text-white px-2 py-1 mb-0">MAQUINARIA</div>
            <div className="overflow-x-auto">
              <table className="border-collapse mb-4 w-full">
                <thead>
                  <tr>
                    <th className={th} rowSpan={2}>
                      Equipos
                    </th>
                    <th className={th} colSpan={5}>
                      Total
                    </th>
                    <th className={th} colSpan={7}>
                      HM Gastadas
                    </th>
                  </tr>
                  <tr>
                    <th className={th}>N° Equipos</th>
                    <th className={th}>Mantención / Panne</th>
                    <th className={th}>Stand-by</th>
                    <th className={th}>Operativos</th>
                    <th className={th}>HM Totales</th>
                    {COLUMNAS_ACT.map((c) => (
                      <th key={c} className={th}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {EQUIPOS_MAQUINARIA.map((equipo, i) => {
                    const f = parte.maquinaria[i]
                    const horas = f?.horas_por_actividad ?? []
                    const operativos = (f?.cantidad || 0) - (f?.mantencion || 0) - (f?.standby || 0)
                    return (
                      <tr key={equipo}>
                        <td className={celdaTexto}>{equipo}</td>
                        <td className={celdaNum}>{f?.cantidad || 0}</td>
                        <td className={celdaNum}>{f?.mantencion || 0}</td>
                        <td className={celdaNum}>{f?.standby || 0}</td>
                        <td className={celdaNum}>{operativos}</td>
                        <td className={celdaNum}>{sumarHoras(horas)}</td>
                        {COLUMNAS_ACT.map((_, actIdx) => (
                          <td key={actIdx} className={celdaNum}>
                            {horas[actIdx] || ''}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                  <tr>
                    <td className={thTotal}>Total</td>
                    <td className={thTotal}>{parte.maquinaria.reduce((a, f) => a + (f.cantidad || 0), 0)}</td>
                    <td className={thTotal}>{parte.maquinaria.reduce((a, f) => a + (f.mantencion || 0), 0)}</td>
                    <td className={thTotal}>{parte.maquinaria.reduce((a, f) => a + (f.standby || 0), 0)}</td>
                    <td className={thTotal}>
                      {parte.maquinaria.reduce((a, f) => a + (f.cantidad || 0) - (f.mantencion || 0) - (f.standby || 0), 0)}
                    </td>
                    <td className={thTotal}>{totalHm}</td>
                    {COLUMNAS_ACT.map((_, actIdx) => (
                      <td key={actIdx} className={thTotal}>
                        {parte.maquinaria.reduce((a, f) => a + (f.horas_por_actividad?.[actIdx] || 0), 0) || ''}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ---------- Fuerza laboral indirecta + Resumen ---------- */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 mb-4">
              <div>
                <div className="font-bold bg-slate-800 text-white px-2 py-1 mb-0">FUERZA LABORAL INDIRECTA</div>
                <div className="overflow-x-auto">
                  <table className="border-collapse w-full">
                    <thead>
                      <tr>
                        <th className={th} rowSpan={2}>
                          Cargos
                        </th>
                        <th className={th} colSpan={4}>
                          Total
                        </th>
                      </tr>
                      <tr>
                        <th className={th}>N° Contratados</th>
                        <th className={th}>Operativos en Obra</th>
                        <th className={th}>Permiso-Descanso</th>
                        <th className={th}>HH Total x Act.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CARGOS_INDIRECTOS.map((cargo, i) => {
                        const f = parte.mano_obra_indirecta[i]
                        return (
                          <tr key={cargo}>
                            <td className={celdaTexto}>{cargo}</td>
                            <td className={celdaNum}>{f?.contratados || 0}</td>
                            <td className={celdaNum}>{f?.operativos || 0}</td>
                            <td className={celdaNum}>{(f?.contratados || 0) - (f?.operativos || 0)}</td>
                            <td className={celdaNum}>{hhTurno * (f?.operativos || 0)}</td>
                          </tr>
                        )
                      })}
                      <tr>
                        <td className={thTotal}>Total</td>
                        <td className={thTotal}>
                          {parte.mano_obra_indirecta.reduce((a, f) => a + (f.contratados || 0), 0)}
                        </td>
                        <td className={thTotal}>
                          {parte.mano_obra_indirecta.reduce((a, f) => a + (f.operativos || 0), 0)}
                        </td>
                        <td className={thTotal}>
                          {parte.mano_obra_indirecta.reduce((a, f) => a + (f.contratados || 0) - (f.operativos || 0), 0)}
                        </td>
                        <td className={thTotal}>{totalHhIndirectas}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="font-bold bg-slate-800 text-white px-2 py-1 mb-0 text-center">
                  Resumen HH Programado v/s Real
                </div>
                <table className="border-collapse w-full min-w-[280px]">
                  <thead>
                    <tr>
                      <th className={th}>HH Acumuladas</th>
                      <th className={th}>Progr.</th>
                      <th className={th}>Real</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className={celdaTexto}>HH Directos real vs prog.</td>
                      <td className={celdaNum}>{parte.hh_directas_programado}</td>
                      <td className={celdaNum}>{totalHhDirectas}</td>
                    </tr>
                    <tr>
                      <td className={celdaTexto}>HH Indirectos</td>
                      <td className={celdaNum}>{parte.hh_indirectas_programado}</td>
                      <td className={celdaNum}>{totalHhIndirectas}</td>
                    </tr>
                    <tr>
                      <td className={thTotal}>Total</td>
                      <td className={thTotal}>{parte.hh_directas_programado + parte.hh_indirectas_programado}</td>
                      <td className={thTotal}>{totalHhDirectas + totalHhIndirectas}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* ---------- Totales de turno + acumulados ---------- */}
            <table className="border-collapse mb-4 w-full">
              <tbody>
                <tr>
                  <td className={thTotal}>Total HH Directas Turno</td>
                  <td className={celdaNum}>{totalHhDirectas}</td>
                  <td className={thTotal}>Total HM Turno</td>
                  <td className={celdaNum}>{totalHm}</td>
                  <td className={thTotal}>Total HH Indirectas Turno</td>
                  <td className={celdaNum}>{totalHhIndirectas}</td>
                </tr>
                <tr>
                  <td className={thTotal}>Total HH Directas Acum. Anterior</td>
                  <td className={celdaNum}>{anteriorDirectas}</td>
                  <td className={thTotal}>Total HM Acum. Anterior</td>
                  <td className={celdaNum}>{anteriorHm}</td>
                  <td className={thTotal}>Total HH Indirectas Acum. Anterior</td>
                  <td className={celdaNum}>{anteriorIndirectas}</td>
                </tr>
                <tr>
                  <td className={thTotal}>Total HH Directas Acum. Actual</td>
                  <td className={celdaNum}>{parte.hh_directas_acumuladas ?? 0}</td>
                  <td className={thTotal}>Total HM Acum. Actual</td>
                  <td className={celdaNum}>{parte.hm_acumuladas ?? 0}</td>
                  <td className={thTotal}>Total HH Indirectas Acum. Actual</td>
                  <td className={celdaNum}>{parte.hh_indirectas_acumuladas ?? 0}</td>
                </tr>
              </tbody>
            </table>

            {/* ---------- Comentarios ---------- */}
            <table className="border-collapse mb-4 w-full">
              <tbody>
                <tr>
                  <td className={celdaTexto + ' bg-slate-50 font-semibold w-32'}>Autor Comentarios</td>
                  <td className={celdaTexto} colSpan={3}>
                    {parte.comentario_contratista_autor || '—'}
                  </td>
                </tr>
                <tr>
                  <td className={th}>Comentarios del contratista al Daily Report:</td>
                  <td className={celdaTexto} colSpan={3}>
                    {parte.comentario_contratista || '—'}
                  </td>
                </tr>
                <tr>
                  <td className={celdaTexto + ' bg-slate-50 font-semibold'}>Autor Comentarios</td>
                  <td className={celdaTexto} colSpan={3}>
                    {parte.comentario_mandante_autor || '—'}
                  </td>
                </tr>
                <tr>
                  <td className={th}>Comentarios del cliente al Daily Report:</td>
                  <td className={celdaTexto} colSpan={3}>
                    {parte.comentario_mandante || '—'}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* ---------- Fotos ---------- */}
            {parte.fotos?.length > 0 && (
              <div className="mb-4">
                <div className="font-bold bg-slate-800 text-white px-2 py-1 mb-2">IMÁGENES</div>
                <div className="grid grid-cols-3 gap-2 border border-slate-300 p-2">
                  {parte.fotos.map((foto, i) => (
                    <div key={i} className="border border-slate-200 rounded overflow-hidden">
                      <img src={foto.url} alt={foto.caption ?? ''} className="w-full h-32 object-cover" />
                      {foto.caption && <p className="text-[10px] text-slate-500 px-1 py-0.5">{foto.caption}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ---------- Firmas ---------- */}
            <table className="border-collapse w-full">
              <thead>
                <tr>
                  <th className={th}>Coordinador de Terreno</th>
                  <th className={th}>Administrador Contrato</th>
                  <th className={th}>Responsable Mandante</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={celda + ' align-top'}>
                    <p className="text-slate-500">Nombre:</p>
                    <p className="font-semibold">
                      {parte.usuario_creador?.rol === 'coordinador' ? parte.usuario_creador?.nombre : '—'}
                    </p>
                  </td>
                  <td className={celda + ' align-top'}>
                    <p className="text-slate-500">Nombre:</p>
                    <p className="font-semibold">Sara Cofré</p>
                  </td>
                  <td className={celda + ' align-top'}>
                    <p className="text-slate-500">Nombre:</p>
                  </td>
                </tr>
                <tr>
                  <td className={celda + ' align-top h-16'}>
                    <p className="text-slate-500 mb-1">Firma:</p>
                    {parte.usuario_creador?.rol === 'coordinador' && parte.usuario_creador?.firma_url ? (
                      <img src={parte.usuario_creador.firma_url} alt="Firma" className="h-10 object-contain" />
                    ) : (
                      <p className="text-slate-300">—</p>
                    )}
                  </td>
                  <td className={celda + ' align-top h-16'}>
                    <p className="text-slate-500 mb-1">Firma:</p>
                    <img src="/firmas/sara-cofre.png" alt="Firma" className="h-10 object-contain" />
                  </td>
                  <td className={celda + ' align-top h-16'} />
                </tr>
                <tr>
                  <td className={celda}>
                    <p className="text-slate-500">Fecha: {parte.fecha}</p>
                  </td>
                  <td className={celda}>
                    <p className="text-slate-500">Fecha: {parte.fecha}</p>
                  </td>
                  <td className={celda}>
                    <p className="text-slate-500">Fecha:</p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
