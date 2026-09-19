-- DOMUS 3.0 Alpha 13 - REVERSIÓN PROPUESTA. NO EJECUTAR EN PRODUCCIÓN SIN AUTORIZACIÓN.
-- DESTRUCTIVA: elimina los datos de las cuatro tablas. Solo ensayada en memoria.
-- En un entorno real requiere copia verificada y autorización específica.
begin;
drop table if exists public.treasury_reconciliations;
drop table if exists public.bank_statement_lines;
drop table if exists public.bank_statement_imports;
drop table if exists public.account_balance_checkpoints;
drop function if exists private.protect_treasury_reconciliation_identity();
drop function if exists private.stamp_treasury_audit();
commit;
