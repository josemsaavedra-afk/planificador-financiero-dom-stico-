-- DOMUS 3.0 Alpha 16 PRE-RC
-- PROPUESTA DE MIGRACION. NO EJECUTAR EN PRODUCCION SIN AUTORIZACION EXPRESA.
-- Propuesta unica para INSTALACION NUEVA. Sustituye Alpha 10/12/13; no aplicar juntas.
-- Derivada de su contrato documentado; requiere cotejar el esquema real y sus RLS.
-- Probada solo en PostgreSQL en memoria con fixtures ficticios.

begin;

create table public.account_balance_checkpoints (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  balance_date date not null,
  balance numeric(14,2) not null,
  currency text not null default 'EUR' check (currency = 'EUR'),
  source text not null check (source in ('manual','bank_statement')),
  note text,
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  unique (account_id, balance_date, source)
);

create table public.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  file_name text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  period_start date,
  period_end date,
  line_count integer not null check (line_count >= 0),
  imported_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  imported_at timestamptz not null default now(),
  check (period_start is null or period_end is null or period_end >= period_start),
  unique (household_id, account_id, content_sha256)
);

create table public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.bank_statement_imports(id) on delete restrict,
  line_ordinal integer not null check (line_ordinal > 0),
  transaction_date date not null,
  concept text not null,
  reference text,
  signed_amount numeric(14,2) not null check (signed_amount <> 0),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (import_id, line_ordinal)
);

create table public.treasury_reconciliations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete restrict,
  statement_line_id uuid not null references public.bank_statement_lines(id) on delete restrict,
  movement_series_id uuid not null references public.movement_series(id) on delete restrict,
  occurrence_date date not null,
  status text not null default 'confirmed' check (status in ('confirmed','revoked')),
  match_score smallint check (match_score between 0 and 100),
  confirmed_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  confirmed_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  revocation_reason text,
  foreign key (movement_series_id, occurrence_date)
    references public.movement_occurrence_states(series_id, occurrence_date) on delete restrict,
  check (
    (status = 'confirmed' and revoked_at is null and revoked_by is null and revocation_reason is null)
    or
    (status = 'revoked' and revoked_at is not null and revoked_by is not null
      and nullif(trim(revocation_reason),'') is not null)
  )
);

create unique index treasury_reconciliations_active_line_uq
  on public.treasury_reconciliations(statement_line_id)
  where status = 'confirmed';

create unique index treasury_reconciliations_active_occurrence_uq
  on public.treasury_reconciliations(movement_series_id, occurrence_date)
  where status = 'confirmed';

create index account_balance_checkpoints_lookup_idx
  on public.account_balance_checkpoints(account_id, balance_date desc);

create index bank_statement_imports_household_idx
  on public.bank_statement_imports(household_id, imported_at desc);

create index bank_statement_lines_import_idx
  on public.bank_statement_lines(import_id, transaction_date, line_ordinal);

create index treasury_reconciliations_household_idx
  on public.treasury_reconciliations(household_id, confirmed_at desc);

create function private.protect_treasury_reconciliation_identity()
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
    raise exception 'Una conciliacion confirmada solo puede revocarse; su identidad es inmutable';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_treasury_reconciliation_identity()
from public, anon, authenticated;

create trigger protect_treasury_reconciliation_identity
before update on public.treasury_reconciliations
for each row
execute function private.protect_treasury_reconciliation_identity();


-- A fingerprint identifies content, not a bank transaction: identical lines retain distinct ordinals.
create index bank_statement_lines_content_idx on public.bank_statement_lines(import_id, content_sha256);

create function private.stamp_treasury_audit()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Sesion requerida' using errcode = '42501'; end if;
  if tg_table_name = 'account_balance_checkpoints' then
    if new.created_by is distinct from actor then raise exception 'Autor no valido' using errcode = '42501'; end if;
    new.created_at := statement_timestamp();
  elsif tg_table_name = 'bank_statement_imports' then
    if new.imported_by is distinct from actor then raise exception 'Autor no valido' using errcode = '42501'; end if;
    new.imported_at := statement_timestamp();
  elsif tg_table_name = 'bank_statement_lines' then
    new.created_at := statement_timestamp();
  elsif tg_op = 'INSERT' then
    if new.confirmed_by is distinct from actor then raise exception 'Autor no valido' using errcode = '42501'; end if;
    new.confirmed_at := statement_timestamp();
  elsif new.status = 'revoked' then
    if new.revoked_by is distinct from actor then raise exception 'Autor no valido' using errcode = '42501'; end if;
    new.revoked_at := statement_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_treasury_audit() from public, anon, authenticated;
create trigger stamp_checkpoint_audit before insert on public.account_balance_checkpoints
for each row execute function private.stamp_treasury_audit();
create trigger stamp_import_audit before insert on public.bank_statement_imports
for each row execute function private.stamp_treasury_audit();
create trigger stamp_line_audit before insert on public.bank_statement_lines
for each row execute function private.stamp_treasury_audit();
create trigger stamp_reconciliation_audit before insert or update on public.treasury_reconciliations
for each row execute function private.stamp_treasury_audit();

alter table public.account_balance_checkpoints enable row level security;
alter table public.bank_statement_imports enable row level security;
alter table public.bank_statement_lines enable row level security;
alter table public.treasury_reconciliations enable row level security;

create policy account_balance_checkpoints_select
on public.account_balance_checkpoints
for select to authenticated
using (private.is_household_member(household_id));

create policy account_balance_checkpoints_insert
on public.account_balance_checkpoints
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and private.is_household_member(household_id)
  and exists (
    select 1
    from public.accounts a
    where a.id = account_balance_checkpoints.account_id
      and a.household_id = account_balance_checkpoints.household_id
  )
);

create policy bank_statement_imports_select
on public.bank_statement_imports
for select to authenticated
using (private.is_household_member(household_id));

create policy bank_statement_imports_insert
on public.bank_statement_imports
for insert to authenticated
with check (
  imported_by = (select auth.uid())
  and private.is_household_member(household_id)
  and exists (
    select 1
    from public.accounts a
    where a.id = bank_statement_imports.account_id
      and a.household_id = bank_statement_imports.household_id
  )
);

create policy bank_statement_lines_select
on public.bank_statement_lines
for select to authenticated
using (
  exists (
    select 1
    from public.bank_statement_imports i
    where i.id = bank_statement_lines.import_id
      and private.is_household_member(i.household_id)
  )
);

create policy bank_statement_lines_insert
on public.bank_statement_lines
for insert to authenticated
with check (
  exists (
    select 1
    from public.bank_statement_imports i
    where i.id = bank_statement_lines.import_id
      and i.imported_by = (select auth.uid())
      and private.is_household_member(i.household_id)
  )
);

create policy treasury_reconciliations_select
on public.treasury_reconciliations
for select to authenticated
using (private.is_household_member(household_id));

create policy treasury_reconciliations_insert
on public.treasury_reconciliations
for insert to authenticated
with check (
  status = 'confirmed'
  and confirmed_by = (select auth.uid())
  and private.is_household_member(household_id)
  and exists (
    select 1
    from public.bank_statement_lines l
    join public.bank_statement_imports i on i.id = l.import_id
    join public.movement_series m on m.id = treasury_reconciliations.movement_series_id
    where l.id = treasury_reconciliations.statement_line_id
      and i.household_id = treasury_reconciliations.household_id
      and i.account_id = m.account_id
      and m.household_id = treasury_reconciliations.household_id
  )
);

create policy treasury_reconciliations_update
on public.treasury_reconciliations
for update to authenticated
using (
  status = 'confirmed'
  and private.is_household_member(household_id)
)
with check (
  status = 'revoked'
  and revoked_by = (select auth.uid())
  and revoked_at is not null
  and nullif(trim(revocation_reason),'') is not null
  and private.is_household_member(household_id)
);

-- Explicitly remove permissive default grants before the least-privilege grants.
revoke all on public.account_balance_checkpoints, public.bank_statement_imports,
 public.bank_statement_lines, public.treasury_reconciliations from public, anon, authenticated;

grant select, insert
on public.account_balance_checkpoints
to authenticated;

grant select, insert
on public.bank_statement_imports
to authenticated;

grant select, insert
on public.bank_statement_lines
to authenticated;

grant select, insert, update
on public.treasury_reconciliations
to authenticated;


-- Composite references preserve household/account identity after insertion, even if a
-- parent is edited by a privileged maintenance process. They also supply row locks.
alter table public.accounts add constraint treasury_accounts_identity_uq unique(id, household_id);
alter table public.movement_series add constraint treasury_series_identity_uq unique(id, household_id, account_id);
alter table public.movement_series add constraint treasury_series_account_fk
  foreign key(account_id, household_id) references public.accounts(id, household_id) on update restrict on delete restrict;
alter table public.account_balance_checkpoints add constraint treasury_checkpoint_account_fk
  foreign key(account_id, household_id) references public.accounts(id, household_id) on update restrict on delete restrict;
alter table public.bank_statement_imports add constraint treasury_import_account_fk
  foreign key(account_id, household_id) references public.accounts(id, household_id) on update restrict on delete restrict;
alter table public.treasury_reconciliations add column account_id uuid not null;
alter table public.treasury_reconciliations add constraint treasury_reconciliation_series_fk
  foreign key(movement_series_id, household_id, account_id)
  references public.movement_series(id, household_id, account_id) on update restrict on delete restrict;

create function private.bind_treasury_account() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare expected uuid;
begin
  if tg_op = 'UPDATE' then
    if new.account_id is distinct from old.account_id then
      raise exception 'Cuenta de conciliacion inmutable' using errcode = '42501';
    end if;
  else
    select i.account_id into expected from public.bank_statement_lines l
      join public.bank_statement_imports i on i.id=l.import_id where l.id=new.statement_line_id;
    if expected is null or (new.account_id is not null and new.account_id is distinct from expected) then
      raise exception 'Cuenta de conciliacion no valida' using errcode = '42501';
    end if;
    new.account_id := expected;
  end if;
  return new;
end;
$$;
revoke all on function private.bind_treasury_account() from public, anon, authenticated;
create trigger bind_treasury_account before insert or update on public.treasury_reconciliations
for each row execute function private.bind_treasury_account();

commit;
