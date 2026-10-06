-- SOLO rollback de instalación vacía. Nunca elimina recibos ni historial.
begin;
do $$ begin
  if exists(select 1 from private.treasury_operation_receipts)
    or exists(select 1 from public.treasury_reconciliations)
    or exists(select 1 from public.bank_statement_imports)
    or exists(select 1 from public.account_balance_checkpoints)
    or exists(select 1 from public.movement_series where treasury_revision<>1)
    or exists(select 1 from public.movement_occurrence_states where treasury_revision<>1) then
    raise exception 'Rollback rechazado: existe historial';
  end if;
end $$;
drop trigger advance_treasury_revision on public.movement_series;
drop trigger advance_treasury_revision on public.movement_occurrence_states;
drop trigger advance_treasury_revision on public.treasury_reconciliations;
drop function private.advance_treasury_revision();
drop sequence private.treasury_revision_seq;
alter table public.movement_series drop column treasury_revision;
alter table public.movement_occurrence_states drop column treasury_revision;
alter table public.treasury_reconciliations drop column treasury_revision;
drop table private.treasury_operation_receipts;
revoke authenticated from domus_treasury_executor;
drop role domus_treasury_executor;
commit;
