-- =============================================================================
-- 0009 — Tipo ACTIVO, y el stock deja de ser un producto cartesiano
-- =============================================================================
-- Sin cambios respecto del original de Bodega: no toca `documentos` ni
-- `perfiles`.
--
-- Dos cambios que vienen del mismo sitio: abrir una segunda bodega.
--
--   1. Falta una categoría para los activos de oficina (mesas, sillas). Hoy una
--      silla se registra como material eléctrico.
--   2. `v_stock` hacía `articulos CROSS JOIN bodegas`, de modo que cada artículo
--      del catálogo aparecía una vez POR BODEGA ACTIVA, con saldo 0 en las que
--      nunca recibieron nada. Con una sola bodega no se notaba; con dos, la
--      pantalla de Stock se ve duplicada y el marcador cuenta el doble.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. El tipo ACTIVO
-- ---------------------------------------------------------------------------
-- OJO: Postgres no permite USAR un valor de enum recién agregado dentro de la
-- misma transacción en que se agrega. Por eso nada más abajo en este archivo
-- menciona 'ACTIVO' — la vista que se recrea no filtra por tipo. Si algún día
-- hace falta, va en una migración aparte.
alter type tipo_articulo add value if not exists 'ACTIVO';

comment on type tipo_articulo is
  'MATERIAL: material eléctrico de instalación. EPP: elementos de protección '
  'personal, los únicos que admite ENTREGA_EPP. ACTIVO: mobiliario y equipamiento '
  'de oficina — no se consume, se asigna, pero se recibe y se mueve igual que el '
  'resto, así que no necesita un tipo de movimiento propio.';

-- ---------------------------------------------------------------------------
-- 2. `v_stock`: una fila por saldo que existe de verdad
-- ---------------------------------------------------------------------------
-- Va con DROP + CREATE y no con CREATE OR REPLACE: las columnas conservan su
-- nombre y su orden, pero `coalesce(s.cantidad, 0)` daba un numeric sin precisión
-- y `s.cantidad` es numeric(14,3). CREATE OR REPLACE VIEW rechaza cambiar el tipo
-- de una columna, aunque sea solo el modificador.
drop view if exists v_stock;

-- Se parte de `stock_cache`, no de `articulos`: una fila de stock existe cuando
-- ese artículo tuvo movimiento en esa bodega. Consecuencias buscadas:
--
--   · Crear una bodega no agrega ninguna fila hasta que algo entre en ella.
--   · Un artículo con saldo en dos bodegas muestra dos filas — no es duplicación,
--     son dos saldos distintos, y para eso está la columna `bodega`.
--   · Un artículo del catálogo que nunca entró a ninguna bodega no aparece aquí.
--     Sigue en Catálogos → Artículos: esta vista es lo que HAY, no lo que está
--     fichado.
--   · Un artículo que se agotó conserva su fila en 0 y sigue avisando de que está
--     bajo el mínimo, que es exactamente el que hay que reponer.
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
         s.cantidad < a.stock_minimo as bajo_minimo
    from stock_cache s
    join articulos a on a.id = s.articulo_id
    join bodegas   b on b.id = s.bodega_id
   where b.activo;

comment on view v_stock is
  'Saldo por (artículo, bodega) sobre las bodegas activas. Se deriva de '
  '`stock_cache`, que a su vez debe cuadrar siempre con `v_stock_libro`. No es un '
  'listado del catálogo: si un artículo no aparece aquí es porque nunca entró a '
  'ninguna bodega.';

-- Reponer los permisos es OBLIGATORIO: el DROP se los llevó por delante. Es la
-- misma trampa que ya se pagó en 0007 al recrear `v_movimientos` — sin esto la
-- pantalla de Stock queda vacía sin explicar por qué.
grant select on v_stock to authenticated;
revoke all   on v_stock from anon;
