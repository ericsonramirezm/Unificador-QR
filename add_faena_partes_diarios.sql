-- ============================================================
-- Divide los Daily Report del contrato 12501191 en dos faenas: Las
-- Tórtolas (LT) y Los Bronces (LB).
--
-- El correlativo de "Report N°" sigue siendo único y compartido entre
-- ambas faenas (obtener_siguiente_numero_parte no cambia). Lo que se
-- divide es la cadena de acumulados de HH: cada faena corre su propia
-- suma corrida (hh_directas_acumuladas / hm_acumuladas /
-- hh_indirectas_acumuladas), calculada en la app a partir del último
-- parte de la MISMA faena, no del último del contrato completo. El total
-- general del contrato se obtiene sumando el último acumulado de cada
-- faena (ver ParteDiarioList.tsx) — no hace falta guardarlo aparte.
--
-- Los reportes ya existentes (creados antes de este cambio) se migran
-- todos a 'LT', ya que es lo único que se ha usado hasta ahora (el
-- archivo de muestra del cliente traía el sufijo "_LT").
-- ============================================================

alter table public.partes_diarios
  add column if not exists faena text not null default 'LT'
    check (faena in ('LT', 'LB'));

comment on column public.partes_diarios.faena is
  'Las Tórtolas (LT) o Los Bronces (LB). Define, en la app, el mínimo de HH x actividad para enviar y "HH por Día" (J9 del Excel) — ver HH_TURNO_POR_FAENA en src/types/index.ts.';
