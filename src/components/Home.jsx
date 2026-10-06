import { useState } from 'react';
import { supabase } from '../lib/supabase';
import Avatar from './Avatar.jsx';

const STATUS_TEXT = { online: 'Online', idle: 'Abwesend', dnd: 'Bitte nicht stören', offline: 'Offline' };

// Freunde-Seite im Home-Bereich (Tabs wie bei Discord)
export default function Home({ me, profiles, friendRows, reload, statusOf, openDM, openProfile }) {
  const [tab, setTab] = useState('online');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [msg, setMsg] = useState('');

  const other = (r) => (r.requester === me.id ? r.addressee : r.requester);
  const friends = friendRows.filter((r) => r.status === 'accepted');
  const incoming = friendRows.filter((r) => r.status === 'pending' && r.addressee === me.id);
  const outgoing = friendRows.filter((r) => r.status === 'pending' && r.requester === me.id);
  const known = new Set(friendRows.map(other));

  const search = async (e) => {
    e.preventDefault();
    setMsg('');
    const q = query.trim().replace(/[%_]/g, '');
    if (!q) return setResults(null);
    const { data } = await supabase.from('profiles').select('*').ilike('username', `%${q}%`).neq('id', me.id).limit(12);
    setResults(data || []);
  };
  const request = async (id) => {
    const { error } = await supabase.from('friendships').insert({ requester: me.id, addressee: id });
    setMsg(error ? 'Anfrage existiert bereits.' : 'Freundschaftsanfrage gesendet.');
    reload();
  };
  const accept = async (r) => {
    await supabase.from('friendships').update({ status: 'accepted' }).eq('id', r.id);
    reload();
  };
  const remove = async (r) => {
    await supabase.from('friendships').delete().eq('id', r.id);
    reload();
  };

  const Row = ({ id, children, sub }) => {
    const p = profiles[id];
    const st = statusOf(id);
    return (
      <div className="friend">
        <Avatar profile={p} status={st} size={38} onClick={() => openProfile(id)} />
        <span className="grow"><b>{p?.username || '…'}</b><small className="dim">{sub || p?.status || STATUS_TEXT[st]}</small></span>
        {children}
      </div>
    );
  };

  const list = tab === 'online' ? friends.filter((r) => statusOf(other(r)) !== 'offline') : friends;

  return (
    <div className="home">
      <header className="topbar">
        <span className="title">👥 Freunde</span>
        {[['online', 'Online'], ['all', 'Alle'], ['pending', `Ausstehend${incoming.length ? ` (${incoming.length})` : ''}`]].map(([k, label]) => (
          <button key={k} className={tab === k ? 'tab on' : 'tab'} onClick={() => setTab(k)}>{label}</button>
        ))}
        <button className={tab === 'add' ? 'tab add on' : 'tab add'} onClick={() => setTab('add')}>Freund hinzufügen</button>
      </header>
      <div className="home-body">
        {tab === 'add' && (
          <>
            <h3>Freund hinzufügen</h3>
            <p className="dim">Suche nach dem Hyco-Benutzernamen.</p>
            <form onSubmit={search} className="addbox">
              <input autoFocus placeholder="Benutzername eingeben…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <button className="primary">Suchen</button>
            </form>
            {msg && <p className="ok">{msg}</p>}
            {results && !results.length && <p className="dim">Niemand gefunden.</p>}
            {(results || []).map((p) => (
              <Row key={p.id} id={p.id}>
                {known.has(p.id) ? <span className="dim small">bereits verbunden</span> : <button className="primary" onClick={() => request(p.id)}>Anfrage senden</button>}
              </Row>
            ))}
          </>
        )}
        {tab === 'pending' && (
          <>
            <h4>Eingehend — {incoming.length}</h4>
            {incoming.map((r) => (
              <Row key={r.id} id={r.requester} sub="Eingehende Freundschaftsanfrage">
                <button className="round ok-bg" title="Annehmen" onClick={() => accept(r)}>✓</button>
                <button className="round" title="Ablehnen" onClick={() => remove(r)}>✕</button>
              </Row>
            ))}
            <h4>Gesendet — {outgoing.length}</h4>
            {outgoing.map((r) => (
              <Row key={r.id} id={r.addressee} sub="Ausgehende Freundschaftsanfrage">
                <button className="round" title="Zurückziehen" onClick={() => remove(r)}>✕</button>
              </Row>
            ))}
          </>
        )}
        {(tab === 'online' || tab === 'all') && (
          <>
            <h4>{tab === 'online' ? 'Online' : 'Alle Freunde'} — {list.length}</h4>
            {list.map((r) => (
              <Row key={r.id} id={other(r)}>
                <button className="round" title="Nachricht" onClick={() => openDM(other(r))}>💬</button>
                <button className="round" title="Entfernen" onClick={() => remove(r)}>✕</button>
              </Row>
            ))}
            {!list.length && <div className="empty"><div className="big">🛰️</div><p className="dim">{tab === 'online' ? 'Gerade ist niemand online.' : 'Noch keine Freunde – füge welche hinzu!'}</p></div>}
          </>
        )}
      </div>
    </div>
  );
}
