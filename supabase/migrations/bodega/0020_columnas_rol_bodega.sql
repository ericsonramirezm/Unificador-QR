-- =============================================================================
-- 0020 — Columnas de Bodega en `usuarios` (fusión con Unificador-QR)
-- =============================================================================
-- Fase 0 del plan de fusión: agrega a la tabla `usuarios` de Unificador-QR
-- (que YA EXISTE, creada fuera de este set de migraciones, mucho antes de
-- que Bodega existiera) las dos columnas que el módulo de Bodega necesita
-- para vivir ahí en vez de en su propia tabla `perfiles` (que este set
-- adaptado nunca crea — ver 0001).
--
-- `rol_bodega` y `bodega_actual_id` nacen NULL para cualquier usuario,
-- existente o nuevo. El alta de usuario en Unificador-QR es client-driven, no
-- por trigger sobre `auth.users` (confirmado leyendo `add_registro_usuarios.sql`,
-- `fix_rls_recursion.sql` y `fix_seguridad_qa.sql` en la raíz del proyecto): el
-- frontend llama `auth.signUp()` y hace, justo después, un INSERT explícito en
-- `usuarios` que nunca menciona estas dos columnas — quedan NULL por sí solas.
-- Nadie nace con acceso a Bodega. Un Administrador de Bodega ya existente se
-- lo asigna a otro con `fijar_rol_bodega`.
--
-- NO se crea ningún trigger sobre `auth.users`. El original de Bodega
-- (`crear_perfil_al_registrarse`, en su propio 0001_esquema.sql) se dejó
-- fuera del set adaptado por completo: si se portara, insertaría una fila en
-- `usuarios` ANTES del INSERT explícito del cliente, y ese segundo INSERT
-- fallaría por clave duplicada (`usuarios_pkey`) — rompiendo el alta de
-- CUALQUIER usuario nuevo de Unificador-QR, no solo los de Bodega.
--
-- Tipo reusado, no uno nuevo: `rol_usuario` ya lo crea 0001 de este mismo set
-- para las funciones internas de rol (`mi_rol_bodega`/`es_admin`/
-- `puede_mover`/`puede_entregar_epp`), con los mismos cuatro valores que ya
-- usa el frontend (`RolBodega` en `src/types/index.ts`:
-- ADMIN/BODEGUERO/CONSULTA/PREVENCIONISTA). Crear aquí un segundo enum con
-- los mismos valores sería redundante, y de hecho un segundo `create type
-- rol_usuario` en este archivo fallaría de verdad: el tipo ya existe desde
-- 0001 de este mismo set adaptado. Unificador-QR no tiene HOY ningún tipo
-- Postgres propio para `usuarios.rol`/`usuarios.estado` (son `text` con
-- `check`, confirmado revisando `add_partes_diarios.sql` y el resto de los
-- `.sql` de la raíz del proyecto — cero `create type` en todo el repo), así
-- que tampoco hay colisión real con nada existente.
-- =============================================================================

alter table public.usuarios
  add column rol_bodega rol_usuario null,
  add column bodega_actual_id uuid null references public.bodegas (id);

comment on column public.usuarios.rol_bodega is
  'Rol dentro del módulo Bodega — coexiste con `usuarios.rol` (el rol general '
  'de Unificador-QR), no se combinan en un único valor: un coordinador puede '
  'necesitar ser además ADMIN de Bodega, y un consultor general podría ser '
  'BODEGUERO. NULL = sin acceso a Bodega. Se lee vía `mi_rol_bodega()` '
  '(0001), SECURITY DEFINER para no recursar en RLS — mismo patrón que ya usa '
  '`usuario_rol_actual()` de Unificador-QR (fix_rls_recursion.sql) para el rol '
  'general.';

comment on column public.usuarios.bodega_actual_id is
  'La bodega que el usuario eligió al entrar al módulo Bodega. NULL hasta su '
  'próximo ingreso, que es cuando se le debe preguntar (pantalla ElegirBodega '
  'de Bodega.tsx). Se fija con `fijar_bodega_actual` (0012), nunca con un '
  'UPDATE directo — RLS es por fila, no por columna.';

-- ---------------------------------------------------------------------------
-- fijar_rol_bodega: la única puerta para que alguien le cambie el rol de
-- Bodega a OTRO usuario.
-- ---------------------------------------------------------------------------
-- Mismo problema que ya resolvió Bodega dos veces (`fijar_foto_articulo` en
-- 0010, `fijar_bodega_actual` en 0012): RLS es por fila, no por columna. Un
-- ADMIN de Bodega (`rol_bodega = 'ADMIN'`) no es necesariamente
-- `rol = 'coordinador'` en el dominio general de Unificador-QR, así que la
-- política `coordinador_actualizar_usuarios` (fix_rls_recursion.sql /
-- fix_seguridad_qa.sql) no le da ningún permiso sobre la fila de otro
-- usuario.
--
-- Decisión de esta fase: SOLO un ADMIN de Bodega puede llamar esta función —
-- no se amplía a "o un coordinador general", para no acoplar el módulo de
-- Bodega al sistema de roles general de Unificador-QR (mismo espíritu de la
-- sección 2 del plan de fusión: `rol` y `rol_bodega` son columnas separadas a
-- propósito, no un enum combinado). Un coordinador general que además sea
-- ADMIN de Bodega puede igual llamarla — por ser ADMIN de Bodega, no por ser
-- coordinador. Si más adelante hace falta que un coordinador general pueda
-- arrancar el módulo sin depender de un ADMIN de Bodega ya existente, es una
-- decisión nueva y explícita, no una ampliación silenciosa de esta función.
--
-- Consecuencia a tener presente (mismo bootstrapping que ya documenta
-- Bodega/CLAUDE.md para su primer Administrador original): el PRIMER ADMIN
-- de Bodega en Unificador-QR no puede autoasignarse desde la app — nadie
-- tiene `rol_bodega = 'ADMIN'` todavía para llamar a esta función. Se fija
-- una vez, a mano, con:
--   update public.usuarios set rol_bodega = 'ADMIN' where email = '...';
-- desde el SQL Editor — igual que ya se hace hoy para el primer Coordinador
-- de Unificador-QR.
create or replace function fijar_rol_bodega(p_usuario uuid, p_rol rol_usuario)
returns public.usuarios
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario public.usuarios%rowtype;
begin
  if not es_admin() then
    raise exception 'Solo un Administrador de Bodega puede asignar el rol de Bodega de otro usuario.';
  end if;

  update public.usuarios set rol_bodega = p_rol where id = p_usuario
  returning * into v_usuario;

  if not found then
    raise exception 'Ese usuario no existe.';
  end if;

  return v_usuario;
end;
$$;

comment on function fijar_rol_bodega(uuid, rol_usuario) is
  'Única puerta para cambiar el rol_bodega de OTRO usuario. Solo puede '
  'llamarla quien ya tiene rol_bodega = ADMIN (no un coordinador general sin '
  'ese rol — decisión documentada arriba). Pasar null en p_rol le quita el '
  'acceso a Bodega a ese usuario.';

revoke execute on function fijar_rol_bodega(uuid, rol_usuario) from public, anon;
grant  execute on function fijar_rol_bodega(uuid, rol_usuario) to authenticated;
