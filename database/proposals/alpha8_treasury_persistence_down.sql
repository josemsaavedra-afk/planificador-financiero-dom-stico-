-- REVERSIÓN PROPUESTA ALPHA 8: NO EJECUTAR EN PRODUCCIÓN SIN AUTORIZACIÓN.
-- Solo es segura antes de que estas tablas contengan datos que deban conservarse.

begin;
drop table if exists public.treasury_reconciliations;
drop table if exists public.bank_statement_lines;
drop table if exists public.bank_statement_imports;
drop table if exists public.account_balance_checkpoints;
drop function if exists public.alpha8_protect_reconciliation_identity();
commit;
