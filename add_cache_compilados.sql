-- ============================================================
-- Caché de compilados por día: evita recompilar/resubir el PDF
-- del día cada vez que se abre Historial, si nada cambió desde
-- la última vez (comparando la fecha de aprobación más reciente
-- de ese día contra la que quedó guardada al generar el caché).
-- ============================================================

create table if not exists public.compilados_dia (
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  fecha date not null,
  url text not null,
  ultima_aprobacion timestamp not null,
  total_documentos int not null default 0,
  generado_por uuid references public.usuarios(id) on delete set null,
  generado_en timestamp default now(),
  primary key (contrato_id, fecha)
);

alter table public.compilados_dia enable row level security;

create policy "coordinador_ver_compilados" on public.compilados_dia
  for select using (public.usuario_rol_actual() = 'coordinador');

create policy "coordinador_crear_compilados" on public.compilados_dia
  for insert with check (public.usuario_rol_actual() = 'coordinador');

create policy "coordinador_actualizar_compilados" on public.compilados_dia
  for update using (public.usuario_rol_actual() = 'coordinador')
  with check (public.usuario_rol_actual() = 'coordinador');
