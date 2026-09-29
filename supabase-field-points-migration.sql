-- JEO saha noktaları genişletmesi
-- Mevcut borehole_records tablosunu hem sondaj hem jeoteknik noktaları için genişletir.

alter table public.borehole_records
  add column if not exists point_type text not null default 'Sondaj';

alter table public.borehole_records
  add column if not exists method text;

alter table public.borehole_records
  add column if not exists location_accuracy_m numeric;

alter table public.borehole_records
  add column if not exists location_captured_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'borehole_records_point_type_check'
  ) then
    alter table public.borehole_records
      add constraint borehole_records_point_type_check
      check (point_type in ('Sondaj','Jeoteknik'));
  end if;
end $$;

update public.borehole_records
set point_type = 'Sondaj'
where point_type is null;

grant select, insert, update, delete on table public.borehole_records to authenticated;
