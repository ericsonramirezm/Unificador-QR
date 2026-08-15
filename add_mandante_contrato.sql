-- ============================================================
-- Agrega el campo "mandante" (empresa dueña del proyecto) y separa ese
-- concepto del "nombre" del contrato, que ahora describe el proyecto.
-- ============================================================

alter table public.contratos add column if not exists mandante text;

update public.contratos
set
  codigo = '12501191',
  nombre = 'Sistema de Upgrade SPCI Salas Eléctricas LB (Etapa II - 2026)',
  mandante = 'Anglo American S.A.'
where codigo = 'AA-12501191';
