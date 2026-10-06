-- Hyco 1.1: Direktnachrichten, Antworten, Reaktionen, Pins, Anhänge, Status, Kanal-Themen.
-- Nach schema.sql einmal im SQL Editor ausführen.

alter table public.profiles
  add column if not exists bio text default '' check (char_length(bio) <= 300),
  add column if not exists presence text not null default 'online' check (presence in ('online', 'idle', 'dnd', 'invisible')),
  add column if not exists accent text default '#ff7a1a';

alter table public.channels add column if not exists topic text default '' check (char_length(topic) <= 120);
create policy "kanäle ändern" on public.channels for update to authenticated using (true) with check (true);
create policy "kanäle löschen" on public.channels for delete to authenticated using (true);

alter table public.messages
  alter column channel_id drop not null,
  add column if not exists dm_key text,
  add column if not exists recipient_id uuid references public.profiles on delete cascade,
  add column if not exists reply_to bigint references public.messages on delete set null,
  add column if not exists attachment_url text,
  add column if not exists edited_at timestamptz,
  add column if not exists pinned boolean not null default false;

alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check
  check (char_length(content) <= 4000 and (content <> '' or attachment_url is not null));
alter table public.messages add constraint messages_target_check
  check ((channel_id is not null) <> (dm_key is not null));
create index if not exists messages_dm_idx on public.messages (dm_key, id desc);

drop policy "nachrichten lesen" on public.messages;
drop policy "nachrichten senden" on public.messages;
create policy "nachrichten lesen" on public.messages for select to authenticated
  using (channel_id is not null or auth.uid() in (user_id, recipient_id));
create policy "nachrichten senden" on public.messages for insert to authenticated
  with check (
    user_id = auth.uid()
    and (channel_id is not null
      or (recipient_id is not null
        and position(user_id::text in dm_key) > 0
        and position(recipient_id::text in dm_key) > 0))
  );
create policy "eigene nachrichten ändern" on public.messages for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "eigene nachrichten löschen" on public.messages for delete to authenticated
  using (user_id = auth.uid());

-- Anpinnen darf jeder, der die Nachricht lesen darf
create or replace function public.toggle_pin(mid bigint) returns void
language sql security definer set search_path = public as $$
  update public.messages set pinned = not pinned
  where id = mid and (channel_id is not null or auth.uid() in (user_id, recipient_id));
$$;

create table if not exists public.reactions (
  message_id bigint not null references public.messages on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  emoji text not null check (char_length(emoji) <= 16),
  primary key (message_id, user_id, emoji)
);
alter table public.reactions enable row level security;
create policy "reaktionen lesen" on public.reactions for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));
create policy "reagieren" on public.reactions for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id));
create policy "reaktion entfernen" on public.reactions for delete to authenticated using (user_id = auth.uid());
alter publication supabase_realtime add table public.reactions;

insert into storage.buckets (id, name, public) values ('attachments', 'attachments', true) on conflict do nothing;
create policy "anhänge lesen" on storage.objects for select using (bucket_id = 'attachments');
create policy "anhänge hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
