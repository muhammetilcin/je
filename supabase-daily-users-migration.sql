-- JEO: kullanıcı adı ile giriş + gün sonu raporu desteği
-- Supabase SQL Editor içinde bir kez çalıştırın.

alter table public.profiles
  add column if not exists username text;

create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username))
  where username is not null;

alter table public.borehole_records
  add column if not exists updated_at timestamptz;

update public.borehole_records
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

alter table public.borehole_records
  alter column updated_at set default now();

create or replace function public.set_borehole_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_borehole_updated_at on public.borehole_records;

create trigger trg_borehole_updated_at
before update on public.borehole_records
for each row
execute function public.set_borehole_updated_at();

grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.companies to authenticated;
grant select on table public.borehole_records to authenticated;
grant select on table public.field_entries to authenticated;
grant select on table public.attachments to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'admins_read_all_profiles'
  ) then
    create policy admins_read_all_profiles
      on public.profiles
      for select
      to authenticated
      using (public.is_admin());
  end if;
end $$;
