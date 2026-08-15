-- ============================================================
-- FIX: Recursión infinita en políticas RLS (error 42P17 al hacer login)
-- Causa: las políticas "coordinador_..." consultaban la tabla "usuarios"
-- dentro de su propia condición, lo que dispara sus propias políticas
-- otra vez, en loop. Solución: una función SECURITY DEFINER que lee el
-- rol del usuario actual SIN pasar por RLS.
-- ============================================================

create or replace function public.usuario_rol_actual()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select rol from public.usuarios where id = auth.uid();
$$;

grant execute on function public.usuario_rol_actual() to authenticated;

-- ---------- usuarios ----------
drop policy if exists "coordinador_ver_usuarios" on public.usuarios;
create policy "coordinador_ver_usuarios" on public.usuarios
  for select using (public.usuario_rol_actual() = 'coordinador');

drop policy if exists "coordinador_actualizar_usuarios" on public.usuarios;
create policy "coordinador_actualizar_usuarios" on public.usuarios
  for update using (public.usuario_rol_actual() = 'coordinador')
  with check (public.usuario_rol_actual() = 'coordinador');

drop policy if exists "coordinador_crear_usuarios" on public.usuarios;
create policy "coordinador_crear_usuarios" on public.usuarios
  for insert with check (public.usuario_rol_actual() = 'coordinador');

-- ---------- contratos ----------
drop policy if exists "coordinador_ver_contratos" on public.contratos;
create policy "coordinador_ver_contratos" on public.contratos
  for select using (public.usuario_rol_actual() = 'coordinador');

drop policy if exists "otros_ver_contratos_activos" on public.contratos;
create policy "otros_ver_contratos_activos" on public.contratos
  for select using (
    public.usuario_rol_actual() in ('apr', 'supervisor', 'consultor')
    and estado = 'activo'
  );

drop policy if exists "coordinador_actualizar_contratos" on public.contratos;
create policy "coordinador_actualizar_contratos" on public.contratos
  for update using (public.usuario_rol_actual() = 'coordinador')
  with check (public.usuario_rol_actual() = 'coordinador');

-- ---------- documentos ----------
drop policy if exists "coordinador_ver_documentos" on public.documentos;
create policy "coordinador_ver_documentos" on public.documentos
  for select using (public.usuario_rol_actual() = 'coordinador');

drop policy if exists "apr_supervisor_ver_propios" on public.documentos;
create policy "apr_supervisor_ver_propios" on public.documentos
  for select using (
    public.usuario_rol_actual() in ('apr', 'supervisor')
    and creado_por = auth.uid()
  );

drop policy if exists "consultor_ver_hoy" on public.documentos;
create policy "consultor_ver_hoy" on public.documentos
  for select using (
    public.usuario_rol_actual() = 'consultor'
    and date(fecha_creacion) = current_date
  );

drop policy if exists "apr_supervisor_crear" on public.documentos;
create policy "apr_supervisor_crear" on public.documentos
  for insert with check (
    public.usuario_rol_actual() in ('apr', 'supervisor')
    and creado_por = auth.uid()
  );

drop policy if exists "coordinador_crear_documentos" on public.documentos;
create policy "coordinador_crear_documentos" on public.documentos
  for insert with check (public.usuario_rol_actual() = 'coordinador');

drop policy if exists "coordinador_actualizar_documentos" on public.documentos;
create policy "coordinador_actualizar_documentos" on public.documentos
  for update using (public.usuario_rol_actual() = 'coordinador')
  with check (public.usuario_rol_actual() = 'coordinador');

drop policy if exists "coordinador_eliminar_documentos" on public.documentos;
create policy "coordinador_eliminar_documentos" on public.documentos
  for delete using (public.usuario_rol_actual() = 'coordinador');

-- ---------- historial ----------
drop policy if exists "coordinador_ver_historial" on public.historial;
create policy "coordinador_ver_historial" on public.historial
  for select using (public.usuario_rol_actual() = 'coordinador');

drop policy if exists "apr_supervisor_ver_historial_propio" on public.historial;
create policy "apr_supervisor_ver_historial_propio" on public.historial
  for select using (
    public.usuario_rol_actual() in ('apr', 'supervisor')
    and documento_id in (
      select id from public.documentos where creado_por = auth.uid()
    )
  );

drop policy if exists "coordinador_eliminar_historial" on public.historial;
create policy "coordinador_eliminar_historial" on public.historial
  for delete using (public.usuario_rol_actual() = 'coordinador');

-- ---------- config ----------
drop policy if exists "coordinador_config" on public.config;
create policy "coordinador_config" on public.config
  for all using (public.usuario_rol_actual() = 'coordinador')
  with check (public.usuario_rol_actual() = 'coordinador');
