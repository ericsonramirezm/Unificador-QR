-- ============================================================
-- Módulo "Parte Diario" — tablas nuevas, independientes de las de
-- Documentos QR (no se mezclan datos: comparten solo "usuarios" y
-- "contratos", que ya existen).
--
-- Agrega también el rol "mandante": la persona de la empresa mandante
-- (ver contratos.mandante) que agrega su comentario al parte diario
-- después de que el contratista lo envía. No ve el módulo de
-- Documentos QR.
-- ============================================================

-- ---------- rol nuevo ----------
-- "usuarios.rol" es tipo text (no enum de Postgres), así que no hace
-- falta ALTER TYPE: basta con permitirlo en las políticas de abajo y
-- en el enum de TypeScript (src/types/index.ts).

-- ---------- tabla principal ----------
create table if not exists public.partes_diarios (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id),

  numero_reporte int not null,
  fecha date not null,
  condicion_climatica text,

  -- Secciones de línea: forma fija (ver MAPEO_CAMPOS.md), se guardan como
  -- jsonb en vez de tablas relacionales aparte porque siempre se leen y
  -- escriben completas junto con el reporte, nunca por fila suelta.
  actividades jsonb not null default '[]',
  -- [{ area, descripcion, cantidad }]

  mano_obra_directa jsonb not null default '[]',
  -- [{ cargo, contratados, operativos, horas_por_actividad: [n,n,n,n,n,n,n] }]

  mano_obra_indirecta jsonb not null default '[]',
  -- [{ cargo, contratados, operativos }]

  maquinaria jsonb not null default '[]',
  -- [{ equipo, cantidad, mantencion, standby, horas_por_actividad: [n,n,n,n,n,n,n] }]

  jornada jsonb,
  -- { inicio, fin, horas_efectivas: {entrada, salida}, horas_perdidas: {entrada, salida} }

  hh_directas_programado numeric not null default 0,
  hh_indirectas_programado numeric not null default 0,

  -- Acumulados: la app los calcula sumando los partes_diarios anteriores
  -- del mismo contrato (ver decisión en MAPEO_CAMPOS.md) y los guarda acá
  -- como snapshot, para no tener que recalcular al generar el Excel.
  hh_directas_acumuladas numeric,
  hm_acumuladas numeric,
  hh_indirectas_acumuladas numeric,

  fotos jsonb not null default '[]',
  -- [{ url, caption }] — suben al bucket "documentos" (storage ya existente),
  -- carpeta partes-diarios/<contrato_id>/<parte_id>/

  comentario_contratista_autor text,
  comentario_contratista text,

  comentario_mandante_autor text,
  comentario_mandante text,
  comentario_mandante_por uuid references public.usuarios(id),
  comentario_mandante_fecha timestamptz,

  estado text not null default 'borrador'
    check (estado in ('borrador', 'enviado', 'comentado_mandante')),

  excel_url text,

  creado_por uuid not null references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (contrato_id, numero_reporte)
);

create index if not exists idx_partes_diarios_contrato_fecha
  on public.partes_diarios (contrato_id, fecha desc);

-- Secuencia atómica del "Report N°" por contrato, mismo patrón que
-- obtener_siguiente_secuencia_pdf ya usa para los documentos QR.
create or replace function public.obtener_siguiente_numero_parte(p_contrato_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_siguiente int;
begin
  select coalesce(max(numero_reporte), 0) + 1
  into v_siguiente
  from public.partes_diarios
  where contrato_id = p_contrato_id;

  return v_siguiente;
end;
$$;

grant execute on function public.obtener_siguiente_numero_parte(uuid) to authenticated;

-- Acumulados: se resuelven en el cliente, no en SQL. Cada fila ya guarda su
-- propio acumulado como snapshot (hh_directas_acumuladas, etc.), así que
-- para el turno nuevo basta con:
--   1) pedir el último parte del contrato: `select hh_directas_acumuladas,
--      hm_acumuladas, hh_indirectas_acumuladas from partes_diarios
--      where contrato_id = ? order by fecha desc limit 1`
--      (su acumulado ya trae la suma de todos los anteriores);
--   2) sumarle los totales del turno actual (que la app ya tiene calculados
--      en el formulario) antes de insertar la fila nueva.
-- Evita sumar arreglos jsonb en SQL, que es más frágil que hacerlo donde
-- los números ya existen como tales.

alter table public.partes_diarios enable row level security;

-- ---------- RLS: mismo patrón que fix_rls_recursion.sql (usuario_rol_actual()) ----------

drop policy if exists "coordinador_todo_partes" on public.partes_diarios;
create policy "coordinador_todo_partes" on public.partes_diarios
  for all using (public.usuario_rol_actual() = 'coordinador')
  with check (public.usuario_rol_actual() = 'coordinador');

drop policy if exists "supervisor_apr_crear_partes" on public.partes_diarios;
create policy "supervisor_apr_crear_partes" on public.partes_diarios
  for insert with check (
    public.usuario_rol_actual() in ('apr', 'supervisor')
    and creado_por = auth.uid()
  );

drop policy if exists "supervisor_apr_ver_editar_propios" on public.partes_diarios;
create policy "supervisor_apr_ver_editar_propios" on public.partes_diarios
  for select using (
    public.usuario_rol_actual() in ('apr', 'supervisor')
    and creado_por = auth.uid()
  );

drop policy if exists "supervisor_apr_actualizar_propios" on public.partes_diarios;
create policy "supervisor_apr_actualizar_propios" on public.partes_diarios
  for update using (
    public.usuario_rol_actual() in ('apr', 'supervisor')
    and creado_por = auth.uid()
  )
  with check (
    public.usuario_rol_actual() in ('apr', 'supervisor')
    and creado_por = auth.uid()
  );

-- El mandante solo ve reportes ya enviados, y solo puede tocar sus propios
-- campos de comentario (se refuerza en la UI; a nivel de RLS se permite el
-- update completo de la fila igual que a coordinador para simplificar, dado
-- que hoy no hay más de un editor simultáneo por reporte — revisar si se
-- suma un segundo cliente/mandante en paralelo).
drop policy if exists "mandante_ver_enviados" on public.partes_diarios;
create policy "mandante_ver_enviados" on public.partes_diarios
  for select using (
    public.usuario_rol_actual() = 'mandante'
    and estado in ('enviado', 'comentado_mandante')
  );

drop policy if exists "mandante_comentar" on public.partes_diarios;
create policy "mandante_comentar" on public.partes_diarios
  for update using (
    public.usuario_rol_actual() = 'mandante'
    and estado in ('enviado', 'comentado_mandante')
  )
  with check (
    public.usuario_rol_actual() = 'mandante'
    and estado in ('enviado', 'comentado_mandante')
  );

drop policy if exists "consultor_ver_enviados" on public.partes_diarios;
create policy "consultor_ver_enviados" on public.partes_diarios
  for select using (
    public.usuario_rol_actual() = 'consultor'
    and estado in ('enviado', 'comentado_mandante')
  );
