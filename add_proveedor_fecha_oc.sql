-- ============================================================
-- Agrega Proveedor y Fecha OC a Órdenes de Compra.
--
-- Mismo patrón que rq_numero/fecha_rq/codigo_defontana en
-- requisiciones (add_compras.sql): campos propios de la etapa OC,
-- llegan en blanco al avanzar desde Requisiciones y se completan a
-- mano en la pestaña Órdenes de Compra. No hace falta tocar la función
-- avanzar_rq_a_oc() — al no listarlas en su INSERT, quedan NULL por
-- defecto, igual que ya pasa con oc_numero.
-- ============================================================

alter table public.ordenes_compra add column if not exists proveedor text;
alter table public.ordenes_compra add column if not exists fecha_oc date;
