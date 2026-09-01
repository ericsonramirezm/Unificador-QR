-- =============================================================================
-- 0016 — Formato de RUT: 00.000.000-0
-- =============================================================================
-- Sin cambios respecto del original de Bodega: no toca `documentos`,
-- `perfiles`, `mi_rol()` ni `usuarios`.
--
-- Las migraciones 0001–0015 ya están aplicadas: esto va aparte.
--
-- `proveedores.rut` es único (índice parcial, 0001) y `trabajadores.rut` es único
-- y obligatorio, pero hasta ahora se guardaba tal cual se tecleara — "12345678-9"
-- y "12.345.678-9" son la misma persona pero pasaban la unicidad como si fueran
-- dos distintas. Mismo patrón que `normalizar_codigo_defontana`: una función que
-- reformatea antes de guardar, para que la base sea la fuente de verdad y no
-- dependa de que el cliente lo haga bien. Solo formatea — no valida el dígito
-- verificador (módulo 11), que no se pidió.
-- =============================================================================

create or replace function formatear_rut(p_rut text)
returns text
language plpgsql
as $$
declare
  v_limpio  text;
  v_cuerpo  text;
  v_dv      text;
  v_resultado text := '';
  v_len     int;
  i         int;
begin
  if p_rut is null then
    return null;
  end if;

  v_limpio := upper(regexp_replace(p_rut, '[^0-9kK]', '', 'g'));
  if length(v_limpio) < 2 then
    return v_limpio;
  end if;

  v_cuerpo := left(v_limpio, length(v_limpio) - 1);
  v_dv     := right(v_limpio, 1);
  v_len    := length(v_cuerpo);

  -- Un punto cada 3 dígitos desde la derecha, carácter a carácter — nada de
  -- regexp_replace con lookahead, para no depender de que el motor de
  -- expresiones regulares de Postgres lo soporte igual que JavaScript.
  for i in 1..v_len loop
    v_resultado := v_resultado || substr(v_cuerpo, i, 1);
    if (v_len - i) % 3 = 0 and i <> v_len then
      v_resultado := v_resultado || '.';
    end if;
  end loop;

  return v_resultado || '-' || v_dv;
end;
$$;

comment on function formatear_rut(text) is
  'Normaliza un RUT a "00.000.000-0" sin importar cómo se haya tecleado. Solo '
  'formatea; no valida el dígito verificador.';

create or replace function normalizar_rut()
returns trigger
language plpgsql
as $$
begin
  new.rut := formatear_rut(new.rut);
  return new;
end;
$$;

create trigger proveedores_normalizar_rut
  before insert or update of rut on proveedores
  for each row execute function normalizar_rut();

create trigger trabajadores_normalizar_rut
  before insert or update of rut on trabajadores
  for each row execute function normalizar_rut();
