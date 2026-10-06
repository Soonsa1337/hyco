-- Hyco 1.3: Updates über den Client. Nach migration-002.sql einmal ausführen.

-- Admin-Kennzeichen: nur Admins dürfen Updates veröffentlichen. Der älteste Account wird Admin.
alter table public.profiles add column if not exists is_admin boolean not null default false;
update public.profiles set is_admin = true
  where id = (select id from public.profiles order by created_at limit 1);

-- Nutzer dürfen ihr Profil ändern, aber nicht is_admin
revoke update on public.profiles from authenticated, anon;
grant update (username, avatar_url, status, bio, presence, accent) on public.profiles to authenticated;

-- Öffentlicher Speicher für die Update-Dateien
insert into storage.buckets (id, name, public) values ('updates', 'updates', true) on conflict do nothing;
create policy "updates lesen" on storage.objects for select using (bucket_id = 'updates');
create policy "updates hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'updates' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
create policy "updates ersetzen" on storage.objects for update to authenticated
  using (bucket_id = 'updates' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
create policy "updates löschen" on storage.objects for delete to authenticated
  using (bucket_id = 'updates' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
