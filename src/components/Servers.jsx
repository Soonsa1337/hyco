import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { PERMS, inviteLink, newCode, parseInvite, rolesOf } from '../lib/perms';
import Avatar from './Avatar.jsx';

const clean = (e) => String(e?.message || e);

// Server erstellen oder per Einladung beitreten
export function ServerDialog({ onClose, onJoin, onCreated }) {
  const [mode, setMode] = useState('join');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      if (mode === 'create') {
        const { data, error } = await supabase.rpc('create_server', { server_name: name });
        if (error) throw error;
        onCreated(data);
      } else {
        await onJoin(code);
      }
      onClose();
    } catch (err) {
      setMsg(clean(err));
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <form className="card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Server hinzufügen</h2>
        <div className="row">
          <button type="button" className={mode === 'join' ? 'tab on' : 'tab'} onClick={() => setMode('join')}>Beitreten</button>
          <button type="button" className={mode === 'create' ? 'tab on' : 'tab'} onClick={() => setMode('create')}>Neu erstellen</button>
        </div>
        {mode === 'join' ? (
          <>
            <label>Einladungslink oder Code</label>
            <input autoFocus placeholder="hyco://invite/AbCd1234" value={code} onChange={(e) => setCode(e.target.value)} />
          </>
        ) : (
          <>
            <label>Servername</label>
            <input autoFocus minLength={2} maxLength={40} required placeholder="Mein Server" value={name} onChange={(e) => setName(e.target.value)} />
            <p className="dim small" style={{ margin: 0 }}>Du wirst Besitzer. Ein Textkanal und ein Sprachkanal werden angelegt.</p>
          </>
        )}
        {msg && <p className="error">{msg}</p>}
        <div className="row end">
          <span className="grow" />
          <button type="button" onClick={onClose}>Abbrechen</button>
          <button className="primary">{mode === 'join' ? 'Beitreten' : 'Erstellen'}</button>
        </div>
      </form>
    </div>
  );
}

const EXPIRY = [['1800', '30 Minuten'], ['86400', '1 Tag'], ['604800', '7 Tage'], ['', 'Nie']];
const USES = [['', 'Unbegrenzt'], ['1', '1 Nutzung'], ['5', '5 Nutzungen'], ['25', '25 Nutzungen']];

function Invites({ server, me, can }) {
  const [list, setList] = useState([]);
  const [expiry, setExpiry] = useState('604800');
  const [uses, setUses] = useState('');
  const [copied, setCopied] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('invites').select('*').eq('server_id', server.id).order('created_at', { ascending: false });
    setList(data || []);
  }, [server.id]);
  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setMsg('');
    const code = newCode();
    const { error } = await supabase.from('invites').insert({
      code, server_id: server.id, created_by: me.id,
      max_uses: uses ? Number(uses) : null,
      expires_at: expiry ? new Date(Date.now() + Number(expiry) * 1000).toISOString() : null,
    });
    if (error) return setMsg(error.message);
    await load();
    copy(code);
  };
  const copy = (code) => {
    navigator.clipboard.writeText(inviteLink(code));
    setCopied(code);
  };
  const state = (i) => {
    if (i.expires_at && new Date(i.expires_at) < new Date()) return 'abgelaufen';
    if (i.max_uses && i.uses >= i.max_uses) return 'aufgebraucht';
    return i.expires_at ? `bis ${new Date(i.expires_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}` : 'läuft nie ab';
  };

  return (
    <>
      <h2>Einladungen</h2>
      {can('create_invite') ? (
        <div className="row">
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)}>{EXPIRY.map(([v, l]) => <option key={v} value={v}>Gültig: {l}</option>)}</select>
          <select value={uses} onChange={(e) => setUses(e.target.value)}>{USES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <button type="button" className="primary" style={{ whiteSpace: 'nowrap' }} onClick={create}>Link erstellen</button>
        </div>
      ) : <p className="dim">Dir fehlt das Recht, Einladungen zu erstellen.</p>}
      {msg && <p className="error">{msg}</p>}
      <p className="dim small" style={{ margin: 0 }}>Der Link öffnet Hyco direkt. Wer Hyco noch nicht hat, braucht zuerst die Setup-Datei und den Verbindungscode (Einstellungen → Freunde einladen).</p>
      {list.map((i) => (
        <div className="friend" key={i.code}>
          <span className="grow"><b className="mono">{inviteLink(i.code)}</b><small className="dim">{i.uses}{i.max_uses ? ` / ${i.max_uses}` : ''} genutzt · {state(i)}</small></span>
          <button type="button" onClick={() => copy(i.code)}>{copied === i.code ? '✓ Kopiert' : 'Kopieren'}</button>
          {(i.created_by === me.id || can('manage_server')) && <button type="button" className="round" title="Widerrufen" onClick={async () => { await supabase.from('invites').delete().eq('code', i.code); load(); }}>✕</button>}
        </div>
      ))}
      {!list.length && <p className="dim">Noch keine Einladungen.</p>}
    </>
  );
}

function Roles({ server, roles, can, reload }) {
  const list = roles.filter((r) => r.server_id === server.id).sort((a, b) => b.position - a.position);
  const [id, setId] = useState(list[0]?.id);
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState('');
  const role = list.find((r) => r.id === id);
  const editable = can('manage_roles');

  useEffect(() => {
    setDraft(role ? { ...role } : null);
    setMsg('');
  }, [id, role?.name, role?.color, role?.hoist, role?.position, (role?.permissions || []).join()]);

  const create = async () => {
    const top = Math.max(0, ...list.map((r) => r.position));
    const { data, error } = await supabase.from('roles').insert({ server_id: server.id, name: 'Neue Rolle', position: top + 1 }).select().single();
    if (error) return setMsg(error.message);
    await reload();
    setId(data.id);
  };
  const save = async () => {
    const { error } = await supabase.from('roles')
      .update({ name: draft.name.trim() || role.name, color: draft.color, hoist: draft.hoist, position: Number(draft.position) || 0, permissions: draft.permissions })
      .eq('id', role.id);
    setMsg(error ? error.message : 'Gespeichert.');
    reload();
  };
  const remove = async () => {
    await supabase.from('roles').delete().eq('id', role.id);
    setId(list.find((r) => r.id !== role.id)?.id);
    reload();
  };
  const toggle = (p) => setDraft((d) => ({ ...d, permissions: d.permissions.includes(p) ? d.permissions.filter((x) => x !== p) : [...d.permissions, p] }));

  return (
    <>
      <h2>Rollen</h2>
      <div className="roles-layout">
        <div className="role-list">
          {list.map((r) => (
            <a key={r.id} className={r.id === id ? 'channel active' : 'channel'} onClick={() => setId(r.id)}><i className="dot static" style={{ background: r.color }} />{r.name}</a>
          ))}
          {editable && <button type="button" onClick={create}>+ Rolle</button>}
        </div>
        {draft && (
          <div className="role-edit">
            <label>Name</label>
            <input value={draft.name} maxLength={32} disabled={!editable || role.is_default} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            {!role.is_default && (
              <div className="row">
                <label>Farbe</label>
                <input type="color" className="color" value={draft.color} disabled={!editable} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
                <label>Rang</label>
                <input type="number" className="num" min="1" max="99" value={draft.position} disabled={!editable} onChange={(e) => setDraft({ ...draft, position: e.target.value })} />
                <label className="row check"><input type="checkbox" checked={draft.hoist} disabled={!editable} onChange={(e) => setDraft({ ...draft, hoist: e.target.checked })} />Getrennt anzeigen</label>
              </div>
            )}
            {role.is_default && <p className="dim small" style={{ margin: 0 }}>@everyone gilt für alle Mitglieder. Rechte hier hat jeder.</p>}
            <label>Rechte</label>
            {PERMS.map(([k, label, desc]) => (
              <label key={k} className="perm">
                <input type="checkbox" checked={draft.permissions.includes(k)} disabled={!editable} onChange={() => toggle(k)} />
                <span><b>{label}</b><small className="dim">{desc}</small></span>
              </label>
            ))}
            {msg && <p className={msg === 'Gespeichert.' ? 'ok' : 'error'}>{msg}</p>}
            {editable && (
              <div className="row">
                {!role.is_default && <button type="button" className="danger" onClick={remove}>Rolle löschen</button>}
                <span className="grow" />
                <button type="button" className="primary" onClick={save}>Rolle speichern</button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// Rollen eines Mitglieds anzeigen und (mit Recht) vergeben/entziehen
export function RoleChips({ serverId, userId, roles, memberRoles, editable, reload }) {
  const mine = rolesOf({ serverId, roles, memberRoles, userId });
  const free = roles.filter((r) => r.server_id === serverId && !r.is_default && !mine.includes(r)).sort((a, b) => b.position - a.position);
  const add = async (roleId) => {
    if (!roleId) return;
    await supabase.from('member_roles').insert({ server_id: serverId, user_id: userId, role_id: roleId });
    reload();
  };
  const drop = async (roleId) => {
    await supabase.from('member_roles').delete().match({ user_id: userId, role_id: roleId });
    reload();
  };
  return (
    <div className="chips">
      {mine.map((r) => (
        <span key={r.id} className="role-chip" style={{ borderColor: r.color }}>
          <i className="dot static" style={{ background: r.color }} />{r.name}
          {editable && <button type="button" title="Rolle entziehen" onClick={() => drop(r.id)}>✕</button>}
        </span>
      ))}
      {editable && free.length > 0 && (
        <select className="role-add" value="" onChange={(e) => add(e.target.value)}>
          <option value="">+ Rolle</option>
          {free.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      )}
      {!mine.length && !editable && <span className="dim small" style={{ margin: 0 }}>Keine Rollen</span>}
    </div>
  );
}

export async function kick(serverId, userId) {
  return supabase.from('server_members').delete().match({ server_id: serverId, user_id: userId });
}
export async function ban(serverId, userId) {
  return supabase.rpc('ban_member', { sid: serverId, target: userId });
}

function MembersAdmin({ server, me, profiles, members, roles, memberRoles, can, statusOf, reload }) {
  const list = members.filter((m) => m.server_id === server.id).map((m) => profiles[m.user_id]).filter(Boolean).sort((a, b) => a.username.localeCompare(b.username));
  return (
    <>
      <h2>Mitglieder — {list.length}</h2>
      {list.map((p) => {
        const owner = p.id === server.owner_id;
        return (
          <div className="friend" key={p.id}>
            <Avatar profile={p} status={statusOf(p.id)} size={36} />
            <span className="grow">
              <b>{p.username}{owner && ' 👑'}</b>
              <RoleChips serverId={server.id} userId={p.id} roles={roles} memberRoles={memberRoles} editable={can('manage_roles')} reload={reload} />
            </span>
            {!owner && p.id !== me.id && can('kick_members') && <button type="button" onClick={async () => { await kick(server.id, p.id); reload(); }}>Kicken</button>}
            {!owner && p.id !== me.id && can('ban_members') && <button type="button" className="danger" onClick={async () => { await ban(server.id, p.id); reload(); }}>Bannen</button>}
          </div>
        );
      })}
    </>
  );
}

function Bans({ server, profiles }) {
  const [list, setList] = useState([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from('bans').select('*').eq('server_id', server.id);
    setList(data || []);
  }, [server.id]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <>
      <h2>Gebannte Nutzer — {list.length}</h2>
      {list.map((b) => (
        <div className="friend" key={b.user_id}>
          <Avatar profile={profiles[b.user_id]} size={36} />
          <span className="grow"><b>{profiles[b.user_id]?.username || b.user_id}</b><small className="dim">gebannt am {new Date(b.created_at).toLocaleDateString('de-DE')}</small></span>
          <button type="button" onClick={async () => { await supabase.from('bans').delete().match({ server_id: server.id, user_id: b.user_id }); load(); }}>Bann aufheben</button>
        </div>
      ))}
      {!list.length && <p className="dim">Niemand ist gebannt.</p>}
    </>
  );
}

function Overview({ server, me, can, reload, onDeleted }) {
  const [name, setName] = useState(server.name);
  const [icon, setIcon] = useState(server.icon_url);
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState(false);
  const editable = can('manage_server');

  const upload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setMsg('Icon max. 2 MB.');
    const path = `${me.id}/server-${Date.now()}-${file.name.replace(/[^\w.]/g, '_')}`;
    const { error } = await supabase.storage.from('avatars').upload(path, file);
    if (error) return setMsg(error.message);
    setIcon(supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl);
  };
  const save = async () => {
    const { error } = await supabase.from('servers').update({ name: name.trim(), icon_url: icon }).eq('id', server.id);
    setMsg(error ? error.message : 'Gespeichert.');
    reload();
  };
  const remove = async () => {
    const { error } = await supabase.from('servers').delete().eq('id', server.id);
    if (error) return setMsg(error.message);
    onDeleted();
  };

  return (
    <>
      <h2>Übersicht</h2>
      <div className="row">
        <span className="server-icon big">{icon ? <img src={icon} alt="" /> : server.name.slice(0, 2).toUpperCase()}</span>
        {editable && <input type="file" accept="image/*" onChange={upload} />}
      </div>
      <label>Servername</label>
      <input value={name} minLength={2} maxLength={40} disabled={!editable} onChange={(e) => setName(e.target.value)} />
      {msg && <p className={msg === 'Gespeichert.' ? 'ok' : 'error'}>{msg}</p>}
      {editable && <div className="row"><button type="button" className="primary" onClick={save}>Speichern</button></div>}
      {server.owner_id === me.id && (
        <>
          <h2 className="danger-text">Gefahrenzone</h2>
          <p className="dim small" style={{ margin: 0 }}>Löscht den Server mit allen Kanälen, Nachrichten und Rollen. Das lässt sich nicht rückgängig machen.</p>
          <div className="row">
            {confirm
              ? <><button type="button" className="danger" onClick={remove}>Ja, „{server.name}" endgültig löschen</button><button type="button" onClick={() => setConfirm(false)}>Abbrechen</button></>
              : <button type="button" className="danger" onClick={() => setConfirm(true)}>Server löschen</button>}
          </div>
        </>
      )}
    </>
  );
}

export function ServerSettings({ server, initialTab = 'overview', me, profiles, members, roles, memberRoles, can, statusOf, reload, onClose, onDeleted }) {
  const [tab, setTab] = useState(initialTab);
  const tabs = [['overview', 'Übersicht'], ['roles', 'Rollen'], ['members', 'Mitglieder'], ['invites', 'Einladungen']];
  if (can('ban_members')) tabs.push(['bans', 'Bans']);
  const shared = { server, me, profiles, members, roles, memberRoles, can, statusOf, reload };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="settings wide" onClick={(e) => e.stopPropagation()}>
        <nav>
          <h4>{server.name}</h4>
          {tabs.map(([k, label]) => <a key={k} className={tab === k ? 'channel active' : 'channel'} onClick={() => setTab(k)}>{label}</a>)}
          <span className="grow" />
          <a className="channel" onClick={onClose}>Schließen</a>
        </nav>
        <form onSubmit={(e) => e.preventDefault()}>
          {tab === 'overview' && <Overview {...shared} onDeleted={onDeleted} />}
          {tab === 'roles' && <Roles {...shared} />}
          {tab === 'members' && <MembersAdmin {...shared} />}
          {tab === 'invites' && <Invites {...shared} />}
          {tab === 'bans' && <Bans {...shared} />}
        </form>
      </div>
    </div>
  );
}

export { parseInvite };
