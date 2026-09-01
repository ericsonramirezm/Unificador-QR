-- =============================================================================
-- 0013 — Equivalencias proveedor → código Defontana
-- =============================================================================
-- Las migraciones 0001–0012 ya están aplicadas: esto va aparte.
--
-- Los materiales llegan a Bodega Renca con el código y la descripción propios
-- del proveedor, distintos del código Defontana que usa WILUG puertas adentro.
-- Esta tabla no reemplaza nada del libro de movimientos: es solo una ayuda de
-- búsqueda para la Recepción. La primera vez que llega un código nuevo de un
-- proveedor, se enseña a qué artículo Defontana corresponde; de ahí en
-- adelante, tipear ese código lo autocompleta. La recepción y el traslado
-- posterior siguen registrando el articulo_id real de siempre, sin cambios.
--
-- Único cambio respecto del original de Bodega: `mi_rol()` → `mi_rol_bodega()`.
-- =============================================================================

create table equivalencias_proveedor (
  id                     uuid primary key default gen_random_uuid(),
  proveedor_id           uuid not null references proveedores (id),
  codigo_proveedor       text not null,
  descripcion_proveedor  text,
  articulo_id            uuid not null references articulos (id),
  creado_en              timestamptz not null default now(),
  creado_por             uuid references auth.users (id),
  constraint codigo_proveedor_no_vacio check (length(trim(codigo_proveedor)) > 0)
);

comment on table equivalencias_proveedor is
  'Ayuda de búsqueda para la Recepción: qué artículo Defontana corresponde al '
  'código con que cada proveedor identifica ese mismo material. No participa '
  'del libro de movimientos ni del traslado.';

-- Se normaliza al guardar, igual que codigo_defontana en articulos (0001), para
-- que 'ABC-1', 'abc-1' y ' ABC-1 ' colisionen de verdad.
create or replace function normalizar_codigo_proveedor()
returns trigger
language plpgsql
as $$
begin
  new.codigo_proveedor := upper(trim(new.codigo_proveedor));
  return new;
end;
$$;

create trigger equivalencias_proveedor_normalizar_codigo
  before insert or update of codigo_proveedor on equivalencias_proveedor
  for each row execute function normalizar_codigo_proveedor();

create unique index equivalencias_proveedor_uq on equivalencias_proveedor (proveedor_id, codigo_proveedor);

alter table equivalencias_proveedor enable row level security;

-- `mi_rol_bodega() is not null`, no `using (true)`: mismo ajuste de seguridad
-- documentado en el encabezado de 0002.
create policy leer_equivalencias_proveedor on equivalencias_proveedor
  for select to authenticated using (mi_rol_bodega() is not null);

-- Sin política de insert/update/delete directa: se enseña o corrige solo por la
-- función siguiente, igual que fijar_bodega_actual (0012) y fijar_foto_articulo
-- (0010) — una función acotada en vez de abrir la tabla entera.
create or replace function registrar_equivalencia_proveedor(
  p_proveedor uuid,
  p_codigo text,
  p_descripcion text,
  p_articulo uuid
)
returns equivalencias_proveedor
language plpgsql
security definer
set search_path = public
as $$
declare
  v_equivalencia equivalencias_proveedor%rowtype;
begin
  if mi_rol_bodega() is null then
    raise exception 'Tu usuario no tiene acceso al módulo de Bodega.';
  end if;

  if not exists (select 1 from proveedores where id = p_proveedor) then
    raise exception 'Ese proveedor no existe.';
  end if;
  if not exists (select 1 from articulos where id = p_articulo) then
    raise exception 'Ese artículo no existe.';
  end if;
  if length(trim(coalesce(p_codigo, ''))) = 0 then
    raise exception 'Falta el código del proveedor.';
  end if;

  insert into equivalencias_proveedor (proveedor_id, codigo_proveedor, descripcion_proveedor, articulo_id, creado_por)
  values (p_proveedor, p_codigo, nullif(trim(p_descripcion), ''), p_articulo, auth.uid())
  on conflict (proveedor_id, codigo_proveedor) do update
    set articulo_id           = excluded.articulo_id,
        descripcion_proveedor = excluded.descripcion_proveedor
  returning * into v_equivalencia;

  return v_equivalencia;
end;
$$;

revoke execute on function registrar_equivalencia_proveedor(uuid, text, text, uuid) from public, anon;
grant  execute on function registrar_equivalencia_proveedor(uuid, text, text, uuid) to authenticated;

comment on function registrar_equivalencia_proveedor(uuid, text, text, uuid) is
  'Enseña o corrige a qué artículo Defontana corresponde el código de un '
  'proveedor. Cualquiera que puede registrar una recepción puede llamarla — no '
  'toca stock ni el libro de movimientos.';
