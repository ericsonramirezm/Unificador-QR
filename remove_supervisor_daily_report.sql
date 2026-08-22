-- ============================================================
-- Revoca el acceso del rol "supervisor" al módulo Daily Report
-- (ex "Parte Diario"). No basta con ocultar el ítem del menú (ver
-- Layout.tsx): si no se cambia también la política de RLS, un
-- supervisor podría seguir creando/editando partes_diarios llamando
-- a la API de Supabase directamente. Esto dejar solo a "coordinador"
-- y "apr" con permisos de creación/edición; "mandante" y "consultor"
-- no se tocan (ver add_partes_diarios.sql para el resto de políticas).
-- ============================================================

drop policy if exists "supervisor_apr_crear_partes" on public.partes_diarios;
create policy "apr_crear_partes" on public.partes_diarios
  for insert with check (
    public.usuario_rol_actual() = 'apr'
    and creado_por = auth.uid()
  );

drop policy if exists "supervisor_apr_ver_editar_propios" on public.partes_diarios;
create policy "apr_ver_propios" on public.partes_diarios
  for select using (
    public.usuario_rol_actual() = 'apr'
    and creado_por = auth.uid()
  );

drop policy if exists "supervisor_apr_actualizar_propios" on public.partes_diarios;
create policy "apr_actualizar_propios" on public.partes_diarios
  for update using (
    public.usuario_rol_actual() = 'apr'
    and creado_por = auth.uid()
  )
  with check (
    public.usuario_rol_actual() = 'apr'
    and creado_por = auth.uid()
  );

-- Nota: si algún supervisor ya creó partes_diarios antes de este cambio,
-- esas filas siguen existiendo (creado_por = ese supervisor), pero él ya
-- no podrá verlas ni editarlas — solo coordinador tiene acceso total.
-- Si necesitas que alguien "herede" esos reportes, dime y armamos un
-- UPDATE puntual de creado_por.
