-- DOMUS 3.0 Alpha 10 - REVERSIÓN PROPUESTA. NO EJECUTAR EN PRODUCCIÓN SIN AUTORIZACIÓN.
begin;
drop table if exists public.treasury_reconciliations;
drop table if exists public.bank_statement_lines;
drop table if exists public.bank_statement_imports;
drop table if exists public.account_balance_checkpoints;
drop function if exists private.protect_treasury_reconciliation_identity();
commit;
