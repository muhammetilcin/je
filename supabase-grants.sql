-- JE Data API izinleri
-- Yeni Supabase projelerinde "Automatically expose new tables" kapalıysa gereklidir.
-- RLS politikaları zaten aktiftir; bu GRANT'ler yalnızca authenticated rolünün Data API üzerinden tablolara ulaşabilmesini sağlar.

grant select, insert, update, delete on table public.companies to authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.projects to authenticated;
grant select, insert, update, delete on table public.project_members to authenticated;
grant select, insert, update, delete on table public.project_layers to authenticated;
grant select, insert, update, delete on table public.borehole_records to authenticated;
grant select, insert, update, delete on table public.field_entries to authenticated;
grant select, insert, update, delete on table public.attachments to authenticated;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.has_project_access(uuid) to authenticated;
grant execute on function public.can_edit_project(uuid) to authenticated;
