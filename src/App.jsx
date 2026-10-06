import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, configured } from './lib/supabase';
import { bus, dmKey, roomOfMessage } from './lib/bus';
import { mentionsUser } from './lib/format.jsx';
import { permsFor, rolesOf, parseInvite } from './lib/perms';
import { sounds } from './lib/sound';
import { useVoice } from './lib/voice';
import logo from './assets/logo.png';
import mark from './assets/mark.png';
import Setup from './components/Setup.jsx';
import Auth from './components/Auth.jsx';
import Avatar from './components/Avatar.jsx';
import Chat from './components/Chat.jsx';
import Home from './components/Home.jsx';
import { Members, ProfileCard } from './components/Members.jsx';
import { ServerDialog, ServerSettings } from './components/Servers.jsx';
import Settings from './components/Settings.jsx';
import Updater from './components/Updater.jsx';
import VoiceStage from './components/VoiceStage.jsx';

document.documentElement.dataset.theme = localStorage.getItem('theme') || 'ember';

const PRESENCE = [['online', 'Online'], ['idle', 'Abwesend'], ['dnd', 'Bitte nicht stören'], ['invisible', 'Unsichtbar']];

export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    if (!configured) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!configured) return <Setup />;
  if (session === undefined) return <div className="splash"><img src={mark} alt="" /></div>;
  if (!session) return <Auth />;
  return <Main key={session.user.id} userId={session.user.id} />;
}

function Main({ userId }) {
  const voice = useVoice();
  const [profiles, setProfiles] = useState({});
  const [servers, setServers] = useState(null);
  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [memberRoles, setMemberRoles] = useState([]);
  const [channels, setChannels] = useState([]);
  const [friendRows, setFriendRows] = useState([]);
  const [dmIds, setDmIds] = useState([]);
  const [online, setOnline] = useState({}); // userId -> { voice, idle, live }
  const [view, setView] = useState('server');
  const [serverId, setServerId] = useState(() => localStorage.getItem('server'));
  const [picked, setPicked] = useState({}); // serverId -> zuletzt gewählter Kanal
  const [dmWith, setDmWith] = useState(null);
  const [unread, setUnread] = useState({});
  const [typing, setTyping] = useState({});
  const [idle, setIdle] = useState(false);
  const [card, setCard] = useState(null);
  const [settings, setSettings] = useState(false);
  const [statusMenu, setStatusMenu] = useState(false);
  const [serverMenu, setServerMenu] = useState(false);
  const [serverDialog, setServerDialog] = useState(false);
  const [serverSettings, setServerSettings] = useState(null); // Tab-Name oder null
  const [draft, setDraft] = useState(null);
  const [toast, setToast] = useState('');
  const presence = useRef(null);
  const typingCh = useRef(null);
  const live = useRef({});

  const me = profiles[userId];
  const server = (servers || []).find((s) => s.id === serverId) || (servers || [])[0] || null;
  const serverChannels = server ? channels.filter((c) => c.server_id === server.id) : [];
  const channel = serverChannels.find((c) => c.id === picked[server?.id]) || serverChannels.find((c) => c.type === 'text') || null;
  const activeRoom =
    view === 'home' ? (dmWith ? `d:${dmKey(userId, dmWith)}` : null) : channel?.type === 'text' ? `c:${channel.id}` : null;
  live.current = { me, activeRoom };

  const loadProfiles = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*');
    if (data) setProfiles(Object.fromEntries(data.map((p) => [p.id, p])));
  }, []);
  const loadChannels = useCallback(async () => {
    const { data } = await supabase.from('channels').select('*').order('created_at').order('name');
    if (data) setChannels(data);
  }, []);
  const loadFriends = useCallback(async () => {
    const { data } = await supabase.from('friendships').select('*');
    if (data) setFriendRows(data);
  }, []);
  // Server, Mitglieder und Rollen – RLS liefert nur Server, in denen man Mitglied ist
  const loadGuilds = useCallback(async () => {
    const [s, m, r, mr] = await Promise.all([
      supabase.from('servers').select('*').order('created_at'),
      supabase.from('server_members').select('*'),
      supabase.from('roles').select('*'),
      supabase.from('member_roles').select('*'),
    ]);
    if (s.data) setServers(s.data);
    if (m.data) setMembers(m.data);
    if (r.data) setRoles(r.data);
    if (mr.data) setMemberRoles(mr.data);
    loadChannels();
  }, [loadChannels]);

  const joinServer = useCallback(async (text) => {
    const code = parseInvite(text);
    if (!code) throw new Error('Das ist kein gültiger Einladungslink.');
    const { data, error } = await supabase.rpc('join_server', { invite_code: code });
    if (error) throw new Error(error.message);
    await loadGuilds();
    setServerId(data);
    setView('server');
    return data;
  }, [loadGuilds]);

  // Stammdaten + zentrale Realtime-Verbindung
  useEffect(() => {
    loadProfiles();
    loadGuilds();
    loadFriends();
    supabase
      .from('messages').select('user_id,recipient_id').not('dm_key', 'is', null).order('id', { ascending: false }).limit(500)
      .then(({ data }) => setDmIds([...new Set((data || []).map((m) => (m.user_id === userId ? m.recipient_id : m.user_id)))]));

    const onMessage = (p) => {
      bus.emit('message', p);
      const m = p.new;
      if (p.eventType !== 'INSERT' || m.user_id === userId) return;
      const room = roomOfMessage(m);
      const { me: self, activeRoom: current } = live.current;
      if (m.dm_key) setDmIds((ids) => (ids.includes(m.user_id) ? ids : [m.user_id, ...ids]));
      if (room === current && document.hasFocus()) return;
      const mention = self && mentionsUser(m.content, self.username);
      setUnread((u) => ({ ...u, [room]: { n: (u[room]?.n || 0) + 1, ping: u[room]?.ping || Boolean(m.dm_key) || mention } }));
      if ((m.dm_key || mention) && self?.presence !== 'dnd' && localStorage.getItem('notify') !== 'off') {
        sounds.message();
        window.desktop?.attention();
        bus.emit('notify', m);
      }
    };

    const all = (table, fn) => [{ event: '*', schema: 'public', table }, fn];
    const db = supabase
      .channel('db')
      .on('postgres_changes', ...all('messages', onMessage))
      .on('postgres_changes', ...all('reactions', (p) => bus.emit('reaction', p)))
      .on('postgres_changes', ...all('profiles', loadProfiles))
      .on('postgres_changes', ...all('channels', loadChannels))
      .on('postgres_changes', ...all('friendships', loadFriends))
      .on('postgres_changes', ...all('servers', loadGuilds))
      .on('postgres_changes', ...all('server_members', loadGuilds))
      .on('postgres_changes', ...all('roles', loadGuilds))
      .on('postgres_changes', ...all('member_roles', loadGuilds))
      .subscribe();

    const ty = supabase
      .channel('typing')
      .on('broadcast', { event: 'typing' }, ({ payload }) =>
        setTyping((t) => ({ ...t, [payload.room]: { ...(t[payload.room] || {}), [payload.uid]: Date.now() } })))
      .subscribe();
    typingCh.current = ty;

    return () => {
      supabase.removeChannel(db);
      supabase.removeChannel(ty);
    };
  }, [userId, loadProfiles, loadChannels, loadFriends, loadGuilds]);

  // Einladungslinks: aus dem Chat angeklickt oder von Windows übergeben (hyco://invite/CODE)
  useEffect(() => {
    const accept = (link) => joinServer(link).then(() => setToast('Server beigetreten.')).catch((e) => setToast(e.message));
    const off = bus.on('join-invite', accept);
    const offOs = window.desktop?.onInvite?.(accept);
    window.desktop?.pendingInvite?.().then((link) => link && accept(link));
    return () => {
      off();
      offOs?.();
    };
  }, [joinServer]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Desktop-Benachrichtigung (braucht aktuelle Profile, daher eigener Effekt)
  useEffect(() => bus.on('notify', (m) => {
    if (document.hasFocus()) return;
    try {
      const n = new Notification(profiles[m.user_id]?.username || 'Hyco', { body: m.content || '📎 Anhang', icon: mark, silent: true });
      n.onclick = () => window.focus();
    } catch {}
  }), [profiles]);

  // Presence: Online-Status, Abwesenheit, Belegung der Sprachkanäle
  useEffect(() => {
    const ch = supabase.channel('online', { config: { presence: { key: userId } } });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState();
      setOnline(Object.fromEntries(Object.entries(state).filter(([, metas]) => metas.length).map(([id, metas]) => [id, metas[metas.length - 1]])));
    }).subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        presence.current = ch;
        await ch.track({ voice: null, idle: false });
      }
    });
    return () => {
      presence.current = null;
      supabase.removeChannel(ch);
    };
  }, [userId]);

  useEffect(() => {
    presence.current?.track({ voice: voice.channelId, idle, live: voice.sharing });
  }, [voice.channelId, idle, voice.sharing]);

  // Nach 5 Minuten ohne Eingabe als abwesend markieren
  useEffect(() => {
    let timer;
    const reset = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 5 * 60000);
    };
    reset();
    window.addEventListener('mousemove', reset);
    window.addEventListener('keydown', reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('keydown', reset);
    };
  }, []);

  // Aktiven Raum als gelesen markieren
  useEffect(() => {
    const clear = () => {
      if (activeRoom) setUnread((u) => (u[activeRoom] ? { ...u, [activeRoom]: undefined } : u));
    };
    clear();
    window.addEventListener('focus', clear);
    return () => window.removeEventListener('focus', clear);
  }, [activeRoom]);

  useEffect(() => {
    if (server) localStorage.setItem('server', server.id);
  }, [server?.id]);

  // Wer aus dem Server fliegt, während er dort im Sprachkanal sitzt, wird getrennt
  useEffect(() => {
    if (voice.channelId && servers && channels.length && !channels.some((c) => c.id === voice.channelId)) voice.leave();
  }, [channels, servers, voice.channelId, voice.leave]);

  useEffect(() => {
    const bye = () => voice.leave();
    window.addEventListener('beforeunload', bye);
    return () => window.removeEventListener('beforeunload', bye);
  }, [voice.leave]);

  if (!me || servers === null) return <div className="splash"><img src={mark} alt="" /></div>;

  const perms = permsFor({ server, roles, memberRoles, userId });
  const can = (p) => perms.has(p);
  const statusOf = (id) => {
    const p = profiles[id];
    const o = online[id];
    if (!p || !o || p.presence === 'invisible') return 'offline';
    if (p.presence === 'dnd') return 'dnd';
    if (p.presence === 'idle' || o.idle) return 'idle';
    return 'online';
  };
  const myStatus = me.presence === 'invisible' ? 'offline' : statusOf(userId) === 'offline' ? 'online' : statusOf(userId);
  const colorOf = (id) => (server ? rolesOf({ serverId: server.id, roles, memberRoles, userId: id })[0]?.color : undefined);
  const openDM = (id) => {
    if (id === userId) return;
    setDmIds((ids) => (ids.includes(id) ? ids : [id, ...ids]));
    setDmWith(id);
    setView('home');
  };
  const sendTyping = (room) => typingCh.current?.send({ type: 'broadcast', event: 'typing', payload: { room, uid: userId } });
  const setPresence = async (p) => {
    setStatusMenu(false);
    await supabase.from('profiles').update({ presence: p }).eq('id', userId);
    loadProfiles();
  };
  const pickServer = (id) => {
    setServerId(id);
    setView('server');
    setServerMenu(false);
  };
  const pickChannel = (id) => setPicked((p) => ({ ...p, [server.id]: id }));
  const saveChannel = async (e) => {
    e.preventDefault();
    const fields = { name: draft.name.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 32), topic: (draft.topic || '').trim() };
    if (draft.type === 'voice') fields.name = draft.name.trim().slice(0, 32);
    if (!fields.name) return;
    const { error } = draft.id
      ? await supabase.from('channels').update(fields).eq('id', draft.id)
      : await supabase.from('channels').insert({ ...fields, type: draft.type, server_id: server.id });
    if (error) setToast(error.message);
    setDraft(null);
    loadChannels();
  };
  const deleteChannel = async () => {
    await supabase.from('channels').delete().eq('id', draft.id);
    setDraft(null);
    loadChannels();
  };
  const leaveServer = async () => {
    setServerMenu(false);
    await supabase.from('server_members').delete().match({ server_id: server.id, user_id: userId });
    loadGuilds();
  };

  const badge = (key) => unread[key] && (unread[key].ping ? <span className="badge">{unread[key].n}</span> : <span className="pip" />);
  const dmUnread = Object.entries(unread).filter(([k, v]) => k.startsWith('d:') && v).reduce((s, [, v]) => s + v.n, 0);
  const serverUnread = (sid) => channels.filter((c) => c.server_id === sid).map((c) => unread[`c:${c.id}`]).filter(Boolean);
  const pending = friendRows.filter((r) => r.status === 'pending' && r.addressee === userId).length;
  const inVoice = (id) => Object.entries(online).filter(([, m]) => m?.voice === id).map(([uid]) => uid);
  const list = (type) => serverChannels.filter((c) => c.type === type);
  const voiceChannel = channels.find((c) => c.id === voice.channelId);
  const shared = { me, profiles, statusOf, openProfile: setCard };
  const isMember = (uid) => Boolean(server) && members.some((m) => m.server_id === server.id && m.user_id === uid);

  let content = null;
  if (view === 'home') {
    content = dmWith && profiles[dmWith]
      ? <Chat {...shared} room={{ key: activeRoom, kind: 'dm', dmKey: dmKey(userId, dmWith), partnerId: dmWith, title: profiles[dmWith].username, topic: profiles[dmWith].status }} typing={typing[activeRoom]} sendTyping={sendTyping} />
      : <Home {...shared} friendRows={friendRows} reload={loadFriends} openDM={openDM} />;
  } else if (!server) {
    content = (
      <div className="stage center">
        <div className="welcome-icon">🪐</div>
        <h2>Du bist noch auf keinem Server</h2>
        <p className="dim">Tritt mit einem Einladungslink bei oder erstelle deinen eigenen Server.</p>
        <button className="primary big" onClick={() => setServerDialog(true)}>Server hinzufügen</button>
      </div>
    );
  } else if (channel?.type === 'text') {
    content = (
      <Chat
        {...shared} colorOf={colorOf}
        can={{ send: can('send_messages'), attach: can('attach_files'), manage: can('manage_messages') }}
        room={{ key: activeRoom, kind: 'channel', id: channel.id, title: channel.name, topic: channel.topic }}
        typing={typing[activeRoom]} sendTyping={sendTyping}
      />
    );
  } else if (channel?.type === 'voice') {
    content = <VoiceStage channel={channel} voice={voice} profiles={profiles} canStream={can('stream')} canConnect={can('connect_voice')} />;
  } else {
    content = <div className="stage center"><p className="dim">Dieser Server hat noch keine Kanäle.</p></div>;
  }

  return (
    <div className="app">
      <nav className="rail">
        <button className={view === 'home' ? 'pill on' : 'pill'} title="Direktnachrichten" onClick={() => setView('home')}>
          <img src={mark} alt="Home" />
          {dmUnread + pending > 0 && <span className="badge">{dmUnread + pending}</span>}
        </button>
        <hr />
        <div className="rail-scroll">
          {servers.map((s) => {
            const un = serverUnread(s.id);
            const pings = un.filter((u) => u.ping).reduce((n, u) => n + u.n, 0);
            const on = view === 'server' && server?.id === s.id;
            return (
              <button key={s.id} className={on ? 'pill on' : un.length ? 'pill unread' : 'pill'} title={s.name} onClick={() => pickServer(s.id)}>
                {s.icon_url ? <img className="cover" src={s.icon_url} alt="" /> : <span className="initials">{s.name.slice(0, 2).toUpperCase()}</span>}
                {pings > 0 && <span className="badge">{pings}</span>}
              </button>
            );
          })}
          <button className="pill add" title="Server hinzufügen" onClick={() => setServerDialog(true)}>+</button>
        </div>
        <Updater />
      </nav>

      <aside className="side">
        {view === 'server' ? (
          <>
            <div className="side-head click" onClick={() => server && setServerMenu(!serverMenu)}>
              {server ? <><b className="grow">{server.name}</b><span className="dim">{serverMenu ? '✕' : '▾'}</span></> : <img className="logo" src={logo} alt="Hyco" />}
            </div>
            {serverMenu && server && (
              <div className="popover server-menu">
                {can('create_invite') && <a className="channel accent" onClick={() => { setServerMenu(false); setServerSettings('invites'); }}>📨 Leute einladen</a>}
                <a className="channel" onClick={() => { setServerMenu(false); setServerSettings('overview'); }}>⚙️ Servereinstellungen</a>
                {can('manage_channels') && <a className="channel" onClick={() => { setServerMenu(false); setDraft({ type: 'text', name: '', topic: '' }); }}>＃ Kanal erstellen</a>}
                {server.owner_id !== userId && <><hr /><a className="channel danger-text" onClick={leaveServer}>🚪 Server verlassen</a></>}
              </div>
            )}
            <div className="scroll">
              {server && (
                <>
                  <h4>Textkanäle {can('manage_channels') && <button title="Kanal erstellen" onClick={() => setDraft({ type: 'text', name: '', topic: '' })}>+</button>}</h4>
                  {list('text').map((c) => (
                    <a key={c.id} className={`channel${channel?.id === c.id ? ' active' : ''}${unread[`c:${c.id}`] ? ' unread' : ''}`} onClick={() => pickChannel(c.id)}>
                      <i className="hash">#</i><span className="grow">{c.name}</span>
                      {badge(`c:${c.id}`)}
                      {can('manage_channels') && <button className="gear" title="Kanal bearbeiten" onClick={(e) => { e.stopPropagation(); setDraft({ ...c }); }}>⚙</button>}
                    </a>
                  ))}
                  <h4>Sprachkanäle {can('manage_channels') && <button title="Kanal erstellen" onClick={() => setDraft({ type: 'voice', name: '' })}>+</button>}</h4>
                  {list('voice').map((c) => (
                    <div key={c.id}>
                      <a
                        className={`channel${channel?.id === c.id ? ' active' : ''}`}
                        onClick={() => { pickChannel(c.id); if (voice.channelId !== c.id && can('connect_voice')) voice.join(c.id).catch((e) => setToast(e.message)); }}
                      >
                        <i className="hash">🔊</i><span className="grow">{c.name}</span>
                        {can('manage_channels') && <button className="gear" title="Kanal bearbeiten" onClick={(e) => { e.stopPropagation(); setDraft({ ...c }); }}>⚙</button>}
                      </a>
                      {inVoice(c.id).map((uid) => (
                        <div className="occupant" key={uid} onClick={() => setCard(uid)}><Avatar profile={profiles[uid]} size={22} /> <span className="grow">{profiles[uid]?.username}</span>{online[uid]?.live && <span className="live">LIVE</span>}</div>
                      ))}
                    </div>
                  ))}
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="side-head"><b>Direktnachrichten</b></div>
            <div className="scroll">
              <a className={`channel big${!dmWith ? ' active' : ''}`} onClick={() => setDmWith(null)}>
                <i className="hash">👥</i><span className="grow">Freunde</span>{pending > 0 && <span className="badge">{pending}</span>}
              </a>
              <h4>Direktnachrichten</h4>
              {dmIds.filter((id) => profiles[id]).map((id) => (
                <a key={id} className={`channel dm${dmWith === id ? ' active' : ''}${unread[`d:${dmKey(userId, id)}`] ? ' unread' : ''}`} onClick={() => setDmWith(id)}>
                  <Avatar profile={profiles[id]} status={statusOf(id)} size={30} />
                  <span className="grow">{profiles[id].username}</span>
                  {badge(`d:${dmKey(userId, id)}`)}
                </a>
              ))}
              {!dmIds.length && <p className="dim small">Noch keine Unterhaltungen. Klick auf einen Freund, um zu schreiben.</p>}
            </div>
          </>
        )}

        {voice.channelId && (
          <div className="voicebar">
            <span className="grow"><b className="ok">● Sprachverbunden</b><small className="dim">{voiceChannel?.name}</small></span>
            <button title="Zum Kanal" onClick={() => { if (voiceChannel) { setServerId(voiceChannel.server_id); setPicked((p) => ({ ...p, [voiceChannel.server_id]: voiceChannel.id })); setView('server'); } }}>🖥️</button>
            <button title="Verlassen" className="danger" onClick={voice.leave}>📞</button>
          </div>
        )}
        <div className="userbar">
          <div className="who" onClick={() => setStatusMenu(!statusMenu)}>
            <Avatar profile={me} status={myStatus} size={34} />
            <span className="grow"><b>{me.username}</b><small className="dim">{me.status || PRESENCE.find(([k]) => k === me.presence)?.[1]}</small></span>
          </div>
          <button title="Mikrofon" className={voice.muted ? 'icon off' : 'icon'} disabled={!voice.channelId} onClick={voice.toggleMute}>🎙️</button>
          <button title="Deafen" className={voice.deaf ? 'icon off' : 'icon'} disabled={!voice.channelId} onClick={voice.toggleDeaf}>🎧</button>
          <button title="Einstellungen" className="icon" onClick={() => setSettings(true)}>⚙️</button>
          {statusMenu && (
            <div className="popover status-menu">
              {PRESENCE.map(([k, label]) => (
                <a key={k} className="channel" onClick={() => setPresence(k)}><i className={`dot static ${k === 'invisible' ? 'offline' : k}`} />{label}{me.presence === k && ' ✓'}</a>
              ))}
              <hr />
              <a className="channel" onClick={() => { setStatusMenu(false); setCard(userId); }}>Profil ansehen</a>
            </div>
          )}
        </div>
      </aside>

      <main>{content}</main>
      {view === 'server' && server && channel?.type === 'text' && (
        <Members server={server} profiles={profiles} members={members} roles={roles} memberRoles={memberRoles} statusOf={statusOf} openProfile={setCard} />
      )}

      {card && (
        <ProfileCard
          id={card} me={me} profiles={profiles} friendRows={friendRows} reloadFriends={loadFriends} statusOf={statusOf} openDM={openDM} onClose={() => setCard(null)}
          server={view === 'server' ? server : null} roles={roles} memberRoles={memberRoles} can={can} reloadGuilds={loadGuilds} isMember={isMember(card)}
        />
      )}
      {settings && <Settings me={me} voice={voice} onClose={() => setSettings(false)} />}
      {serverDialog && <ServerDialog onClose={() => setServerDialog(false)} onJoin={joinServer} onCreated={async (id) => { await loadGuilds(); pickServer(id); }} />}
      {serverSettings && server && (
        <ServerSettings
          server={server} initialTab={serverSettings} me={me} profiles={profiles} members={members} roles={roles} memberRoles={memberRoles}
          can={can} statusOf={statusOf} reload={loadGuilds} onClose={() => setServerSettings(null)}
          onDeleted={() => { setServerSettings(null); loadGuilds(); }}
        />
      )}
      {draft && (
        <div className="overlay" onClick={() => setDraft(null)}>
          <form className="card" onClick={(e) => e.stopPropagation()} onSubmit={saveChannel}>
            <h2>{draft.type === 'text' ? 'Textkanal' : 'Sprachkanal'} {draft.id ? 'bearbeiten' : 'erstellen'}</h2>
            {!draft.id && (
              <div className="row">
                <button type="button" className={draft.type === 'text' ? 'tab on' : 'tab'} onClick={() => setDraft({ ...draft, type: 'text' })}># Text</button>
                <button type="button" className={draft.type === 'voice' ? 'tab on' : 'tab'} onClick={() => setDraft({ ...draft, type: 'voice' })}>🔊 Sprache</button>
              </div>
            )}
            <label>Name</label>
            <input autoFocus maxLength={32} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            {draft.type === 'text' && (
              <>
                <label>Thema</label>
                <input maxLength={120} placeholder="Worum geht es hier?" value={draft.topic || ''} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} />
              </>
            )}
            <div className="row end">
              {draft.id && <button type="button" className="danger" onClick={deleteChannel}>Kanal löschen</button>}
              <span className="grow" />
              <button type="button" onClick={() => setDraft(null)}>Abbrechen</button>
              <button className="primary">{draft.id ? 'Speichern' : 'Erstellen'}</button>
            </div>
          </form>
        </div>
      )}
      {toast && <div className="toast" onClick={() => setToast('')}>{toast}</div>}
    </div>
  );
}
