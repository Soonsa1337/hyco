import { supabase } from '../lib/supabase';
import { rolesOf } from '../lib/perms';
import { isSurge, PERKS } from '../lib/surge';
import Avatar from './Avatar.jsx';
import { RoleChips, kick, ban } from './Servers.jsx';

const STATUS_TEXT = { online: 'Online', idle: 'Abwesend', dnd: 'Bitte nicht stören', offline: 'Offline' };

// Mitgliederliste rechts: online nach höchster getrennt angezeigter Rolle gruppiert, darunter offline
export function Members({ server, profiles, members, roles, memberRoles, statusOf, openProfile, voiceOf = () => null }) {
  const all = members.filter((m) => m.server_id === server.id).map((m) => profiles[m.user_id]).filter(Boolean).sort((a, b) => a.username.localeCompare(b.username));
  const top = (id) => rolesOf({ serverId: server.id, roles, memberRoles, userId: id })[0];
  const hoisted = (id) => rolesOf({ serverId: server.id, roles, memberRoles, userId: id }).find((r) => r.hoist);
  const on = all.filter((p) => statusOf(p.id) !== 'offline');
  const off = all.filter((p) => statusOf(p.id) === 'offline');
  const groups = roles.filter((r) => r.server_id === server.id && r.hoist && !r.is_default).sort((a, b) => b.position - a.position)
    .map((r) => ({ role: r, list: on.filter((p) => hoisted(p.id)?.id === r.id) })).filter((g) => g.list.length);
  const plain = on.filter((p) => !hoisted(p.id));

  const row = (p, dimmed) => (
    <div key={p.id} className={dimmed ? 'member off' : 'member'} onClick={() => openProfile(p.id)}>
      <Avatar profile={p} status={statusOf(p.id)} size={32} />
      <span className="grow">
        <b style={{ color: dimmed ? undefined : top(p.id)?.color || p.accent }}>{p.username}{p.id === server.owner_id && ' 👑'}{isSurge(p) && <span className="surge">⚡</span>}</b>
        {voiceOf(p.id) ? <small className="ok">🔊 {voiceOf(p.id)}</small> : p.status && <small className="dim">{p.status}</small>}
      </span>
    </div>
  );
  return (
    <aside className="members">
      {groups.map((g) => (
        <div key={g.role.id}><h4 style={{ color: g.role.color }}>{g.role.name} — {g.list.length}</h4>{g.list.map((p) => row(p, false))}</div>
      ))}
      {plain.length > 0 && <><h4>Online — {plain.length}</h4>{plain.map((p) => row(p, false))}</>}
      <h4>Offline — {off.length}</h4>
      {off.map((p) => row(p, true))}
    </aside>
  );
}

// Profilkarte beim Klick auf einen Nutzer; im Server-Kontext mit Rollen und Moderation
export function ProfileCard({ id, me, profiles, friendRows, reloadFriends, statusOf, openDM, onClose, server, roles, memberRoles, can, reloadGuilds, isMember, openSurge }) {
  const p = profiles[id];
  if (!p) return null;
  const st = statusOf(id);
  const rel = friendRows.find((r) => [r.requester, r.addressee].includes(id));
  const add = async () => {
    await supabase.from('friendships').insert({ requester: me.id, addressee: id });
    reloadFriends();
  };
  const moderate = server && isMember && id !== me.id && id !== server.owner_id;
  const act = async (fn) => {
    await fn(server.id, id);
    reloadGuilds();
    onClose();
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="profile-card" onClick={(e) => e.stopPropagation()}>
        <div className={isSurge(p) ? 'banner surge-glow' : 'banner'} style={{ background: p.banner_url && isSurge(p) ? `url(${p.banner_url}) center/cover` : `linear-gradient(135deg, ${p.accent || '#ff7a1a'}, #1b2030)` }} />
        <div className="pc-avatar"><Avatar profile={p} status={st} size={84} /></div>
        <div className="pc-body">
          <h2>{p.username}{server?.owner_id === id && ' 👑'}{isSurge(p) && <span className="surge big" title="Hyco Surge">⚡</span>}</h2>
          {isSurge(p) && <p className="surge-tag">Hyco Surge-Mitglied{p.surge_until ? ` · bis ${new Date(p.surge_until).toLocaleDateString('de-DE')}` : ''}</p>}
          {id === me.id && !isSurge(p) && openSurge && <a className="small" onClick={openSurge}>⚡ Hyco Surge holen</a>}
          <p className="dim">{p.status || STATUS_TEXT[st]}</p>
          <div className="pc-box">
            <h4>Über mich</h4>
            <p>{p.bio || <span className="dim">Keine Beschreibung.</span>}</p>
            {server && isMember && (
              <>
                <h4>Rollen auf {server.name}</h4>
                <RoleChips serverId={server.id} userId={id} roles={roles} memberRoles={memberRoles} editable={can('manage_roles')} reload={reloadGuilds} />
              </>
            )}
            <h4>Mitglied seit</h4>
            <p>{new Date(p.created_at).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
          {id !== me.id && (
            <div className="row">
              <button className="primary grow" onClick={() => { openDM(id); onClose(); }}>💬 Nachricht</button>
              {!rel && <button onClick={add}>Freund hinzufügen</button>}
              {rel?.status === 'pending' && <button disabled>Anfrage ausstehend</button>}
              {rel?.status === 'accepted' && <button disabled>✓ Befreundet</button>}
            </div>
          )}
          {moderate && (can('kick_members') || can('ban_members')) && (
            <div className="row">
              {can('kick_members') && <button className="grow" onClick={() => act(kick)}>Kicken</button>}
              {can('ban_members') && <button className="danger grow" onClick={() => act(ban)}>Bannen</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
