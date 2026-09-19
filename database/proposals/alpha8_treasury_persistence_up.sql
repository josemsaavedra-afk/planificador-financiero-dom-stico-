-- PROPUESTA ALPHA 8: NO EJECUTAR SIN AUDITORÍA Y AUTORIZACIÓN EXPRESA.
-- Requiere confirmar que las claves de households, accounts y movement_series son uuid.

begin;

create table public.account_balance_checkpoints (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  account_id uuid not null references public.accounts(id),
  balance_date date not null,
  balance numeric(14,2) not null,
  currency text not null default 'EUR' check (currency = 'EUR'),
  source text not null check (source in ('manual','bank_statement')),
  note text,
  created_by uuid not null references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (account_id, balance_date, source)
);

create table public.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  account_id uuid not null references public.accounts(id),
  file_name text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  period_start date,
  period_end date,
  line_count integer not null check (line_count >= 0),
  imported_by uuid not null references auth.users(id) default auth.uid(),
  imported_at timestamptz not null default now(),
  unique (household_id, account_id, content_sha256)
);

create table public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.bank_statement_imports(id),
  line_ordinal integer not null check (line_ordinal > 0),
  transaction_date date not null,
  concept text not null,
  reference text,
  signed_amount numeric(14,2) not null check (signed_amount <> 0),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (import_id, line_ordinal),
  unique (import_id, content_sha256)
);

create table public.treasury_reconciliations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  statement_line_id uuid not null references public.bank_statement_lines(id),
  movement_series_id uuid not null references public.movement_series(id),
  occurrence_date date not null,
  status text not null check (status in ('confirmed','revoked')),
  match_score smallint check (match_score between 0 and 100),
  confirmed_by uuid not null references auth.users(id) default auth.uid(),
  confirmed_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  revocation_reason text,
  check ((status = 'confirmed' and revoked_at is null and revoked_by is null) or (status = 'revoked' and revoked_at is not null and revoked_by is not null and nullif(trim(revocation_reason),'') is not null))
);

create unique index treasury_reconciliations_active_line_uq on public.treasury_reconciliations(statement_line_id) where status = 'confirmed';
create unique index treasury_reconciliations_active_movement_uq on public.treasury_reconciliations(movement_series_id, occurrence_date) where status = 'confirmed';
create index account_balance_checkpoints_lookup_idx on public.account_balance_checkpoints(account_id, balance_date desc);
create index bank_statement_imports_household_idx on public.bank_statement_imports(household_id, imported_at desc);
create index bank_statement_lines_import_idx on public.bank_statement_lines(import_id, transaction_date, line_ordinal);
create index treasury_reconciliations_household_idx on public.treasury_reconciliations(household_id, confirmed_at desc);

create function public.alpha8_protect_reconciliation_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id <> old.id
    or new.household_id <> old.household_id
    or new.statement_line_id <> old.statement_line_id
    or new.movement_series_id <> old.movement_series_id
    or new.occurrence_date <> old.occurrence_date
    or new.confirmed_by <> old.confirmed_by
    or new.confirmed_at <> old.confirmed_at
    or new.match_score is distinct from old.match_score then
    raise exception 'Una conciliación confirmada solo puede revocarse; su identidad es inmutable';
  end if;
  return new;
end;
$$;

revoke execute on function public.alpha8_protect_reconciliation_identity() from public, anon, authenticated;
create trigger alpha8_protect_reconciliation_identity before update on public.treasury_reconciliations for each row execute function public.alpha8_protect_reconciliation_identity();

alter table public.account_balance_checkpoints enable row level security;
alter table public.bank_statement_imports enable row level security;
alter table public.bank_statement_lines enable row level security;
alter table public.treasury_reconciliations enable row level security;

create policy account_balance_checkpoints_select on public.account_balance_checkpoints for select to authenticated using (exists (select 1 from public.household_members hm where hm.household_id = account_balance_checkpoints.household_id and hm.user_id = (select auth.uid())));
create policy account_balance_checkpoints_insert on public.account_balance_checkpoints for insert to authenticated with check (created_by = (select auth.uid()) and exists (select 1 from public.household_members hm join public.accounts a on a.household_id = hm.household_id where hm.household_id = account_balance_checkpoints.household_id and hm.user_id = (select auth.uid()) and a.id = account_balance_checkpoints.account_id));

create policy bank_statement_imports_select on public.bank_statement_imports for select to authenticated using (exists (select 1 from public.household_members hm where hm.household_id = bank_statement_imports.household_id and hm.user_id = (select auth.uid())));
create policy bank_statement_imports_insert on public.bank_statement_imports for insert to authenticated with check (imported_by = (select auth.uid()) and exists (select 1 from public.household_members hm join public.accounts a on a.household_id = hm.household_id where hm.household_id = bank_statement_imports.household_id and hm.user_id = (select auth.uid()) and a.id = bank_statement_imports.account_id));

create policy bank_statement_lines_select on public.bank_statement_lines for select to authenticated using (exists (select 1 from public.bank_statement_imports bi join public.household_members hm on hm.household_id = bi.household_id where bi.id = bank_statement_lines.import_id and hm.user_id = (select auth.uid())));
create policy bank_statement_lines_insert on public.bank_statement_lines for insert to authenticated with check (exists (select 1 from public.bank_statement_imports bi join public.household_members hm on hm.household_id = bi.household_id where bi.id = bank_statement_lines.import_id and hm.user_id = (select auth.uid())));

create policy treasury_reconciliations_select on public.treasury_reconciliations for select to authenticated using (exists (select 1 from public.household_members hm where hm.household_id = treasury_reconciliations.household_id and hm.user_id = (select auth.uid())));
create policy treasury_reconciliations_insert on public.treasury_reconciliations for insert to authenticated with check (confirmed_by = (select auth.uid()) and status = 'confirmed' and exists (select 1 from public.household_members hm join public.movement_series ms on ms.household_id = hm.household_id join public.bank_statement_lines bsl on bsl.id = treasury_reconciliations.statement_line_id join public.bank_statement_imports bsi on bsi.id = bsl.import_id and bsi.household_id = hm.household_id where hm.household_id = treasury_reconciliations.household_id and hm.user_id = (select auth.uid()) and ms.id = treasury_reconciliations.movement_series_id));
create policy treasury_reconciliations_update on public.treasury_reconciliations for update to authenticated using (status = 'confirmed' and exists (select 1 from public.household_members hm where hm.household_id = treasury_reconciliations.household_id and hm.user_id = (select auth.uid()))) with check (status = 'revoked' and revoked_by = (select auth.uid()) and exists (select 1 from public.household_members hm where hm.household_id = treasury_reconciliations.household_id and hm.user_id = (select auth.uid())));

grant select, insert on public.account_balance_checkpoints to authenticated;
grant select, insert on public.bank_statement_imports to authenticated;
grant select, insert on public.bank_statement_lines to authenticated;
grant select, insert, update on public.treasury_reconciliations to authenticated;

commit;
