-- =============================================================================
-- 0001 — Esquema base del control de inventario de bodega (WILUG Ltda)
-- =============================================================================
-- Adaptado de Bodega/bodega-app/supabase/migrations/0001_esquema.sql para vivir
-- dentro del proyecto Supabase de Unificador-QR (fusión de módulos, Fase 0).
-- Dos diferencias deliberadas respecto del original, documentadas en el plan de
-- fusión:
--
--   1. NO se crea la tabla `perfiles`. El rol y la bodega elegida de Bodega
--      pasan a vivir como columnas (`rol_bodega`, `bodega_actual_id`) en la
--      tabla `usuarios` que Unificador-QR YA TIENE — se agregan en 0020, al
--      final de este set, no aquí. `mi_rol()` se renombra a `mi_rol_bodega()`
--      y lee `usuarios.rol_bodega` en vez de `perfiles.rol`.
--   2. NO se crea ningún trigger sobre `auth.users`. El alta de usuario en
--      Unificador-QR es client-driven (el frontend llama `auth.signUp()` y
--      hace un INSERT explícito en `usuarios` inmediatamente después, con
--      `rol = 'consultor'` forzado) — no trigger-driven. Portar
--      `crear_perfil_al_registrarse` dispararía un INSERT en `usuarios` ANTES
--      del INSERT del cliente, que fallaría por clave duplicada y rompería el
--      alta de CUALQUIER usuario nuevo, no solo los de Bodega. Ver 0020 para
--      el detalle completo de esta decisión.
--
-- El resto del esquema (catálogos, el libro de movimientos, series, stock
-- derivado) es igual al original salvo el renombre de tabla `documentos` →
-- `bodega_documentos` (Unificador-QR ya tiene su propia tabla `documentos`,
-- para el módulo de Documentos QR — nombres distintos, dominios distintos).
--
-- Principio rector, sin cambios: el inventario es un LIBRO DE MOVIMIENTOS
-- INMUTABLE. El stock no se guarda como un número que alguien actualiza; se
-- deriva del libro. `stock_cache` existe solo como índice materializado y como
-- fila de bloqueo para la concurrencia — nunca es la verdad. Ver
-- `recalcular_stock()`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
-- `rol_usuario` se reutiliza en 0020 para la columna `usuarios.rol_bodega` —
-- no se crea un segundo enum con los mismos cuatro valores. Ver el comentario
-- de cabecera de 0020 para por qué ese nombre no choca con nada de
-- Unificador-QR (que no tiene ningún tipo Postgres propio para rol/estado:
-- son `text` con `check`).
create type rol_usuario     as enum ('ADMIN', 'BODEGUERO', 'CONSULTA', 'PREVENCIONISTA');
create type tipo_articulo   as enum ('MATERIAL', 'EPP');
create type tipo_documento  as enum ('GUIA_DESPACHO', 'ORDEN_COMPRA');
create type estado_serie    as enum ('EN_BODEGA', 'ENTREGADO', 'DEVUELTO', 'BAJA');
create type tipo_movimiento as enum (
  'ENTRADA',      -- +  llega por guía de despacho
  'SALIDA_SALA',  -- -  se instala en una sala eléctrica
  'ENTREGA_EPP',  -- -  se entrega a un trabajador
  'DEVOLUCION',   -- +  vuelve a bodega lo que no se usó
  'TRASLADO',     -- -/+ cambia de bodega: ni compra ni consumo
  'AJUSTE'        -- ±  inventario físico / corrección, solo ADMIN
);

-- ---------------------------------------------------------------------------
-- Rol de Bodega: funciones sobre `usuarios.rol_bodega`, no sobre `perfiles`
-- ---------------------------------------------------------------------------
-- `mi_rol_bodega()` es SECURITY DEFINER a propósito: si leyera `usuarios` bajo
-- RLS, cada política que la invoque entraría en recursión infinita (mismo
-- motivo que ya documenta `fix_rls_recursion.sql` de Unificador-QR para su
-- propia `usuario_rol_actual()`).
--
-- El filtro `estado = 'activo'` reemplaza al `activo` booleano que tenía
-- `perfiles`: una cuenta inactiva (ver `fix_seguridad_qa.sql`, toda cuenta
-- nueva nace inactiva hasta que un Coordinador la activa) no tiene rol de
-- Bodega tampoco, sin importar lo que diga `rol_bodega`.
--
-- NOTA: al momento en que se crea esta función, `usuarios.rol_bodega` todavía
-- no existe como columna (se agrega recién en 0020). Esto es seguro SOLO
-- porque la función es `language plpgsql`, no `language sql`: Postgres valida
-- (con `check_function_bodies` en su valor por omisión) las referencias a
-- tablas/columnas dentro del cuerpo de una función `language sql` AL
-- CREARLA — probado en carne propia: con `language sql` esta migración
-- fallaba con `column "rol_bodega" does not exist` antes de que 0020
-- alcanzara a agregarla. `language plpgsql` no tiene ese problema: el texto
-- de cada sentencia embebida queda opaco hasta la primera ejecución (vía
-- SPI), así que la función se crea sin quejarse y esta columna solo tiene
-- que existir para cuando alguien la LLAME — y eso no ocurre hasta que
-- 0001–0020 terminan de aplicarse completas. Mismo motivo por el que
-- `fijar_bodega_actual` (0012, plpgsql) puede referenciar
-- `usuarios.bodega_actual_id` antes de que exista.
create or replace function mi_rol_bodega()
returns rol_usuario
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return (select rol_bodega from usuarios where id = auth.uid() and estado = 'activo');
end;
$$;

create or replace function es_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select mi_rol_bodega() = 'ADMIN'; $$;

-- Quién puede mover inventario (todo salvo entregas de EPP, ver `puede_entregar_epp`).
create or replace function puede_mover() returns boolean
language sql stable security definer set search_path = public
as $$ select mi_rol_bodega() in ('ADMIN', 'BODEGUERO'); $$;

create or replace function puede_entregar_epp() returns boolean
language sql stable security definer set search_path = public
as $$ select mi_rol_bodega() in ('ADMIN', 'BODEGUERO', 'PREVENCIONISTA'); $$;

-- ---------------------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------------------
create table bodegas (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null unique check (length(trim(nombre)) > 0),
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);

comment on table bodegas is
  'Se despacha con una sola bodega creada (decisión del usuario: una bodega, un '
  'contrato). La tabla y el tipo TRASLADO existen desde el día uno para que abrir '
  'una bodega de faena no obligue a reescribir el libro.';

create table articulos (
  id                uuid primary key default gen_random_uuid(),
  codigo_defontana  text not null,
  descripcion       text not null check (length(trim(descripcion)) > 0),
  tipo              tipo_articulo not null,
  unidad            text not null default 'UN',
  marca             text,
  familia           text,
  controla_serie    boolean not null default false,
  stock_minimo      numeric(14, 3) not null default 0 check (stock_minimo >= 0),
  activo            boolean not null default true,
  creado_en         timestamptz not null default now(),
  creado_por        uuid references auth.users (id),
  constraint codigo_defontana_no_vacio check (length(trim(codigo_defontana)) > 0)
);

-- La unicidad del Código Defontana es BLOQUEANTE por pedido explícito del usuario.
-- Vive aquí, en la base — la validación del formulario es cortesía, no control: sin
-- este índice, dos pestañas guardando a la vez crean el duplicado igual.
create unique index articulos_codigo_defontana_uq on articulos (codigo_defontana);

-- Se normaliza al guardar para que 'ABC-1', 'abc-1' y ' ABC-1 ' colisionen de verdad.
create or replace function normalizar_codigo_defontana()
returns trigger
language plpgsql
as $$
begin
  new.codigo_defontana := upper(trim(new.codigo_defontana));
  return new;
end;
$$;

create trigger articulos_normalizar_codigo
  before insert or update of codigo_defontana on articulos
  for each row execute function normalizar_codigo_defontana();

create index articulos_busqueda_idx on articulos using gin (
  to_tsvector('spanish', codigo_defontana || ' ' || descripcion || ' ' || coalesce(marca, ''))
);
create index articulos_tipo_idx on articulos (tipo) where activo;

create table proveedores (
  id     uuid primary key default gen_random_uuid(),
  rut    text,
  nombre text not null check (length(trim(nombre)) > 0),
  activo boolean not null default true
);
create unique index proveedores_rut_uq on proveedores (rut) where rut is not null;

create table salas_electricas (
  id     uuid primary key default gen_random_uuid(),
  codigo text,
  nombre text not null unique check (length(trim(nombre)) > 0),
  activo boolean not null default true
);

comment on table salas_electricas is
  'Se digitan a mano. Decisión del usuario: NO se importa la línea base del '
  'Protocolizer ni se imputa a código EDT.';

create table trabajadores (
  id     uuid primary key default gen_random_uuid(),
  rut    text not null unique check (length(trim(rut)) > 0),
  nombre text not null check (length(trim(nombre)) > 0),
  cargo  text,
  activo boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Documentos: la guía de despacho y la orden de compra que respaldan una
-- entrada. Renombrada `documentos` → `bodega_documentos`: Unificador-QR ya
-- tiene su propia tabla `documentos` para el módulo de Documentos QR, sin
-- ninguna relación con Bodega.
-- ---------------------------------------------------------------------------
create table bodega_documentos (
  id            uuid primary key default gen_random_uuid(),
  tipo          tipo_documento not null default 'GUIA_DESPACHO',
  folio         text not null check (length(trim(folio)) > 0),
  proveedor_id  uuid references proveedores (id),
  fecha         date not null,
  orden_compra  text,
  archivo_path  text, -- ruta dentro del bucket privado `guias`
  creado_en     timestamptz not null default now(),
  creado_por    uuid references auth.users (id)
);

-- Impide recibir dos veces la misma guía del mismo proveedor, que es la forma más
-- común de inflar el stock sin que nadie lo note.
create unique index bodega_documentos_folio_uq
  on bodega_documentos (tipo, proveedor_id, folio)
  where proveedor_id is not null;

-- ---------------------------------------------------------------------------
-- El libro
-- ---------------------------------------------------------------------------
create table movimientos (
  id                 uuid primary key default gen_random_uuid(),
  folio              bigint generated always as identity, -- correlativo legible
  tipo               tipo_movimiento not null,
  fecha              date not null default current_date,
  bodega_id          uuid not null references bodegas (id),
  documento_id       uuid references bodega_documentos (id),
  sala_id            uuid references salas_electricas (id),
  trabajador_id      uuid references trabajadores (id),
  bodega_destino_id  uuid references bodegas (id),
  retirado_por       text,
  motivo             text,
  observacion        text,
  anula_movimiento_id uuid references movimientos (id),
  creado_por         uuid not null references auth.users (id),
  creado_en          timestamptz not null default now(),

  -- Las reglas del dominio como estructura, no como buena intención del frontend:
  -- cada tipo de movimiento exige exactamente su contraparte y ninguna otra.
  constraint movimiento_coherente check (
    case tipo
      when 'ENTRADA' then
        documento_id is not null and sala_id is null
        and trabajador_id is null and bodega_destino_id is null
      when 'SALIDA_SALA' then
        sala_id is not null and trabajador_id is null and bodega_destino_id is null
      when 'ENTREGA_EPP' then
        trabajador_id is not null and sala_id is null and bodega_destino_id is null
      when 'DEVOLUCION' then
        (sala_id is not null or trabajador_id is not null) and bodega_destino_id is null
      when 'TRASLADO' then
        bodega_destino_id is not null and bodega_destino_id <> bodega_id
        and sala_id is null and trabajador_id is null
      when 'AJUSTE' then
        length(trim(coalesce(motivo, ''))) > 0
        and sala_id is null and trabajador_id is null and bodega_destino_id is null
      else false
    end
  )
);

create index movimientos_fecha_idx      on movimientos (fecha desc, creado_en desc);
create index movimientos_tipo_idx       on movimientos (tipo);
create index movimientos_bodega_idx     on movimientos (bodega_id);
create index movimientos_sala_idx       on movimientos (sala_id)        where sala_id is not null;
create index movimientos_trabajador_idx on movimientos (trabajador_id)  where trabajador_id is not null;
create index movimientos_documento_idx  on movimientos (documento_id)   where documento_id is not null;

create table movimiento_lineas (
  id             uuid primary key default gen_random_uuid(),
  movimiento_id  uuid not null references movimientos (id) on delete cascade,
  articulo_id    uuid not null references articulos (id),
  -- Magnitud positiva en todos los tipos salvo AJUSTE, que admite negativo.
  -- El signo real sobre el stock lo pone el tipo del movimiento (v_movimiento_efectos).
  cantidad       numeric(14, 3) not null check (cantidad <> 0),
  -- Lo que dice el papel del proveedor. El stock se calcula con `cantidad`, no con esto.
  cantidad_guia  numeric(14, 3),
  costo_unitario numeric(14, 2),
  observacion    text
);

create index movimiento_lineas_mov_idx      on movimiento_lineas (movimiento_id);
create index movimiento_lineas_articulo_idx on movimiento_lineas (articulo_id);

comment on column movimiento_lineas.cantidad_guia is
  'Lo declarado en la guía de despacho. Guardar ambos números es lo que permite '
  'reclamarle al proveedor y tener el saldo correcto al mismo tiempo.';

-- ---------------------------------------------------------------------------
-- Series: control individual solo en los artículos marcados
-- ---------------------------------------------------------------------------
create table series (
  id            uuid primary key default gen_random_uuid(),
  articulo_id   uuid not null references articulos (id),
  numero_serie  text not null check (length(trim(numero_serie)) > 0),
  estado        estado_serie not null default 'EN_BODEGA',
  bodega_id     uuid references bodegas (id),
  sala_id       uuid references salas_electricas (id),
  trabajador_id uuid references trabajadores (id),
  creado_en     timestamptz not null default now(),
  -- Única POR ARTÍCULO, no globalmente: dos fabricantes pueden repetir numeración.
  unique (articulo_id, numero_serie)
);

create index series_estado_idx   on series (articulo_id, estado);
create index series_numero_idx   on series (numero_serie);

create table movimiento_linea_series (
  linea_id uuid not null references movimiento_lineas (id) on delete cascade,
  serie_id uuid not null references series (id),
  primary key (linea_id, serie_id)
);

-- Una serie está disponible para salir si está en bodega, haya llegado por compra
-- (EN_BODEGA) o por devolución desde terreno (DEVUELTO).
create view v_series_disponibles with (security_invoker = true) as
  select * from series where estado in ('EN_BODEGA', 'DEVUELTO');

-- ---------------------------------------------------------------------------
-- Stock derivado
-- ---------------------------------------------------------------------------

-- Expande cada línea del libro en su efecto con signo sobre (artículo, bodega).
-- El TRASLADO aporta dos filas: resta en el origen y suma en el destino.
create view v_movimiento_efectos with (security_invoker = true) as
  select l.articulo_id, m.bodega_id, l.cantidad *
         case m.tipo
           when 'ENTRADA'    then  1
           when 'DEVOLUCION' then  1
           when 'AJUSTE'     then  1  -- `cantidad` ya viene con su propio signo
           else -1
         end as delta
    from movimiento_lineas l
    join movimientos m on m.id = l.movimiento_id
  union all
  select l.articulo_id, m.bodega_destino_id, l.cantidad
    from movimiento_lineas l
    join movimientos m on m.id = l.movimiento_id
   where m.tipo = 'TRASLADO';

-- LA VERDAD del stock. `stock_cache` debe coincidir siempre con esto.
create view v_stock_libro with (security_invoker = true) as
  select articulo_id, bodega_id, sum(delta)::numeric(14, 3) as cantidad
    from v_movimiento_efectos
   group by articulo_id, bodega_id;

-- Índice materializado del saldo. Cumple dos funciones: lectura instantánea y —
-- sobre todo — ser la fila que `registrar_movimiento` bloquea con FOR UPDATE para
-- serializar dos descuentos simultáneos del mismo artículo. Solo la escribe esa
-- función; nadie más tiene permiso.
create table stock_cache (
  articulo_id uuid not null references articulos (id) on delete cascade,
  bodega_id   uuid not null references bodegas (id) on delete cascade,
  cantidad    numeric(14, 3) not null default 0,
  primary key (articulo_id, bodega_id)
);

-- Reconstruye la caché desde el libro. Es la prueba de que la caché es derivable:
-- si después de correrla algún saldo cambia, había una inconsistencia.
-- Ojo con los nombres de las columnas de salida: en plpgsql son variables en
-- ámbito, y si se llamaran `articulo_id`/`bodega_id` chocarían con las columnas
-- reales dentro del `on conflict (...)` de más abajo ("column reference is
-- ambiguous"). Por eso van sin el sufijo `_id`.
create or replace function recalcular_stock()
returns table (articulo uuid, bodega uuid, antes numeric, ahora numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not es_admin() then
    raise exception 'Solo un Administrador puede recalcular el stock';
  end if;

  return query
  with libro as (select * from v_stock_libro),
  previo as (select s.articulo_id, s.bodega_id, s.cantidad from stock_cache s),
  borrado as (
    delete from stock_cache s
     where not exists (
       select 1 from libro l
        where l.articulo_id = s.articulo_id and l.bodega_id = s.bodega_id
     )
    returning s.articulo_id, s.bodega_id
  ),
  escrito as (
    insert into stock_cache (articulo_id, bodega_id, cantidad)
    select l.articulo_id, l.bodega_id, l.cantidad from libro l
    on conflict (articulo_id, bodega_id) do update set cantidad = excluded.cantidad
    returning stock_cache.articulo_id, stock_cache.bodega_id, stock_cache.cantidad
  )
  select e.articulo_id, e.bodega_id, p.cantidad, e.cantidad
    from escrito e
    left join previo p on p.articulo_id = e.articulo_id and p.bodega_id = e.bodega_id
   where p.cantidad is distinct from e.cantidad;
end;
$$;

-- Vista de consulta para las pantallas de Stock: saldo + datos del artículo + si
-- está bajo el mínimo.
create view v_stock with (security_invoker = true) as
  select a.id                as articulo_id,
         a.codigo_defontana,
         a.descripcion,
         a.tipo,
         a.unidad,
         a.marca,
         a.familia,
         a.controla_serie,
         a.stock_minimo,
         a.activo,
         b.id                as bodega_id,
         b.nombre            as bodega,
         coalesce(s.cantidad, 0) as cantidad,
         coalesce(s.cantidad, 0) < a.stock_minimo as bajo_minimo
    from articulos a
   cross join bodegas b
    left join stock_cache s on s.articulo_id = a.id and s.bodega_id = b.id
   where b.activo;
