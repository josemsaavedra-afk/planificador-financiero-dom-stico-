-- SOLO FIXTURE: contrato mínimo deducido de las FK y consultas de Alpha 10.
-- No es una copia ni una migración del esquema de producción.
-- El runner crea una instancia PGlite vacía en memoria antes de cargar este archivo.
create role anon nologin nosuperuser nobypassrls;
create role authenticated nologin nosuperuser nobypassrls;
create schema auth;
create schema private;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.households (id uuid primary key);
create table public.household_members (
  household_id uuid references public.households(id),
  user_id uuid references auth.users(id),
  primary key (household_id, user_id)
);
create table public.accounts (
  id uuid primary key,
  household_id uuid not null references public.households(id)
);
create table public.movement_series (
  id uuid primary key,
  household_id uuid not null references public.households(id),
  account_id uuid not null references public.accounts(id)
);
create table public.movement_occurrence_states (
  series_id uuid references public.movement_series(id),
  occurrence_date date,
  primary key (series_id, occurrence_date)
);
alter table public.household_members enable row level security;
create policy members_read on public.household_members for select to authenticated
using (user_id = (select auth.uid()));
create function private.is_household_member(target_household uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.household_members hm
    where hm.household_id = target_household and hm.user_id = (select auth.uid()))
$$;
revoke all on function private.is_household_member(uuid) from public;
grant usage on schema public, auth, private to authenticated;
grant execute on function private.is_household_member(uuid) to authenticated;
grant select on public.household_members, public.accounts, public.movement_series,
  public.movement_occurrence_states to authenticated;
alter table public.accounts enable row level security;
create policy accounts_read on public.accounts for select to authenticated
using (private.is_household_member(household_id));
alter table public.movement_series enable row level security;
create policy series_read on public.movement_series for select to authenticated
using (private.is_household_member(household_id));
alter table public.movement_occurrence_states enable row level security;
create policy states_read on public.movement_occurrence_states for select to authenticated
using (exists (select 1 from public.movement_series m
  where m.id = movement_occurrence_states.series_id));

-- IDs ficticios: usuarios 1=A, 2=B, 3=A+B, 4=A, 5=sin hogar.
insert into auth.users select ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
from generate_series(1,5) n;
insert into public.households values
('00000000-0000-4000-8000-000000000011'), ('00000000-0000-4000-8000-000000000012');
insert into public.household_members values
('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000002'),
('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000003'),
('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000003'),
('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000004');
insert into public.accounts values
('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000011'),
('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000012'),
('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000011');
insert into public.movement_series values
('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000101'),
('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000102'),
('00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000103');
insert into public.movement_occurrence_states
select m.id, d::date from public.movement_series m
cross join (values ('2026-09-19'), ('2026-09-20')) dates(d);
