-- ============================================================
-- Auto-registro de usuarios (correo + contraseña) con rol Consultor
-- por defecto, asignable luego por el Coordinador desde el panel.
--
-- Hoy solo el Coordinador puede insertar filas en "usuarios"
-- (política "coordinador_crear_usuarios" en fix_rls_recursion.sql).
-- Esta política adicional permite que un usuario recién autenticado
-- vía Supabase Auth cree su PROPIA fila — pero el "with check" fuerza
-- rol = 'consultor', para que nadie pueda autoasignarse Coordinador/
-- APR/Supervisor manipulando la llamada directamente a la API
-- (el código del cliente en auth.signUp también hardcodea 'consultor',
-- esto es una segunda capa de seguridad a nivel de base de datos).
-- ============================================================

drop policy if exists "usuarios_crear_propio" on public.usuarios;
create policy "usuarios_crear_propio" on public.usuarios
  for insert
  with check (auth.uid() = id and rol = 'consultor');
