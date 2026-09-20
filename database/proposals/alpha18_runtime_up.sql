-- PROPUESTA ADITIVA sobre alpha16_prerc_up.sql. SOLO entornos aislados autorizados.
-- El ejecutor NO es una identidad del navegador ni un rol que se conceda a authenticated.
begin;
create role domus_treasury_executor nologin nosuperuser nobypassrls inherit;
grant authenticated to domus_treasury_executor;
create table private.treasury_operation_receipts (
  actor_id uuid not null references auth.users(id) on delete restrict,
  household_id uuid not null references public.households(id) on delete restrict,
  operation_id uuid not null,
  request jsonb not null,
  response jsonb not null,
  committed_at timestamptz not null default statement_timestamp(),
  primary key(actor_id, household_id, operation_id)
);
revoke all on private.treasury_operation_receipts from public, anon, authenticated;
grant select, insert on private.treasury_operation_receipts to domus_treasury_executor;
alter table private.treasury_operation_receipts enable row level security;
create policy treasury_receipts_actor on private.treasury_operation_receipts
  to domus_treasury_executor
  using (actor_id = (select auth.uid()) and private.is_household_member(household_id))
  with check (actor_id = (select auth.uid()) and private.is_household_member(household_id));

alter table public.movement_series add column treasury_revision integer not null default 1 check(treasury_revision>0);
alter table public.movement_occurrence_states add column treasury_revision integer not null default 1 check(treasury_revision>0);
alter table public.treasury_reconciliations add column treasury_revision integer not null default 1 check(treasury_revision>0);
create sequence private.treasury_revision_seq as integer start with 2;
revoke all on sequence private.treasury_revision_seq from public, anon, authenticated;
grant usage on sequence private.treasury_revision_seq to authenticated;

-- Every mutation of a source takes the SAME transaction lock as the API. This
-- closes the read/check/write race even for source edits outside the runtime.
-- Revisions cannot be supplied/reset by clients; a no-op edit still advances them.
create function private.advance_treasury_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
declare household uuid; next_household uuid;
begin
  if tg_op='INSERT' then
    new.treasury_revision:=nextval('private.treasury_revision_seq');
    return new;
  end if;
  if tg_table_name='movement_occurrence_states' then
    select household_id into household from public.movement_series where id=old.series_id;
    if tg_op<>'DELETE' then
      select household_id into next_household from public.movement_series where id=new.series_id;
    end if;
  else
    household:=old.household_id;
    if tg_op<>'DELETE' then next_household:=new.household_id; end if;
  end if;
  if household is not null then perform pg_advisory_xact_lock(hashtextextended(household::text,18)); end if;
  if next_household is not null and next_household is distinct from household then
    perform pg_advisory_xact_lock(hashtextextended(next_household::text,18));
  end if;
  if tg_op='DELETE' then return old; end if;
  new.treasury_revision:=nextval('private.treasury_revision_seq');
  return new;
end;
$$;
revoke all on function private.advance_treasury_revision() from public, anon, authenticated;
create trigger advance_treasury_revision before insert or update or delete on public.movement_series
for each row execute function private.advance_treasury_revision();
create trigger advance_treasury_revision before insert or update or delete on public.movement_occurrence_states
for each row execute function private.advance_treasury_revision();
create trigger advance_treasury_revision before insert or update or delete on public.treasury_reconciliations
for each row execute function private.advance_treasury_revision();
commit;
