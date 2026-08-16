// Restablece la contraseña de un usuario directamente, sin enviar correo —
// para cuando alguien olvida su clave y el dashboard de Supabase solo ofrece
// opciones que dependen de email (que choca con el límite de envíos si no
// hay SMTP propio configurado).
//
// Uso:
//   npm run reset-password -- correo@ejemplo.cl "ClaveNueva123"
//
// Requiere un archivo .env.admin.local (copia .env.admin.local.example) con
// SUPABASE_SERVICE_ROLE_KEY — la clave "service_role" del proyecto (Project
// Settings > API). Esa clave tiene acceso total a la base de datos: solo
// corre este script en tu propio computador, nunca la subas a git ni la
// pegues en el código de la app.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const raiz = path.resolve(__dirname, '..')

function cargarEnv(nombreArchivo) {
  const ruta = path.join(raiz, nombreArchivo)
  let contenido
  try {
    contenido = readFileSync(ruta, 'utf-8')
  } catch {
    return {}
  }
  const vars = {}
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

const [, , email, nuevaClave] = process.argv

if (!email || !nuevaClave) {
  console.error('Uso: npm run reset-password -- correo@ejemplo.cl "ClaveNueva123"')
  process.exit(1)
}

if (nuevaClave.length < 6) {
  console.error('La contraseña nueva debe tener al menos 6 caracteres.')
  process.exit(1)
}

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

async function buscarUsuarioPorCorreo(correo) {
  let pagina = 1
  const porPagina = 200
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page: pagina, perPage: porPagina })
    if (error) throw error
    const encontrado = data.users.find((u) => u.email?.toLowerCase() === correo.toLowerCase())
    if (encontrado) return encontrado
    if (data.users.length < porPagina) return null
    pagina++
  }
}

try {
  const usuario = await buscarUsuarioPorCorreo(email)
  if (!usuario) {
    console.error(`No se encontró ninguna cuenta con el correo "${email}" en Supabase Auth.`)
    process.exit(1)
  }

  const { error } = await supabase.auth.admin.updateUserById(usuario.id, { password: nuevaClave })
  if (error) throw error

  console.log(`✓ Contraseña actualizada para ${email} (UID ${usuario.id}).`)
} catch (err) {
  console.error('No se pudo restablecer la contraseña:', err instanceof Error ? err.message : err)
  process.exit(1)
}
