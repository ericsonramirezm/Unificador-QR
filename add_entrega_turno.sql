-- ============================================================
-- Módulo "Entrega de Turno" — tabla nueva, independiente del resto.
-- Lista de actividades pendientes por faena, con observaciones libres y
-- marcado de "hecha". Acceso restringido a coordinador únicamente (crear,
-- ver y marcar) — pedido explícito, ver conversación del 2026-09-07.
-- ============================================================

create table if not exists public.entregas_turno (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id),
  faena text not null check (faena in ('LT', 'LB')),

  descripcion text not null,
  -- Sin límite de caracteres (pedido explícito) — "text" en Postgres ya no
  -- tiene tope práctico, a diferencia de un varchar(n).
  observaciones text,

  hecha boolean not null default false,
  hecha_por uuid references public.usuarios(id),
  hecha_en timestamptz,

  creado_por uuid not null references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_entregas_turno_contrato_faena
  on public.entregas_turno (contrato_id, faena, created_at desc);

alter table public.entregas_turno enable row level security;

-- Mismo patrón que fix_rls_recursion.sql (usuario_rol_actual(), ya
-- existente) — una sola política, sin acceso para ningún otro rol.
drop policy if exists "coordinador_todo_entregas_turno" on public.entregas_turno;
create policy "coordinador_todo_entregas_turno" on public.entregas_turno
  for all using (public.usuario_rol_actual() = 'coordinador')
  with check (public.usuario_rol_actual() = 'coordinador');
