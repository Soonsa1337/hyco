-- Hyco: Im Supabase-Dashboard unter "SQL Editor" einmal komplett ausführen.

-- ---------- Profile ----------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (char_length(username) between 3 and 24),
  avatar_url text,
  status text default '' check (char_length(status) <= 80),
  created_at timestamptz default now()
);

-- Profil automatisch bei Registrierung anlegen
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- Freunde ----------
create table public.friendships (
  id bigint generated always as identity primary key,
  requester uuid not null references public.profiles on delete cascade,
  addressee uuid not null references public.profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz default now(),
  unique (requester, addressee),
  check (requester <> addressee)
);

-- ---------- Kanäle & Nachrichten ----------
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 32),
  type text not null check (type in ('text', 'voice')),
  created_at timestamptz default now()
);

create table public.messages (
  id bigint generated always as identity primary key,
  channel_id uuid not null references public.channels on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz default now()
);
create index on public.messages (channel_id, id desc);

insert into public.channels (name, type) values
  ('allgemein', 'text'), ('links', 'text'), ('Lounge', 'voice'), ('Gaming', 'voice');

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.channels enable row level security;
alter table public.messages enable row level security;

create policy "profiles lesen" on public.profiles for select to authenticated using (true);
create policy "eigenes profil ändern" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "eigene freundschaften lesen" on public.friendships for select to authenticated
  using (auth.uid() in (requester, addressee));
create policy "anfrage senden" on public.friendships for insert to authenticated
  with check (requester = auth.uid() and status = 'pending');
create policy "anfrage annehmen" on public.friendships for update to authenticated
  using (addressee = auth.uid()) with check (addressee = auth.uid());
create policy "freundschaft löschen" on public.friendships for delete to authenticated
  using (auth.uid() in (requester, addressee));

create policy "kanäle lesen" on public.channels for select to authenticated using (true);
create policy "kanäle anlegen" on public.channels for insert to authenticated with check (true);

create policy "nachrichten lesen" on public.messages for select to authenticated using (true);
create policy "nachrichten senden" on public.messages for insert to authenticated
  with check (user_id = auth.uid());

-- ---------- Realtime ----------
alter publication supabase_realtime add table public.messages, public.friendships, public.channels, public.profiles;

-- ---------- Avatar-Speicher ----------
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);
create policy "avatare lesen" on storage.objects for select using (bucket_id = 'avatars');
create policy "eigenen avatar hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
