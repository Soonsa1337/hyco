-- Hyco 1.4: Eigene Server mit Einladungen, Rollen, Rechten, Kick und Bann.
-- Nach migration-003.sql einmal ausführen.

create table if not exists public.servers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  icon_url text,
  owner_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz default now()
);
create table if not exists public.server_members (
  server_id uuid not null references public.servers on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  joined_at timestamptz default now(),
  primary key (server_id, user_id)
);
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers on delete cascade,
  name text not null check (char_length(name) between 1 and 32),
  color text not null default '#99aab5',
  position int not null default 1,
  hoist boolean not null default true,
  permissions text[] not null default '{}',
  is_default boolean not null default false
);
create table if not exists public.member_roles (
  server_id uuid not null,
  user_id uuid not null,
  role_id uuid not null references public.roles on delete cascade,
  primary key (user_id, role_id),
  foreign key (server_id, user_id) references public.server_members on delete cascade
);
create table if not exists public.invites (
  code text primary key check (code ~ '^[A-Za-z0-9]{6,16}$'),
  server_id uuid not null references public.servers on delete cascade,
  created_by uuid references public.profiles on delete set null,
  max_uses int,
  uses int not null default 0,
  expires_at timestamptz,
  created_at timestamptz default now()
);
create table if not exists public.bans (
  server_id uuid not null references public.servers on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  banned_by uuid references public.profiles on delete set null,
  created_at timestamptz default now(),
  primary key (server_id, user_id)
);
alter table public.channels add column if not exists server_id uuid references public.servers on delete cascade;

-- ---------- Rechteprüfung ----------
create or replace function public.is_member(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from server_members where server_id = sid and user_id = auth.uid());
$$;

-- Besitzer darf alles; sonst zählt die Summe aus @everyone und den eigenen Rollen. 'admin' schließt alles ein.
create or replace function public.has_perm(sid uuid, perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from servers where id = sid and owner_id = auth.uid())
    or (is_member(sid) and exists (
      select 1 from roles r
      where r.server_id = sid
        and (perm = any (r.permissions) or 'admin' = any (r.permissions))
        and (r.is_default or exists (select 1 from member_roles mr where mr.role_id = r.id and mr.user_id = auth.uid()))
    ));
$$;

create or replace function public.channel_server(cid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select server_id from channels where id = cid;
$$;

-- ---------- Bestehende Kanäle in einen ersten Server überführen ----------
do $$
declare sid uuid; adm uuid;
begin
  if exists (select 1 from public.channels where server_id is null) then
    select id into adm from public.profiles order by is_admin desc, created_at limit 1;
    if adm is null then
      delete from public.channels where server_id is null;
    else
      insert into public.servers (name, owner_id) values ('Hyco', adm) returning id into sid;
      insert into public.server_members (server_id, user_id) select sid, id from public.profiles;
      insert into public.roles (server_id, name, is_default, position, permissions)
        values (sid, '@everyone', true, 0, array['send_messages', 'attach_files', 'connect_voice', 'stream', 'create_invite']);
      update public.channels set server_id = sid where server_id is null;
    end if;
  end if;
end $$;
alter table public.channels alter column server_id set not null;

-- ---------- Aktionen ----------
create or replace function public.create_server(server_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'Nicht eingeloggt'; end if;
  insert into servers (name, owner_id) values (trim(server_name), auth.uid()) returning id into sid;
  insert into server_members (server_id, user_id) values (sid, auth.uid());
  insert into roles (server_id, name, is_default, position, permissions)
    values (sid, '@everyone', true, 0, array['send_messages', 'attach_files', 'connect_voice', 'stream', 'create_invite']);
  insert into channels (server_id, name, type) values (sid, 'allgemein', 'text'), (sid, 'Lounge', 'voice');
  return sid;
end $$;

create or replace function public.join_server(invite_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv invites;
begin
  if auth.uid() is null then raise exception 'Nicht eingeloggt'; end if;
  select * into inv from invites where code = invite_code for update;
  if not found then raise exception 'Diese Einladung ist ungültig.'; end if;
  if inv.expires_at is not null and inv.expires_at < now() then raise exception 'Diese Einladung ist abgelaufen.'; end if;
  if exists (select 1 from bans where server_id = inv.server_id and user_id = auth.uid()) then
    raise exception 'Du bist von diesem Server gebannt.';
  end if;
  if exists (select 1 from server_members where server_id = inv.server_id and user_id = auth.uid()) then
    return inv.server_id;
  end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then raise exception 'Diese Einladung ist aufgebraucht.'; end if;
  insert into server_members (server_id, user_id) values (inv.server_id, auth.uid());
  update invites set uses = uses + 1 where code = invite_code;
  return inv.server_id;
end $$;

create or replace function public.ban_member(sid uuid, target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm(sid, 'ban_members') then raise exception 'Keine Berechtigung.'; end if;
  if exists (select 1 from servers where id = sid and owner_id = target) then raise exception 'Der Besitzer kann nicht gebannt werden.'; end if;
  insert into bans (server_id, user_id, banned_by) values (sid, target, auth.uid()) on conflict do nothing;
  delete from server_members where server_id = sid and user_id = target;
end $$;

create or replace function public.toggle_pin(mid bigint) returns void
language sql security definer set search_path = public as $$
  update public.messages set pinned = not pinned
  where id = mid and (
    (channel_id is not null and has_perm(channel_server(channel_id), 'manage_messages'))
    or (channel_id is null and auth.uid() in (user_id, recipient_id))
  );
$$;

-- ---------- Row Level Security ----------
alter table public.servers enable row level security;
alter table public.server_members enable row level security;
alter table public.roles enable row level security;
alter table public.member_roles enable row level security;
alter table public.invites enable row level security;
alter table public.bans enable row level security;

create policy "server lesen" on public.servers for select to authenticated using (is_member(id));
create policy "server ändern" on public.servers for update to authenticated
  using (has_perm(id, 'manage_server')) with check (has_perm(id, 'manage_server'));
create policy "server löschen" on public.servers for delete to authenticated using (owner_id = auth.uid());

create policy "mitglieder lesen" on public.server_members for select to authenticated using (is_member(server_id));
create policy "verlassen oder kicken" on public.server_members for delete to authenticated
  using ((user_id = auth.uid() or has_perm(server_id, 'kick_members'))
    and not exists (select 1 from public.servers s where s.id = server_id and s.owner_id = user_id));

create policy "rollen lesen" on public.roles for select to authenticated using (is_member(server_id));
create policy "rollen anlegen" on public.roles for insert to authenticated
  with check (has_perm(server_id, 'manage_roles') and not is_default);
create policy "rollen ändern" on public.roles for update to authenticated
  using (has_perm(server_id, 'manage_roles')) with check (has_perm(server_id, 'manage_roles'));
create policy "rollen löschen" on public.roles for delete to authenticated
  using (has_perm(server_id, 'manage_roles') and not is_default);

create policy "rollenvergabe lesen" on public.member_roles for select to authenticated using (is_member(server_id));
create policy "rolle vergeben" on public.member_roles for insert to authenticated
  with check (has_perm(server_id, 'manage_roles')
    and exists (select 1 from public.roles r where r.id = role_id and r.server_id = member_roles.server_id and not r.is_default));
create policy "rolle entziehen" on public.member_roles for delete to authenticated using (has_perm(server_id, 'manage_roles'));

create policy "einladungen lesen" on public.invites for select to authenticated using (is_member(server_id));
create policy "einladung erstellen" on public.invites for insert to authenticated
  with check (created_by = auth.uid() and has_perm(server_id, 'create_invite'));
create policy "einladung löschen" on public.invites for delete to authenticated
  using (created_by = auth.uid() or has_perm(server_id, 'manage_server'));

create policy "bans lesen" on public.bans for select to authenticated using (has_perm(server_id, 'ban_members'));
create policy "bann aufheben" on public.bans for delete to authenticated using (has_perm(server_id, 'ban_members'));

drop policy if exists "kanäle lesen" on public.channels;
drop policy if exists "kanäle anlegen" on public.channels;
drop policy if exists "kanäle ändern" on public.channels;
drop policy if exists "kanäle löschen" on public.channels;
create policy "kanäle lesen" on public.channels for select to authenticated using (is_member(server_id));
create policy "kanäle anlegen" on public.channels for insert to authenticated with check (has_perm(server_id, 'manage_channels'));
create policy "kanäle ändern" on public.channels for update to authenticated
  using (has_perm(server_id, 'manage_channels')) with check (has_perm(server_id, 'manage_channels'));
create policy "kanäle löschen" on public.channels for delete to authenticated using (has_perm(server_id, 'manage_channels'));

drop policy if exists "nachrichten lesen" on public.messages;
drop policy if exists "nachrichten senden" on public.messages;
drop policy if exists "eigene nachrichten löschen" on public.messages;
create policy "nachrichten lesen" on public.messages for select to authenticated
  using ((channel_id is not null and is_member(channel_server(channel_id)))
    or (channel_id is null and auth.uid() in (user_id, recipient_id)));
create policy "nachrichten senden" on public.messages for insert to authenticated
  with check (
    user_id = auth.uid()
    and ((channel_id is not null
        and has_perm(channel_server(channel_id), 'send_messages')
        and (attachment_url is null or has_perm(channel_server(channel_id), 'attach_files')))
      or (channel_id is null and recipient_id is not null
        and position(user_id::text in dm_key) > 0
        and position(recipient_id::text in dm_key) > 0))
  );
create policy "nachrichten löschen" on public.messages for delete to authenticated
  using (user_id = auth.uid() or (channel_id is not null and has_perm(channel_server(channel_id), 'manage_messages')));

alter publication supabase_realtime add table public.servers, public.server_members, public.roles, public.member_roles;
