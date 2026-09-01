-- =============================================================================
-- 0014 — El bodeguero puede CREAR proveedores, no modificarlos
-- =============================================================================
-- Sin cambios respecto del original de Bodega: no toca `documentos`,
-- `perfiles` ni `mi_rol()` — usa `puede_mover()`, que ya apunta a
-- `usuarios.rol_bodega` desde 0001.
--
-- Las migraciones 0001–0013 ya están aplicadas: esto va aparte, no editando aquéllas.
--
-- Recepción tiene un botón "+ Nuevo proveedor" para "Compra a proveedor", usable
-- por cualquier rol que pueda registrar una ENTRADA (ver `puede_mover()`), pero
-- `proveedores` solo tenía la política `admin_proveedores` (0002): un Bodeguero
-- que lo usaba chocaba con RLS y recibía el error de Postgres, sin poder seguir.
--
-- Mismo patrón que `crear_articulos_al_recibir` en 0007: el permiso se amplía
-- solo a INSERT. Modificar y desactivar siguen siendo del Administrador (política
-- `admin_proveedores`), que es la parte que de verdad importa proteger. Las
-- políticas permisivas se suman con OR, así que esta convive con la de
-- administrador sin quitarle nada.
create policy crear_proveedores_al_recibir on proveedores
  for insert to authenticated
  with check (puede_mover());
