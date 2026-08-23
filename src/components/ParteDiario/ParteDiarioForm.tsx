import { useEffect, useState } from 'react'
import { db, storage } from '@lib/supabase'
import {
  ActividadEjecutada,
  CARGOS_DIRECTOS,
  CARGOS_INDIRECTOS,
  EQUIPOS_MAQUINARIA,
  ParteDiario,
  ParteDiarioEstado,
  Usuario,
} from '@/types/index'
import { FotoPendiente, GestorFotos } from './GestorFotos'

interface ParteDiarioFormProps {
  usuario: Usuario
  contrato: any
  // Si viene seteado, el formulario entra en modo edición: hidrata todos
  // los campos desde este Daily Report existente en vez de partir vacío, y
  // guardar() hace un update en lugar de un insert.
  parteExistente?: ParteDiario
  onGuardado: () => void
  onCancelar: () => void
}

const MAX_ACTIVIDADES = 7

const actividadVacia = (): ActividadEjecutada => ({ area: '', descripcion: '', cantidad: null })

// El campo "Cantidad" de Actividades Ejecutadas ahora guarda las HH que
// dura esa actividad en particular (ej: 0,5) — no una cantidad de items.
// Las HH de Fuerza laboral directa por actividad se calculan solas a
// partir de eso: cantidad (HH x actividad) × operativos del cargo (ej:
// actividad 1 dura 0,5 → cada técnico operativo suma 0,5 HH en esa
// columna). Por eso FilaManoObraDirecta ya no guarda "horas" como estado
// propio — se deriva en cada render con calcularHorasCargo() más abajo.
interface FilaManoObraDirecta {
  cargo: string
  contratados: number
  operativos: number
}

interface FilaManoObraIndirecta {
  cargo: string
  contratados: number
  operativos: number
}

interface FilaMaquinaria {
  equipo: string
  cantidad: number
  mantencion: number
  standby: number
  horas: number[]
}

const sumar = (valores: number[]) => valores.reduce((acc, v) => acc + (v || 0), 0)

// Formulario completo de Daily Report — ver MAPEO_CAMPOS.md para el detalle
// celda por celda del Excel que cada sección alimenta. Los cálculos
// (Permiso-Descanso, HH/HM Total x Act., Operativos, totales, acumulados)
// se hacen acá igual que las fórmulas del Excel original, para que el
// usuario vea los mismos números antes de generar el archivo.
export const ParteDiarioForm = ({ usuario, contrato, parteExistente, onGuardado, onCancelar }: ParteDiarioFormProps) => {
  const editando = Boolean(parteExistente)
  // Si el reporte ya fue enviado (o comentado por el mandante), editarlo no
  // puede volver a pisar el estado — solo se corrigen los datos del
  // reporte. Solo en borrador siguen disponibles los dos botones de
  // siempre (guardar como borrador / enviar).
  const estadoBloqueado = Boolean(parteExistente && parteExistente.estado !== ParteDiarioEstado.BORRADOR)

  const [fecha, setFecha] = useState(() => parteExistente?.fecha ?? new Date().toISOString().slice(0, 10))
  const [condicionClimatica, setCondicionClimatica] = useState(() => parteExistente?.condicion_climatica ?? '')
  const [actividades, setActividades] = useState<ActividadEjecutada[]>(() =>
    parteExistente && parteExistente.actividades.length > 0
      ? parteExistente.actividades.map((a) => ({ ...a }))
      : [actividadVacia()]
  )

  const [manoObraDirecta, setManoObraDirecta] = useState<FilaManoObraDirecta[]>(() =>
    CARGOS_DIRECTOS.map((cargo) => {
      const existente = parteExistente?.mano_obra_directa.find((f) => f.cargo === cargo)
      return {
        cargo,
        contratados: existente?.contratados ?? 0,
        operativos: existente?.operativos ?? 0,
      }
    })
  )
  const [manoObraIndirecta, setManoObraIndirecta] = useState<FilaManoObraIndirecta[]>(() =>
    CARGOS_INDIRECTOS.map((cargo) => {
      const existente = parteExistente?.mano_obra_indirecta.find((f) => f.cargo === cargo)
      return {
        cargo,
        contratados: existente?.contratados ?? 0,
        operativos: existente?.operativos ?? 0,
      }
    })
  )
  const [maquinaria, setMaquinaria] = useState<FilaMaquinaria[]>(() =>
    EQUIPOS_MAQUINARIA.map((equipo) => {
      const existente = parteExistente?.maquinaria.find((f) => f.equipo === equipo)
      return {
        equipo,
        cantidad: existente?.cantidad ?? 0,
        mantencion: existente?.mantencion ?? 0,
        standby: existente?.standby ?? 0,
        horas: existente?.horas_por_actividad ? [...existente.horas_por_actividad] : [],
      }
    })
  )

  const [jornada, setJornada] = useState(() => {
    const j = parteExistente?.jornada
    return {
      inicio: j?.inicio ?? '08:00',
      fin: j?.fin ?? '18:00',
      efectivaEntrada: j?.horas_efectivas?.entrada ?? '08:00',
      efectivaSalida: j?.horas_efectivas?.salida ?? '19:00',
      perdidaEntrada: j?.horas_perdidas?.entrada ?? '00:00',
      perdidaSalida: j?.horas_perdidas?.salida ?? '00:00',
    }
  })

  const [hhDirectasProgramado, setHhDirectasProgramado] = useState(() => parteExistente?.hh_directas_programado ?? 0)
  const [hhIndirectasProgramado, setHhIndirectasProgramado] = useState(
    () => parteExistente?.hh_indirectas_programado ?? 0
  )

  const [comentarioContratistaAutor, setComentarioContratistaAutor] = useState(
    () => parteExistente?.comentario_contratista_autor ?? usuario.nombre
  )
  const [comentarioContratista, setComentarioContratista] = useState(
    () => parteExistente?.comentario_contratista ?? ''
  )

  const [fotos, setFotos] = useState<FotoPendiente[]>(() =>
    (parteExistente?.fotos ?? []).map((f) => ({ url: f.url, caption: f.caption ?? '', preview: f.url }))
  )

  const [numeroReporte, setNumeroReporte] = useState<number | null>(() => parteExistente?.numero_reporte ?? null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState<'borrador' | 'enviado' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const numActividades = Math.min(Math.max(actividades.length, 1), MAX_ACTIVIDADES)

  useEffect(() => {
    // En modo edición el N° de reporte ya viene fijo desde parteExistente —
    // no hay que pedir uno nuevo (correría el correlativo innecesariamente).
    if (editando) return
    if (!contrato?.id) return
    setIsLoading(true)
    db.obtenerSiguienteNumeroParte(contrato.id)
      .then(setNumeroReporte)
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo obtener el N° de reporte'))
      .finally(() => setIsLoading(false))
  }, [contrato?.id, editando])

  // ---------- Actividades ----------
  const actualizarActividad = (index: number, campo: keyof ActividadEjecutada, valor: string) => {
    setActividades((prev) =>
      prev.map((act, i) =>
        i === index
          ? { ...act, [campo]: campo === 'cantidad' ? (valor === '' ? null : Number(valor)) : valor }
          : act
      )
    )
  }
  const agregarActividad = () => {
    if (actividades.length >= MAX_ACTIVIDADES) return
    setActividades((prev) => [...prev, actividadVacia()])
  }
  const quitarActividad = (index: number) => setActividades((prev) => prev.filter((_, i) => i !== index))

  // ---------- Mano de obra directa ----------
  const actualizarDirecta = (index: number, campo: 'contratados' | 'operativos', valor: string) => {
    setManoObraDirecta((prev) =>
      prev.map((f, i) => (i === index ? { ...f, [campo]: Number(valor) || 0 } : f))
    )
  }

  // HH de un cargo en cada actividad = HH que dura la actividad (el
  // "Cantidad" de Actividades Ejecutadas) × operativos de ese cargo. Ya no
  // se tipea a mano por celda — se deriva de esos dos valores en cada
  // render, así que si cualquiera de los dos cambia, la tabla se
  // actualiza sola.
  const calcularHorasCargo = (fila: FilaManoObraDirecta): number[] =>
    actividades.slice(0, numActividades).map((act) => (act.cantidad ?? 0) * fila.operativos)

  // ---------- Mano de obra indirecta ----------
  const actualizarIndirecta = (index: number, campo: 'contratados' | 'operativos', valor: string) => {
    setManoObraIndirecta((prev) =>
      prev.map((f, i) => (i === index ? { ...f, [campo]: Number(valor) || 0 } : f))
    )
  }

  // ---------- Maquinaria ----------
  const actualizarMaquinaria = (
    index: number,
    campo: 'cantidad' | 'mantencion' | 'standby',
    valor: string
  ) => {
    setMaquinaria((prev) => prev.map((f, i) => (i === index ? { ...f, [campo]: Number(valor) || 0 } : f)))
  }
  const actualizarHorasMaquinaria = (index: number, actIndex: number, valor: string) => {
    setMaquinaria((prev) =>
      prev.map((f, i) => {
        if (i !== index) return f
        const horas = [...f.horas]
        horas[actIndex] = Number(valor) || 0
        return { ...f, horas }
      })
    )
  }

  // ---------- Totales calculados (mismas fórmulas que el Excel) ----------
  const totalHhDirectas = sumar(manoObraDirecta.map((f) => sumar(calcularHorasCargo(f))))
  const totalHhIndirectas = sumar(manoObraIndirecta.map((f) => 11 * f.operativos))
  const totalHm = sumar(maquinaria.map((f) => sumar(f.horas.slice(0, numActividades))))

  const guardar = async (estadoFinal: ParteDiarioEstado.BORRADOR | ParteDiarioEstado.ENVIADO) => {
    if (!contrato?.id) return
    if (!editando && numeroReporte === null) return
    setIsSaving(estadoFinal)
    setError(null)

    try {
      const actividadesValidas = actividades.filter((a) => a.area.trim() || a.descripcion.trim())

      const camposComunes = {
        fecha,
        condicion_climatica: condicionClimatica || null,

        actividades: actividadesValidas,
        mano_obra_directa: manoObraDirecta.map((f) => ({
          cargo: f.cargo,
          contratados: f.contratados,
          operativos: f.operativos,
          horas_por_actividad: calcularHorasCargo(f),
        })),
        mano_obra_indirecta: manoObraIndirecta.map((f) => ({
          cargo: f.cargo,
          contratados: f.contratados,
          operativos: f.operativos,
        })),
        maquinaria: maquinaria.map((f) => ({
          equipo: f.equipo,
          cantidad: f.cantidad,
          mantencion: f.mantencion,
          standby: f.standby,
          horas_por_actividad: f.horas.slice(0, numActividades),
        })),

        jornada: {
          inicio: jornada.inicio,
          fin: jornada.fin,
          horas_efectivas: { entrada: jornada.efectivaEntrada, salida: jornada.efectivaSalida },
          horas_perdidas: { entrada: jornada.perdidaEntrada, salida: jornada.perdidaSalida },
        },

        hh_directas_programado: hhDirectasProgramado,
        hh_indirectas_programado: hhIndirectasProgramado,

        comentario_contratista_autor: comentarioContratistaAutor || null,
        comentario_contratista: comentarioContratista || null,
      }

      let parte: any

      if (editando && parteExistente) {
        // Al editar NO se tocan las columnas *_acumuladas: recalcularlas
        // implicaría además recalcular en cascada todos los reportes
        // posteriores a este (que heredan el acumulado), lo cual queda
        // fuera de alcance acá. Tampoco se pisa el estado si el reporte ya
        // fue enviado o comentado por el mandante (ver estadoBloqueado).
        const updates: Record<string, unknown> = { ...camposComunes }
        if (!estadoBloqueado) {
          updates.estado = estadoFinal
        }
        parte = await db.actualizarParteDiario(parteExistente.id, updates)
      } else {
        const ultimoParte = await db.obtenerUltimoParteDiario(contrato.id)
        parte = await db.crearParteDiario({
          contrato_id: contrato.id,
          numero_reporte: numeroReporte,
          ...camposComunes,

          hh_directas_acumuladas: (ultimoParte?.hh_directas_acumuladas ?? 0) + totalHhDirectas,
          hm_acumuladas: (ultimoParte?.hm_acumuladas ?? 0) + totalHm,
          hh_indirectas_acumuladas: (ultimoParte?.hh_indirectas_acumuladas ?? 0) + totalHhIndirectas,

          fotos: [],

          estado: estadoFinal,
          creado_por: usuario.id,
        })
      }

      // Fotos: unifica las nuevas (traen "file", hay que subirlas a Storage)
      // con las ya existentes (traen "url", vienen de editar un Daily
      // Report que ya tenía fotos guardadas — se mantienen tal cual, salvo
      // que el usuario haya cambiado el orden, el pie de foto, o las haya
      // quitado). El resultado reemplaza por completo el arreglo "fotos" del
      // parte, así que una foto quitada en el formulario también se quita acá.
      const fotosFinal: { url: string; caption: string }[] = []
      for (let i = 0; i < fotos.length; i++) {
        const foto = fotos[i]
        if (foto.file) {
          const path = `partes-diarios/${contrato.id}/${parte.id}/${Date.now()}-${i}-${foto.file.name}`
          await storage.uploadFoto('documentos', path, foto.file)
          const url = await storage.getPublicUrl('documentos', path)
          fotosFinal.push({ url, caption: foto.caption })
        } else if (foto.url) {
          fotosFinal.push({ url: foto.url, caption: foto.caption })
        }
      }
      // Al crear, solo hace falta este segundo update si hay fotos que
      // subir (el insert ya dejó fotos: []). Al editar, siempre hay que
      // guardar el arreglo final aunque haya quedado vacío, para reflejar
      // fotos que el usuario haya quitado.
      if (editando || fotosFinal.length > 0) {
        await db.actualizarParteDiario(parte.id, { fotos: fotosFinal })
      }

      onGuardado()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el Daily Report')
    } finally {
      setIsSaving(null)
    }
  }

  const inputClase =
    'w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600'
  const inputNumClase = inputClase + ' text-right'

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            {editando ? 'Editar Daily Report' : 'Nuevo Daily Report'}
          </h2>
          <p className="text-sm text-slate-500">
            {contrato?.codigo} · {contrato?.nombre}
          </p>
        </div>
        <span className="text-sm font-mono text-slate-500">
          {isLoading ? 'Report N° …' : `Report N° ${String(numeroReporte).padStart(3, '0')}`}
        </span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Encabezado */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Encabezado</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Fecha</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClase} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Condición climática</label>
            <input
              type="text"
              placeholder="Despejado, nublado, lluvia…"
              value={condicionClimatica}
              onChange={(e) => setCondicionClimatica(e.target.value)}
              className={inputClase}
            />
          </div>
        </div>
      </section>

      {/* Actividades ejecutadas */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
            Actividades ejecutadas
          </h3>
          <button
            type="button"
            onClick={agregarActividad}
            disabled={actividades.length >= MAX_ACTIVIDADES}
            className="text-sm font-semibold text-blue-600 hover:text-blue-700 disabled:text-slate-300"
          >
            + Agregar actividad
          </button>
        </div>
        <div className="space-y-2">
          {actividades.map((actividad, index) => (
            <div key={index} className="grid grid-cols-1 sm:grid-cols-[24px_1fr_2fr_100px_32px] gap-2 items-center">
              <span className="text-xs font-mono text-slate-400 text-center">{index + 1}</span>
              <input
                type="text"
                placeholder="Área"
                value={actividad.area}
                onChange={(e) => actualizarActividad(index, 'area', e.target.value)}
                className={inputClase}
              />
              <input
                type="text"
                placeholder="Descripción"
                value={actividad.descripcion}
                onChange={(e) => actualizarActividad(index, 'descripcion', e.target.value)}
                className={inputClase}
              />
              <input
                type="number"
                step="0.1"
                placeholder="HH x actividad"
                title="Horas que dura esta actividad en particular (ej: 0,5) — se usa para calcular las HH de Fuerza laboral directa."
                value={actividad.cantidad ?? ''}
                onChange={(e) => actualizarActividad(index, 'cantidad', e.target.value)}
                className={inputNumClase}
              />
              <button
                type="button"
                onClick={() => quitarActividad(index)}
                disabled={actividades.length === 1}
                className="text-slate-400 hover:text-red-600 disabled:opacity-30"
                aria-label="Quitar actividad"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Fuerza laboral directa */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-1">
          Fuerza laboral directa
        </h3>
        <p className="text-xs text-slate-400 mb-3">
          Las columnas Act.1..Act.{numActividades} se calculan solas: HH x actividad (campo "Cantidad" de
          Actividades Ejecutadas) × Operativos de cada cargo.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-xs text-slate-500 uppercase">
                <th className="text-left py-1 pr-2">Cargo</th>
                <th className="text-right py-1 px-1 w-24">Contratados</th>
                <th className="text-right py-1 px-1 w-24">Operativos</th>
                <th className="text-right py-1 px-1 w-24">Permiso/Desc.</th>
                {Array.from({ length: numActividades }).map((_, i) => (
                  <th key={i} className="text-right py-1 px-1 w-16">
                    Act.{i + 1}
                  </th>
                ))}
                <th className="text-right py-1 pl-1 w-20">HH Total</th>
              </tr>
            </thead>
            <tbody>
              {manoObraDirecta.map((fila, index) => (
                <tr key={fila.cargo} className="border-t border-slate-100">
                  <td className="py-1 pr-2 text-slate-700">{fila.cargo}</td>
                  <td className="py-1 px-1">
                    <input
                      type="number"
                      value={fila.contratados || ''}
                      onChange={(e) => actualizarDirecta(index, 'contratados', e.target.value)}
                      className={inputNumClase}
                    />
                  </td>
                  <td className="py-1 px-1">
                    <input
                      type="number"
                      value={fila.operativos || ''}
                      onChange={(e) => actualizarDirecta(index, 'operativos', e.target.value)}
                      className={inputNumClase}
                    />
                  </td>
                  <td className="py-1 px-1 text-right text-slate-400 font-mono text-xs">
                    {fila.contratados - fila.operativos}
                  </td>
                  {calcularHorasCargo(fila).map((horas, actIndex) => (
                    <td key={actIndex} className="py-1 px-1 text-right font-mono text-xs text-slate-500">
                      {horas || ''}
                    </td>
                  ))}
                  <td className="py-1 pl-1 text-right font-mono text-xs text-slate-500">
                    {sumar(calcularHorasCargo(fila))}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 font-semibold text-slate-700">
                <td className="py-1 pr-2">Total</td>
                <td className="py-1 px-1 text-right">{sumar(manoObraDirecta.map((f) => f.contratados))}</td>
                <td className="py-1 px-1 text-right">{sumar(manoObraDirecta.map((f) => f.operativos))}</td>
                <td />
                <td colSpan={numActividades} />
                <td className="py-1 pl-1 text-right">{totalHhDirectas}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Jornada */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Jornada</h3>
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Inicio jornada</label>
            <input type="time" value={jornada.inicio} onChange={(e) => setJornada({ ...jornada, inicio: e.target.value })} className={inputClase} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Fin jornada</label>
            <input type="time" value={jornada.fin} onChange={(e) => setJornada({ ...jornada, fin: e.target.value })} className={inputClase} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">H. efectivas — entrada</label>
            <input type="time" value={jornada.efectivaEntrada} onChange={(e) => setJornada({ ...jornada, efectivaEntrada: e.target.value })} className={inputClase} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">H. efectivas — salida</label>
            <input type="time" value={jornada.efectivaSalida} onChange={(e) => setJornada({ ...jornada, efectivaSalida: e.target.value })} className={inputClase} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">H. perdidas — entrada</label>
            <input type="time" value={jornada.perdidaEntrada} onChange={(e) => setJornada({ ...jornada, perdidaEntrada: e.target.value })} className={inputClase} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">H. perdidas — salida</label>
            <input type="time" value={jornada.perdidaSalida} onChange={(e) => setJornada({ ...jornada, perdidaSalida: e.target.value })} className={inputClase} />
          </div>
        </div>
      </section>

      {/* Maquinaria */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Maquinaria</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-xs text-slate-500 uppercase">
                <th className="text-left py-1 pr-2">Equipo</th>
                <th className="text-right py-1 px-1 w-20">N° Equipos</th>
                <th className="text-right py-1 px-1 w-24">Mantención</th>
                <th className="text-right py-1 px-1 w-20">Stand-by</th>
                <th className="text-right py-1 px-1 w-20">Operativos</th>
                {Array.from({ length: numActividades }).map((_, i) => (
                  <th key={i} className="text-right py-1 px-1 w-16">
                    Act.{i + 1}
                  </th>
                ))}
                <th className="text-right py-1 pl-1 w-20">HM Total</th>
              </tr>
            </thead>
            <tbody>
              {maquinaria.map((fila, index) => (
                <tr key={fila.equipo} className="border-t border-slate-100">
                  <td className="py-1 pr-2 text-slate-700">{fila.equipo}</td>
                  <td className="py-1 px-1">
                    <input type="number" value={fila.cantidad || ''} onChange={(e) => actualizarMaquinaria(index, 'cantidad', e.target.value)} className={inputNumClase} />
                  </td>
                  <td className="py-1 px-1">
                    <input type="number" value={fila.mantencion || ''} onChange={(e) => actualizarMaquinaria(index, 'mantencion', e.target.value)} className={inputNumClase} />
                  </td>
                  <td className="py-1 px-1">
                    <input type="number" value={fila.standby || ''} onChange={(e) => actualizarMaquinaria(index, 'standby', e.target.value)} className={inputNumClase} />
                  </td>
                  <td className="py-1 px-1 text-right text-slate-400 font-mono text-xs">
                    {fila.cantidad - fila.mantencion - fila.standby}
                  </td>
                  {Array.from({ length: numActividades }).map((_, actIndex) => (
                    <td key={actIndex} className="py-1 px-1">
                      <input type="number" value={fila.horas[actIndex] || ''} onChange={(e) => actualizarHorasMaquinaria(index, actIndex, e.target.value)} className={inputNumClase} />
                    </td>
                  ))}
                  <td className="py-1 pl-1 text-right font-mono text-xs text-slate-500">
                    {sumar(fila.horas.slice(0, numActividades))}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 font-semibold text-slate-700">
                <td className="py-1 pr-2">Total</td>
                <td className="py-1 px-1 text-right">{sumar(maquinaria.map((f) => f.cantidad))}</td>
                <td colSpan={3} />
                <td colSpan={numActividades} />
                <td className="py-1 pl-1 text-right">{totalHm}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Fuerza laboral indirecta */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
          Fuerza laboral indirecta
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-xs text-slate-500 uppercase">
                <th className="text-left py-1 pr-2">Cargo</th>
                <th className="text-right py-1 px-1 w-24">Contratados</th>
                <th className="text-right py-1 px-1 w-24">Operativos</th>
                <th className="text-right py-1 px-1 w-24">Permiso/Desc.</th>
                <th className="text-right py-1 pl-1 w-24">HH Total (×11)</th>
              </tr>
            </thead>
            <tbody>
              {manoObraIndirecta.map((fila, index) => (
                <tr key={fila.cargo} className="border-t border-slate-100">
                  <td className="py-1 pr-2 text-slate-700">{fila.cargo}</td>
                  <td className="py-1 px-1">
                    <input type="number" value={fila.contratados || ''} onChange={(e) => actualizarIndirecta(index, 'contratados', e.target.value)} className={inputNumClase} />
                  </td>
                  <td className="py-1 px-1">
                    <input type="number" value={fila.operativos || ''} onChange={(e) => actualizarIndirecta(index, 'operativos', e.target.value)} className={inputNumClase} />
                  </td>
                  <td className="py-1 px-1 text-right text-slate-400 font-mono text-xs">
                    {fila.contratados - fila.operativos}
                  </td>
                  <td className="py-1 pl-1 text-right font-mono text-xs text-slate-500">{11 * fila.operativos}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 font-semibold text-slate-700">
                <td className="py-1 pr-2">Total</td>
                <td className="py-1 px-1 text-right">{sumar(manoObraIndirecta.map((f) => f.contratados))}</td>
                <td className="py-1 px-1 text-right">{sumar(manoObraIndirecta.map((f) => f.operativos))}</td>
                <td />
                <td className="py-1 pl-1 text-right">{totalHhIndirectas}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Resumen HH Programado vs Real */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
          Resumen HH Programado vs. Real
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">HH Directas — Programado</label>
            <input type="number" value={hhDirectasProgramado || ''} onChange={(e) => setHhDirectasProgramado(Number(e.target.value) || 0)} className={inputNumClase} />
            <p className="text-xs text-slate-400 mt-1">Real: {totalHhDirectas} (calculado)</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">HH Indirectas — Programado</label>
            <input type="number" value={hhIndirectasProgramado || ''} onChange={(e) => setHhIndirectasProgramado(Number(e.target.value) || 0)} className={inputNumClase} />
            <p className="text-xs text-slate-400 mt-1">Real: {totalHhIndirectas} (calculado)</p>
          </div>
        </div>
      </section>

      {/* Fotos */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Fotos del día</h3>
        <GestorFotos fotos={fotos} onChange={setFotos} />
      </section>

      {/* Comentario del contratista */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
          Comentarios del contratista al Daily Report
        </h3>
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Autor del comentario"
            value={comentarioContratistaAutor}
            onChange={(e) => setComentarioContratistaAutor(e.target.value)}
            className={`${inputClase} max-w-xs`}
          />
          <textarea
            placeholder="Comentario…"
            value={comentarioContratista}
            onChange={(e) => setComentarioContratista(e.target.value)}
            rows={3}
            className={inputClase}
          />
        </div>
        <p className="text-xs text-slate-400 mt-2">
          El comentario del cliente/mandante se agrega después de enviar el reporte, desde su propia sesión.
        </p>
      </section>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
        <button type="button" onClick={onCancelar} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
          Cancelar
        </button>
        {estadoBloqueado ? (
          // El reporte ya fue enviado (o comentado por el mandante): solo
          // se pueden corregir sus datos, no volver a elegir borrador/envío.
          <button
            type="button"
            onClick={() => guardar(ParteDiarioEstado.ENVIADO)}
            disabled={isSaving !== null}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving !== null ? 'Guardando…' : 'Guardar cambios'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => guardar(ParteDiarioEstado.BORRADOR)}
              disabled={isSaving !== null || isLoading || !contrato?.id}
              className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving === 'borrador' ? 'Guardando…' : 'Guardar borrador'}
            </button>
            <button
              type="button"
              onClick={() => guardar(ParteDiarioEstado.ENVIADO)}
              disabled={isSaving !== null || isLoading || !contrato?.id}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving === 'enviado' ? 'Enviando…' : editando ? 'Guardar y enviar' : 'Enviar reporte'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
