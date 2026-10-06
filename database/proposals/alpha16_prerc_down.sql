-- DOMUS 3.0 Alpha 16 PRE-RC - REVERSIÓN PROPUESTA. NO EJECUTAR EN PRODUCCIÓN SIN AUTORIZACIÓN.
-- Solo permite revertir una instalacion vacia. Con historial, conservar esquema y datos.
-- En un entorno real requiere copia verificada y autorización específica.
begin;
do $$ begin
 if exists(select 1 from public.account_balance_checkpoints) or exists(select 1 from public.bank_statement_imports)
 or exists(select 1 from public.bank_statement_lines) or exists(select 1 from public.treasury_reconciliations) then
 raise exception 'Rollback bloqueado: existe historial de Tesoreria'; end if;
end $$;
drop table if exists public.treasury_reconciliations;
drop table if exists public.bank_statement_lines;
drop table if exists public.bank_statement_imports;
drop table if exists public.account_balance_checkpoints;
drop function if exists private.protect_treasury_reconciliation_identity();
drop function if exists private.stamp_treasury_audit();
drop function if exists private.bind_treasury_account();
alter table public.movement_series drop constraint treasury_series_account_fk;
alter table public.movement_series drop constraint treasury_series_identity_uq;
alter table public.accounts drop constraint treasury_accounts_identity_uq;
commit;
