-- =============================================================================
-- 0015 — Tipos de artículo creables por el usuario
-- =============================================================================
-- Sin cambios respecto del original de Bodega: no toca `documentos`,
-- `perfiles` ni `mi_rol()` — usa `puede_mover()`/`es_admin()`, que ya apuntan
-- a `usuarios.rol_bodega` desde 0001.
--
-- Las migraciones 0001–0014 ya están aplicadas: esto va aparte.
--
-- Hasta acá "Tipo" era un enum fijo de Postgres (`tipo_articulo`, creado en 0001,
-- ampliado en 0009 para agregar ACTIVO) — decisión deliberada para que agregar un
-- tipo sin darle etiqueta rompiera la compilación de TypeScript. El usuario pidió
-- ahora poder crear un Tipo nuevo al dar de alta un artículo (desde Catálogos o
-- desde la Recepción), así que se convierte en un catálogo más, como Bodegas o
-- Proveedores. `codigo` sigue siendo el valor estable que ya usa medio código
-- (`tipo === 'EPP'`, `.eq('tipo', 'EPP')` en `pages/Epp.tsx`), así que ese filtro
-- no necesita tocarse.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. El catálogo
-- ---------------------------------------------------------------------------
create table tipos_articulo (
  codigo     text primary key,
  nombre     text not null check (length(trim(nombre)) > 0),
  color      text not null,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now(),
  creado_por uuid references auth.users (id)
);

comment on table tipos_articulo is
  'Los tipos de artículo (Material, EPP, Activo, y los que se agreguen). `codigo` '
  'es el valor estable guardado en articulos.tipo y comparado en el código '
  '(p.ej. Epp.tsx filtra tipo=''EPP''); `nombre` es solo la etiqueta visible.';

-- Igual que `normalizar_codigo_defontana` (0001): el código se calcula del
-- nombre, nunca se escribe a mano, para que 'Herramienta', 'herramienta ' y
-- ' HERRAMIENTA' colisionen de verdad.
create or replace function normalizar_codigo_tipo_articulo()
returns trigger
language plpgsql
as $$
begin
  new.codigo := upper(trim(new.nombre));
  return new;
end;
$$;

create trigger tipos_articulo_normalizar_codigo
  before insert on tipos_articulo
  for each row execute function normalizar_codigo_tipo_articulo();

insert into tipos_articulo (codigo, nombre, color) values
  ('MATERIAL', 'Material', 'bg-slate-100 text-slate-700'),
  ('EPP',      'EPP',      'bg-violet-100 text-violet-800'),
  ('ACTIVO',   'Activo',   'bg-amber-100 text-amber-800');

-- ---------------------------------------------------------------------------
-- 2. `articulos.tipo`: de enum a texto con llave foránea
-- ---------------------------------------------------------------------------
-- Dos vistas dependen de `articulos.tipo`; Postgres no deja cambiarle el tipo
-- a una columna mientras algo dependa de ella, así que se sueltan primero y se
-- recrean después — igual que ya se hizo una vez con v_stock en 0009:36.
-- `CREATE OR REPLACE VIEW` no sirve para esto: solo admite agregar columnas al
-- final, nunca cambiar el tipo de una ya existente.
drop view if exists v_stock;
drop view if exists v_movimiento_lineas;

alter table articulos alter column tipo type text using tipo::text;
alter table articulos add constraint articulos_tipo_fkey foreign key (tipo) references tipos_articulo (codigo);

drop type tipo_articulo;

-- ---------------------------------------------------------------------------
-- 3. Se recrean IDÉNTICAS a como quedaron en 0010 (v_stock) y 0005
-- (v_movimiento_lineas) — mismo `select`, mismo `security_invoker`. El drop
-- se llevó también sus `grant`, así que se vuelven a otorgar al final.
-- ---------------------------------------------------------------------------
create view v_stock with (security_invoker = true) as
  select a.id     as articulo_id,
         a.codigo_defontana,
         a.descripcion,
         a.tipo,
         a.unidad,
         a.marca,
         a.familia,
         a.controla_serie,
         a.stock_minimo,
         a.activo,
         b.id     as bodega_id,
         b.nombre as bodega,
         s.cantidad,
         s.cantidad < a.stock_minimo as bajo_minimo,
         a.foto_path,
         a.foto_miniatura_path
    from stock_cache s
    join articulos a on a.id = s.articulo_id
    join bodegas   b on b.id = s.bodega_id
   where b.activo;

drop view if exists v_movimiento_lineas;
create view v_movimiento_lineas with (security_invoker = true) as
  select l.id,
         l.movimiento_id,
         m.tipo   as movimiento_tipo,
         m.fecha,
         l.articulo_id,
         a.codigo_defontana,
         a.descripcion,
         a.tipo   as articulo_tipo,
         a.unidad,
         a.marca,
         l.cantidad,
         l.cantidad_guia,
         case when l.cantidad_guia is null then null
              else l.cantidad - l.cantidad_guia end as diferencia,
         l.costo_unitario,
         l.observacion,
         coalesce(
           (select array_agg(se.numero_serie order by se.numero_serie)
              from movimiento_linea_series mls
              join series se on se.id = mls.serie_id
             where mls.linea_id = l.id),
           '{}'::text[]
         ) as series
    from movimiento_lineas l
    join movimientos m on m.id = l.movimiento_id
    join articulos a   on a.id = l.articulo_id;

grant select on v_stock, v_movimiento_lineas to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS: leer para todos, escribir solo Administrador, crear también quien
--    puede registrar una entrada (mismo criterio que `crear_articulos_al_recibir`
--    en 0007 y `crear_proveedores_al_recibir` en 0014).
-- ---------------------------------------------------------------------------
alter table tipos_articulo enable row level security;

-- `mi_rol_bodega() is not null`, no `using (true)`: mismo ajuste de seguridad
-- documentado en el encabezado de 0002.
create policy leer_tipos_articulo on tipos_articulo
  for select to authenticated using (mi_rol_bodega() is not null);

create policy admin_tipos_articulo on tipos_articulo
  for all to authenticated using (es_admin()) with check (es_admin());

create policy crear_tipos_articulo_al_recibir on tipos_articulo
  for insert to authenticated with check (puede_mover());
