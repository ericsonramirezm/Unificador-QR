-- =============================================================================
-- 0002 — Permisos: RLS y grants
-- =============================================================================
-- Adaptado del original: no hay tabla `perfiles` que proteger (ver 0001) — el
-- rol y los permisos de Bodega ahora viven en `usuarios`, cuya propia RLS es
-- de Unificador-QR y no se toca desde este set de migraciones. `documentos`
-- pasa a `bodega_documentos` en línea con el renombre de 0001.
--
-- Los permisos viven en la base, no en la interfaz. Ocultar un botón no es un
-- control: sin esto, cualquiera con la URL y la consola del navegador escribe.
--
-- AJUSTE DE SEGURIDAD respecto del original de Bodega, más allá del renombre
-- de tabla: las políticas de LECTURA del original decían
-- `for select to authenticated using (true)`. Eso era seguro en el proyecto
-- Supabase original de Bodega, donde "authenticated" equivalía a "tiene cuenta
-- en Bodega" (las cuentas se invitaban una por una). Fusionado dentro de
-- Unificador-QR, "authenticated" pasa a significar "cualquier usuario de
-- Unificador-QR" — un APR o un Supervisor sin ningún vínculo con Bodega
-- también calificarían, y `using (true)` les dejaría leer todo el inventario
-- por API directa aunque la interfaz nunca les muestre la pestaña. Por eso
-- aquí el criterio de lectura pasa a ser `mi_rol_bodega() is not null`: solo
-- alguien con ALGÚN rol de Bodega (el que sea) puede leer, igual que ya exige
-- `puede_mover()`/`puede_entregar_epp()` para escribir. Dentro de eso, los
-- cuatro roles de Bodega siguen viendo todo por igual — no hay información
-- compartimentada entre ellos, que es la parte que si conservó el original.
--
-- Regla estructural: NADIE puede escribir el libro directamente. `movimientos`,
-- `movimiento_lineas`, `series`, `movimiento_linea_series` y `stock_cache` no
-- tienen ninguna política de INSERT/UPDATE/DELETE — la única vía es la función
-- `registrar_movimiento` (SECURITY DEFINER), donde viven las validaciones de
-- saldo, series y rol. Si el frontend intenta un INSERT, falla, y así debe ser.
-- =============================================================================

alter table bodegas                 enable row level security;
alter table articulos               enable row level security;
alter table proveedores             enable row level security;
alter table salas_electricas        enable row level security;
alter table trabajadores            enable row level security;
alter table bodega_documentos       enable row level security;
alter table movimientos             enable row level security;
alter table movimiento_lineas       enable row level security;
alter table series                  enable row level security;
alter table movimiento_linea_series enable row level security;
alter table stock_cache             enable row level security;

-- ---------------------------------------------------------------------------
-- Lectura: los cuatro roles de Bodega ven todo. No hay información
-- compartimentada entre ellos — un bodeguero que no puede ver el stock no
-- puede trabajar. Pero SÍ hay compartimentación frente al resto de
-- Unificador-QR: `mi_rol_bodega() is not null` exige tener algún rol de
-- Bodega (ver el ajuste de seguridad documentado arriba).
-- ---------------------------------------------------------------------------
create policy leer_bodegas                 on bodegas                 for select to authenticated using (mi_rol_bodega() is not null);
create policy leer_articulos               on articulos               for select to authenticated using (mi_rol_bodega() is not null);
create policy leer_proveedores             on proveedores             for select to authenticated using (mi_rol_bodega() is not null);
create policy leer_salas                   on salas_electricas        for select to authenticated using (mi_rol_bodega() is not null);
create policy leer_trabajadores            on trabajadores            for select to authenticated using (mi_rol_bodega() is not null);
create policy leer_bodega_documentos       on bodega_documentos       for select to authenticated using (mi_rol_bodega() is not null);
create policy leer_movimientos             on movimientos             for select to authenticated using (mi_rol_bodega() is not null);
create policy leer_movimiento_lineas       on movimiento_lineas       for select to authenticated using (mi_rol_bodega() is not null);
create policy leer_series                  on series                  for select to authenticated using (mi_rol_bodega() is not null);
create policy leer_movimiento_linea_series on movimiento_linea_series for select to authenticated using (mi_rol_bodega() is not null);
create policy leer_stock_cache             on stock_cache             for select to authenticated using (mi_rol_bodega() is not null);

-- ---------------------------------------------------------------------------
-- Catálogos: solo el Administrador los mantiene
-- ---------------------------------------------------------------------------
create policy admin_bodegas      on bodegas          for all to authenticated using (es_admin()) with check (es_admin());
create policy admin_articulos    on articulos        for all to authenticated using (es_admin()) with check (es_admin());
create policy admin_proveedores  on proveedores      for all to authenticated using (es_admin()) with check (es_admin());
create policy admin_salas        on salas_electricas for all to authenticated using (es_admin()) with check (es_admin());
create policy admin_trabajadores on trabajadores     for all to authenticated using (es_admin()) with check (es_admin());

-- ---------------------------------------------------------------------------
-- Documentos: los crea quien puede mover inventario, porque una guía de despacho
-- se registra en el mismo acto que la recepción. No se editan ni se borran: son
-- el respaldo de una entrada que ya está en el libro.
-- ---------------------------------------------------------------------------
create policy crear_bodega_documentos on bodega_documentos for insert to authenticated
  with check (puede_mover() and creado_por = auth.uid());

create policy admin_bodega_documentos on bodega_documentos for update to authenticated
  using (es_admin()) with check (es_admin());

-- ---------------------------------------------------------------------------
-- Grants: el rol `authenticated` no debe siquiera tener el privilegio de escribir
-- el libro. RLS sin esto igual lo bloquearía, pero un privilegio que no existe es
-- más difícil de conceder por accidente en una migración futura.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on movimientos             from authenticated;
revoke insert, update, delete on movimiento_lineas       from authenticated;
revoke insert, update, delete on series                  from authenticated;
revoke insert, update, delete on movimiento_linea_series from authenticated;
revoke insert, update, delete on stock_cache             from authenticated;

-- Un movimiento no se edita ni se borra nunca, ni siquiera siendo Administrador:
-- corregir es registrar el movimiento inverso. Ni el rol de servicio debería
-- necesitarlo, pero se deja explícito para que la intención quede escrita.
comment on table movimientos is
  'Libro inmutable. No se edita ni se borra: corregir = registrar el movimiento '
  'inverso, que queda a la vista en la línea de tiempo.';
