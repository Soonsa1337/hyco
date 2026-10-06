-- Hyco 1.14: Premium-Abo "Hyco Surge". Nach migration-004.sql einmal ausführen.

alter table public.profiles
  add column if not exists surge_until timestamptz,
  add column if not exists banner_url text;
grant update (username, avatar_url, status, bio, presence, accent, banner_url) on public.profiles to authenticated;

-- App-weite Einstellungen (nur Admin schreibt): Tenor-API-Key für GIFs, Hinweistext, Stripe-Schalter
create table if not exists public.app_settings (
  key text primary key,
  value text not null default ''
);
alter table public.app_settings enable row level security;
create policy "einstellungen lesen" on public.app_settings for select to authenticated using (true);
create policy "einstellungen schreiben" on public.app_settings for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
insert into public.app_settings (key, value) values
  ('surge_info', 'Schreib Soonsa eine Nachricht, um Surge zu bekommen.'),
  ('tenor_key', ''),
  ('stripe_enabled', 'off')
on conflict do nothing;

-- Admin vergibt Surge manuell (Monate ab jetzt bzw. ab Ablauf); months = 0 entzieht es
create or replace function public.grant_surge(target uuid, months int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare base timestamptz; until timestamptz;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then raise exception 'Keine Berechtigung.'; end if;
  if months <= 0 then
    update profiles set surge_until = null where id = target;
    return null;
  end if;
  select greatest(coalesce(surge_until, now()), now()) into base from profiles where id = target;
  until := base + make_interval(months => months);
  update profiles set surge_until = until where id = target;
  return until;
end $$;

alter publication supabase_realtime add table public.app_settings;
