-- ============================================================
-- Agrega un campo de orden manual a los documentos. Sin valor (null),
-- el orden por defecto es: documentos del Coordinador primero, luego
-- el resto por fecha de carga — eso se calcula en el cliente. Cuando
-- el Coordinador reordena manualmente un día, se asignan valores
-- explícitos aquí que tienen prioridad sobre ese cálculo por defecto.
-- ============================================================

alter table public.documentos add column if not exists orden integer;
