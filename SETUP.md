# 🚀 SETUP - Unificador QR

## PASO 1: Completar `.env.local`

Abre el archivo `.env.local` en la raíz del proyecto:

```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Reemplaza:
- `YOUR_PROJECT` → tu project ID de Supabase
- `YOUR_ANON_KEY` → tu Anon Key de Supabase

---

## PASO 2: Instalar dependencias

Abre PowerShell en la carpeta `Unificador-QR` y ejecuta:

```powershell
npm install
```

Esto descargará todas las librerías necesarias (~500MB).

---

## PASO 3: Crear usuario de prueba en Supabase

⚠️ **Importante:** crear un usuario desde "Authentication → Create new user" **NO** crea automáticamente su fila en `public.usuarios`. Ese paso hay que hacerlo siempre a mano (paso 2 más abajo) — si se te olvida, el login falla con un error `PGRST116 / 0 rows` (ya nos pasó una vez). Esto seguirá pasando con cada Supervisor/APR nuevo hasta que construyamos el panel de Admin (Sprint 4) que automatice la creación de usuario + perfil en un solo paso.

Ve a tu proyecto Supabase → **Authentication** → **Users**:

1. Click en **"Create new user"**
2. Email: `admin@example.com`
3. Password: `Temporal123!` (cámbiala después)
4. Click **"Create user"**

Luego, inserta un registro manual en la tabla `usuarios`:

Ve a **SQL Editor** y ejecuta:

```sql
insert into public.usuarios (id, email, nombre, rol, estado)
values (
  'USER_ID_DEL_USUARIO_QUE_CREASTE', 
  'admin@example.com', 
  'Administrador', 
  'coordinador', 
  'activo'
);

insert into public.contratos (codigo, nombre, estado)
values ('AA-12501191', 'Anglo American Sur S.A.', 'activo');
```

---

## PASO 4: Desarrollo (Dev mode)

Para probar en desarrollo:

```powershell
npm run dev
```

Se abrirá en `http://localhost:5173`

---

## PASO 5: Producción (Build)

Para generar la versión final:

```powershell
npm run build
```

Crea la carpeta `dist/` con los archivos optimizados.

---

## PASO 6: Usar la app

Doble clic en `Unificador-QR.bat` para abrir la app.

---

## Notas

- **Port 5173**: Desarrollo (npm run dev)
- **Port 8000**: Producción (Unificador-QR.bat)
- **Storage**: Los PDFs se guardan en `Supabase Storage` bucket `documentos`
- **Datos**: Todos los metadatos se guardan en Postgres (Supabase)

