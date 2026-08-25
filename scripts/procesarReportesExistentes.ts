// Regenera el Excel de TODOS los Daily Report ya existentes, usando la
// misma función que usa la app (generarExcelParteDiario) — es decir, con
// el formato de fotos ya corregido (proporción sin deformar, márgenes y
// espaciado calibrados). No modifica nada en Supabase: solo lee los datos
// y las fotos ya guardadas, y deja un .xlsx nuevo por cada reporte en una
// carpeta local. Útil para tener de una vez copias corregidas de todo el
// historial (por ejemplo, para archivar o reenviar), aunque técnicamente
// no hace falta: cada reporte se corrige solo la próxima vez que alguien
// lo descargue desde la app, apenas quede desplegado el fix.
//
// Uso:
//   npm run procesar-reportes-existentes
//
// Requiere lo mismo que scripts/restablecer-clave.mjs: un archivo
// .env.admin.local (copia .env.admin.local.example) con
// SUPABASE_SERVICE_ROLE_KEY — la clave "service_role" del proyecto
// (Project Settings > API en Supabase). Esa clave tiene acceso total a la
// base de datos: solo corre este script en tu propio computador.
//
// También requiere VITE_SUPABASE_URL en .env.local (el mismo que ya usa
// la app para desarrollo).

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { generarExcelParteDiario, nombreArchivoParteDiario } from '../src/lib/generarExcelParteDiario'
import type { ParteDiario } from '../src/types/index'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const raiz = path.resolve(__dirname, '..')
const CARPETA_SALIDA = path.join(raiz, 'reportes_regenerados')

function cargarEnv(nombreArchivo: string): Record<string, string> {
  const ruta = path.join(raiz, nombreArchivo)
  let contenido: string
  try {
    contenido = readFileSync(ruta, 'utf-8')
  } catch {
    return {}
  }
  const vars: Record<string, string> = {}
  for (const linea of contenido.split('\n')) {
    const limpia = linea.trim()
    if (!limpia || limpia.startsWith('#')) continue
    const idx = limpia.indexOf('=')
    if (idx === -1) continue
    vars[limpia.slice(0, idx).trim()] = limpia.slice(idx + 1).trim()
  }
  return vars
}

const envApp = cargarEnv('.env.local')
const envAdmin = cargarEnv('.env.admin.local')

const supabaseUrl = envApp.VITE_SUPABASE_URL
const serviceRoleKey = envAdmin.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) {
  console.error('Falta VITE_SUPABASE_URL en .env.local')
  process.exit(1)
}
if (!serviceRoleKey) {
  console.error(
    'Falta SUPABASE_SERVICE_ROLE_KEY en .env.admin.local — copia .env.admin.local.example y pega ahí tu clave "service_role" (Project Settings > API en Supabase).'
  )
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// generarExcelParteDiario() usa fetch() con rutas relativas ("/plantillas/…",
// "/firmas/…") pensadas para correr en el navegador, resueltas contra el
// origen de la app. Acá, fuera del navegador, se interceptan esas dos rutas
// y se leen directamente del disco (misma carpeta public/ del proyecto);
// todo lo demás (las fotos, URLs https de Supabase Storage) sigue yendo
// por red normalmente con el fetch real.
const fetchOriginal = globalThis.fetch
;(globalThis as any).fetch = async (url: string, init?: any) => {
  if (typeof url === 'string' && (url.startsWith('/plantillas/') || url.startsWith('/firmas/'))) {
    const rutaLocal = path.join(raiz, 'public', url)
    try {
      const buffer = readFileSync(rutaLocal)
      return {
        ok: true,
        arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      } as any
    } catch {
      return { ok: false } as any
    }
  }
  return fetchOriginal(url as any, init)
}

async function obtenerTodosLosPartes(): Promise<ParteDiario[]> {
  const { data, error } = await supabase
    .from('partes_diarios')
    .select('*, usuario_creador:creado_por(nombre, email, rol, firma_url)')
    .order('numero_reporte', { ascending: true })

  if (error) throw error
  return (data ?? []) as unknown as ParteDiario[]
}

async function main() {
  console.log('Buscando Daily Report existentes en Supabase…')
  const partes = await obtenerTodosLosPartes()
  console.log(`${partes.length} reporte(s) encontrado(s).\n`)

  if (partes.length === 0) {
    console.log('Nada que procesar.')
    return
  }

  if (!existsSync(CARPETA_SALIDA)) mkdirSync(CARPETA_SALIDA, { recursive: true })

  let exitosos = 0
  const fallidos: { parte: string; motivo: string }[] = []

  for (const [i, parte] of partes.entries()) {
    const etiqueta = `N°${String(parte.numero_reporte).padStart(3, '0')} (${parte.faena}, ${parte.fecha})`
    process.stdout.write(`[${i + 1}/${partes.length}] ${etiqueta}… `)
    try {
      const blob = await generarExcelParteDiario(parte)
      const buffer = Buffer.from(await blob.arrayBuffer())
      const nombreArchivo = nombreArchivoParteDiario(parte)
      writeFileSync(path.join(CARPETA_SALIDA, nombreArchivo), buffer)
      console.log(`OK -> ${nombreArchivo}`)
      exitosos++
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err)
      console.log(`FALLÓ (${motivo})`)
      fallidos.push({ parte: etiqueta, motivo })
    }
  }

  console.log('\n' + '─'.repeat(60))
  console.log(
    `Listo: ${exitosos} de ${partes.length} reporte(s) generado(s) con éxito en "${path.relative(raiz, CARPETA_SALIDA)}/".`
  )
  if (fallidos.length > 0) {
    console.log(`${fallidos.length} reporte(s) fallaron:`)
    for (const f of fallidos) console.log(`  - ${f.parte}: ${f.motivo}`)
  }
}

main().catch((err) => {
  console.error('Error inesperado:', err instanceof Error ? err.message : err)
  process.exit(1)
})
