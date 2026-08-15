-- ============================================================
-- FIX 3: Secuencia atómica para nombres de PDF (evita colisiones
-- cuando dos usuarios cargan documentos el mismo día)
-- ============================================================

create table if not exists public.secuencias_pdf (
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  fecha date not null,
  ultimo_valor int not null default 0,
  primary key (contrato_id, fecha)
);

alter table public.secuencias_pdf enable row level security;
-- Sin políticas propias: solo se accede a través de la función de abajo (SECURITY DEFINER).

create or replace function public.obtener_siguiente_secuencia_pdf(
  p_contrato_id uuid,
  p_fecha date
) returns int
language sql
security definer
set search_path = public
as $$
  insert into public.secuencias_pdf (contrato_id, fecha, ultimo_valor)
  values (p_contrato_id, p_fecha, 1)
  on conflict (contrato_id, fecha)
  do update set ultimo_valor = secuencias_pdf.ultimo_valor + 1
  returning ultimo_valor;
$$;

grant execute on function public.obtener_siguiente_secuencia_pdf(uuid, date) to authenticated;

-- ============================================================
-- FIX 6: Reactivar RLS (estaba deshabilitada desde el debugging)
-- ============================================================

alter table public.usuarios enable row level security;
alter table public.contratos enable row level security;
alter table public.documentos enable row level security;
alter table public.historial enable row level security;
alter table public.config enable row level security;

-- Limpieza por si quedaron políticas previas a medio crear
drop policy if exists "usuarios_ver_propio" on public.usuarios;
drop policy if exists "coordinador_ver_usuarios" on public.usuarios;
drop policy if exists "coordinador_actualizar_usuarios" on public.usuarios;
drop policy if exists "coordinador_crear_usuarios" on public.usuarios;
drop policy if exists "coordinador_ver_contratos" on public.contratos;
drop policy if exists "otros_ver_contratos_activos" on public.contratos;
drop policy if exists "coordinador_actualizar_contratos" on public.contratos;
drop policy if exists "coordinador_ver_documentos" on public.documentos;
drop policy if exists "apr_supervisor_ver_propios" on public.documentos;
drop policy if exists "consultor_ver_hoy" on public.documentos;
drop policy if exists "apr_supervisor_crear" on public.documentos;
drop policy if exists "coordinador_crear_documentos" on public.documentos;
drop policy if exists "coordinador_actualizar_documentos" on public.documentos;
drop policy if exists "coordinador_eliminar_documentos" on public.documentos;
drop policy if exists "apr_supervisor_no_otros" on public.documentos;
drop policy if exists "coordinador_ver_historial" on public.historial;
drop policy if exists "apr_supervisor_ver_historial_propio" on public.historial;
drop policy if exists "todos_insertar_historial" on public.historial;
drop policy if exists "coordinador_eliminar_historial" on public.historial;
drop policy if exists "coordinador_config" on public.config;
drop policy if exists "otros_leer_config" on public.config;

-- usuarios
create policy "usuarios_ver_propio" on public.usuarios
  for select using (auth.uid() = id);

create policy "coordinador_ver_usuarios" on public.usuarios
  for select using (
    (select rol from public.usuarios where id = auth.uid()) = 'coordinador'
  );

create policy "coordinador_actualizar_usuarios" on public.usuarios
  for update using (
    (select rol from public.usuarios where id = auth.uid()) = 'coordinador'
  )
  with check (
    (select rol from public.usuarios where id = auth.uid()) = 'coordinador'
  );

create policy "coordinador_crear_usuarios" on public.usuarios
  for insert with check (
    (select rol from public.usuarios where id = auth.uid()) = 'coordinador'
  );

-- contratos
create policy "coordinador_ver_contratos" on public.contratos
  for select using (
    (select rol from public.usuarios where id = auth.uid()) = 'coordinador'
  );

create policy "otros_ver_contratos_activos" on public.contratos
  for select using (
    (select rol from public.usuarios where id = auth.uid()) in ('apr', 'supervisor', 'consultor')
    and estado = 'activo'
  );

create policy "coordinador_actualizar_contratos" on public.contratos
  for update using (
    (select rol from public.usuarios where id = auth.uid()) = 'coordinador'
  )
  with check (
    (select rol from public.usuarios where id = auth.uid()) = 'coordinador'
  );

-- documentos
create policy "coordinador_ver_documentos" on public.documentos
  for select using (
    (select rol from public.usuarios where id = auth.uid()) = 'coordinador'
  );

create policy "apr_supervisor_ver_propios" on public.documentos
  for select using (
    (select rol from public.usuarios where id = auth.uid()) in ('apr', 'supervisor')
    and creado_por = auth.uid()
  );

create policy "consultor_ver_hoy" on public.documentos
  for select using (
    (select rol from public.usuarios where id = auth.uid()) = 'consultor'
    and date(fecha_creacion) = current_date
  );

create policy "apr_supervisor_crear" on public.documentos
  for insert with check (
    (select rol from public.usuarios where id = auth.uid()) in ('apr', 'supervisor')
    and creado_por = auth.uid()
  );

create policy "coordinador_crear_documentos" on public.documentos
  for insert with check (
    (select rol from public.usuarios where id = auth.uid()) = 'coordinador'
  );

create policy "coordinador_actualizar_documentos" on public.documentos
  for update using (
    (select rol from public.usuarios where id = auth.uid()) = 'coordinador'
  )
  with check (
    (select rol from public.usuarios where id = auth.uid()) = 'coordinador'
  );

create policy "coordinador_eliminar_documentos" on public.documentos
  for delete using (
    (select rol from public.usuarios where id = auth.uid()) = 'coordinador'
  );

-- historial
create policy "coordinador_ver_historial" on public.historial
  for select using (
    (select rol from public.usuarios where id = auth.uid()) = 'coordinador'
  );

create policy "apr_supervisor_ver_historial_propio" on public.historial
  for select using (
    (select rol from public.usuarios where id = auth.uid()) in ('apr', 'supervisor')
    and documento_id in (
      select id from public.documentos where creado_por = auth.uid()
    )
  );

create policy "todos_insertar_historial" on public.historial
  for insert with check (true);

create policy "coordinador_eliminar_historial" on public.historial
  for delete using (
    (select rol from public.usuarios where id = auth.uid()) = 'coordinador'
  );

-- config
create policy "coordinador_config" on public.config
  for all using (
    (select rol from public.usuarios where id = auth.uid()) = 'coordinador'
  )
  with check (
    (select rol from public.usuarios where id = auth.uid()) = 'coordinador'
  );

create policy "otros_leer_config" on public.config
  for select using (true);
