import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { bus, roomOfMessage } from '../lib/bus';
import { renderContent, mentionsUser, isImage } from '../lib/format.jsx';
import Avatar from './Avatar.jsx';
import { isSurge, uploadLimit, PERKS } from '../lib/surge';

const QUICK = ['👍', '❤️', '😂', '🔥', '😮', '😢'];
const EMOJI = '😀 😂 🤣 😊 😍 😎 🤔 😴 😭 😡 🥳 🤯 😱 🙄 😏 😇 🫡 🫠 🤡 💀 👀 👍 👎 👏 🙏 💪 🤝 🤌 ❤️ 🔥 💯 ✅ ❌ ⭐ ✨ ⚡ 🎉 🏆 🎮 🎧 🎵 🍕 🍺 ☕ 🚀 💩'.split(' ');

const dayLabel = (d) => new Date(d).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeLabel = (d) => new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

function EmojiPicker({ onPick }) {
  return (
    <div className="emoji-picker" onClick={(e) => e.stopPropagation()}>
      {EMOJI.map((e) => <button type="button" key={e} onClick={() => onPick(e)}>{e}</button>)}
    </div>
  );
}

// room: { key, kind: 'channel' | 'dm', id?, dmKey?, partnerId?, title, topic }
export default function Chat({ room, me, profiles, typing, sendTyping, statusOf, openProfile, appSettings = {}, openSurge = () => {}, can = { send: true, attach: true, manage: false }, colorOf = () => undefined }) {
  const [messages, setMessages] = useState([]);
  const [reactions, setReactions] = useState({});
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [picker, setPicker] = useState(null); // message id | 'composer'
  const [pins, setPins] = useState(null);
  const [query, setQuery] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState(null); // großes Bild intern anzeigen
  const [mention, setMention] = useState(null); // { query, index } während man @name tippt
  const [fresh, setFresh] = useState(0); // neue Nachrichten, während man hochgescrollt hat
  const [gif, setGif] = useState(null); // { q, results, loading } für die GIF-Suche
  const [, tick] = useState(0);
  const box = useRef(null);
  const input = useRef(null);
  const file = useRef(null);
  const stick = useRef(true);
  const lastTyping = useRef(0);

  const names = useMemo(() => new Set(Object.values(profiles).map((p) => p.username.toLowerCase())), [profiles]);
  const scope = (q) => (room.kind === 'channel' ? q.eq('channel_id', room.id) : q.eq('dm_key', room.dmKey));

  const loadReactions = async (list) => {
    const ids = list.map((m) => m.id);
    if (!ids.length) return;
    const { data } = await supabase.from('reactions').select('*').in('message_id', ids);
    setReactions((r) => {
      const next = { ...r };
      ids.forEach((id) => (next[id] = []));
      (data || []).forEach((x) => (next[x.message_id] ||= []).push(x));
      return next;
    });
  };

  useEffect(() => {
    let ok = true;
    setMessages([]);
    setReactions({});
    setReplyTo(null);
    setEditing(null);
    setPins(null);
    setQuery('');
    setText('');
    stick.current = true;
    (async () => {
      const { data } = await scope(supabase.from('messages').select('*')).order('id', { ascending: false }).limit(50);
      if (!ok) return;
      const list = (data || []).reverse();
      setMessages(list);
      setHasMore(list.length === 50);
      loadReactions(list);
    })();
    input.current?.focus();
    return () => {
      ok = false;
    };
  }, [room.key]);

  useEffect(() => {
    const offMsg = bus.on('message', ({ eventType, new: n, old: o }) => {
      if (eventType === 'DELETE') return setMessages((l) => l.filter((m) => m.id !== o.id));
      if (roomOfMessage(n) !== room.key) return;
      if (eventType === 'INSERT' && !stick.current && n.user_id !== me.id) setFresh((f) => f + 1);
      setMessages((l) => (eventType === 'INSERT' ? (l.some((m) => m.id === n.id) ? l : [...l, n]) : l.map((m) => (m.id === n.id ? n : m))));
    });
    const offReact = bus.on('reaction', ({ eventType, new: n, old: o }) => {
      const row = eventType === 'DELETE' ? o : n;
      setReactions((r) => {
        const rest = (r[row.message_id] || []).filter((x) => !(x.user_id === row.user_id && x.emoji === row.emoji));
        return { ...r, [row.message_id]: eventType === 'DELETE' ? rest : [...rest, row] };
      });
    });
    const timer = setInterval(() => tick((n) => n + 1), 2000); // Tipp-Anzeige auslaufen lassen
    const close = () => setPicker(null);
    window.addEventListener('click', close);
    return () => {
      offMsg();
      offReact();
      clearInterval(timer);
      window.removeEventListener('click', close);
    };
  }, [room.key]);

  useLayoutEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [messages, reactions]);

  // Esc schließt die große Bildanzeige
  useEffect(() => {
    if (!lightbox) return undefined;
    const onEsc = (e) => e.key === 'Escape' && setLightbox(null);
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [lightbox]);

  const onScroll = () => {
    const el = box.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (stick.current) setFresh(0);
  };
  const jumpDown = () => {
    stick.current = true;
    setFresh(0);
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  };

  // @-Vorschläge: Wort vor dem Cursor, das mit @ beginnt
  const mentionMatches = mention
    ? Object.values(profiles).filter((p) => p.username.toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 6)
    : [];
  const updateMention = (el) => {
    const before = el.value.slice(0, el.selectionStart);
    const m = before.match(/(?:^|\s)@([\wäöüÄÖÜß.-]*)$/);
    setMention(m ? { query: m[1], index: 0 } : null);
  };
  const pickMention = (name) => {
    const el = input.current;
    const before = el.value.slice(0, el.selectionStart).replace(/@[\wäöüÄÖÜß.-]*$/, `@${name} `);
    const after = el.value.slice(el.selectionStart);
    setText(before + after);
    setMention(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  };

  const loadOlder = async () => {
    const el = box.current;
    const before = el.scrollHeight;
    const { data } = await scope(supabase.from('messages').select('*')).lt('id', messages[0].id).order('id', { ascending: false }).limit(50);
    const older = (data || []).reverse();
    stick.current = false;
    setMessages((l) => [...older, ...l]);
    setHasMore(older.length === 50);
    loadReactions(older);
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight - before;
    });
  };

  const insert = async (fields) => {
    const base = room.kind === 'channel' ? { channel_id: room.id } : { dm_key: room.dmKey, recipient_id: room.partnerId };
    const { data, error: err } = await supabase
      .from('messages')
      .insert({ ...base, user_id: me.id, reply_to: replyTo?.id ?? null, ...fields })
      .select()
      .single();
    if (err) return setError(err.message);
    stick.current = true;
    setMessages((l) => (l.some((m) => m.id === data.id) ? l : [...l, data]));
    setReplyTo(null);
  };

  const submit = async () => {
    const content = text.trim();
    setError('');
    if (editing) {
      if (content) await supabase.from('messages').update({ content, edited_at: new Date().toISOString() }).eq('id', editing.id);
      setEditing(null);
      setText('');
      return;
    }
    if (!content) return;
    setText('');
    if (input.current) input.current.style.height = 'auto';
    await insert({ content });
  };

  const upload = async (f) => {
    if (!f) return;
    setError('');
    const limit = uploadLimit(me);
    if (f.size > limit) return setError(`Anhänge dürfen max. ${limit / 1024 / 1024} MB groß sein${isSurge(me) ? '' : ' – mit Hyco Surge bis 25 MB'}.`);
    setBusy(true);
    const path = `${me.id}/${Date.now()}-${f.name.replace(/[^\w.]/g, '_')}`;
    const { error: err } = await supabase.storage.from('attachments').upload(path, f);
    if (err) setError(err.message);
    else {
      await insert({ content: text.trim(), attachment_url: supabase.storage.from('attachments').getPublicUrl(path).data.publicUrl });
      setText('');
    }
    setBusy(false);
  };

  const onKey = (e) => {
    if (mention && mentionMatches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        return setMention((m) => ({ ...m, index: (m.index + (e.key === 'ArrowDown' ? 1 : mentionMatches.length - 1)) % mentionMatches.length }));
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        return pickMention(mentionMatches[mention.index].username);
      }
      if (e.key === 'Escape') return setMention(null);
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      setReplyTo(null);
      if (editing) {
        setEditing(null);
        setText('');
      }
    } else if (e.key === 'ArrowUp' && !text && !editing) {
      const mine = [...messages].reverse().find((m) => m.user_id === me.id);
      if (mine) startEdit(mine);
    }
  };

  const onInput = (e) => {
    setText(e.target.value);
    updateMention(e.target);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
    if (Date.now() - lastTyping.current > 2500) {
      lastTyping.current = Date.now();
      sendTyping(room.key);
    }
  };

  const startEdit = (m) => {
    setEditing(m);
    setText(m.content);
    input.current?.focus();
  };

  const react = async (m, emoji) => {
    setPicker(null);
    const mine = (reactions[m.id] || []).some((r) => r.user_id === me.id && r.emoji === emoji);
    if (mine) await supabase.from('reactions').delete().match({ message_id: m.id, user_id: me.id, emoji });
    else await supabase.from('reactions').insert({ message_id: m.id, user_id: me.id, emoji });
  };

  // GIF-Suche über KLIPY (Tenor wurde 2026 abgeschaltet) – Surge-Vorteil
  // API: https://api.klipy.com/api/v1/<KEY>/gifs/search?q=..&per_page=24  bzw. /gifs/trending
  const searchGifs = async (q) => {
    const key = (appSettings.tenor_key || '').trim();
    if (!key) return setGif({ q, results: [], loading: false, error: 'GIF-Suche ist noch nicht eingerichtet (KLIPY-Key fehlt, siehe Einstellungen → Hyco Surge).' });
    setGif((g) => ({ ...(g || {}), q, loading: true, error: '' }));
    try {
      const base = (appSettings.gif_api_base || 'https://api.klipy.com').replace(/\/$/, '');
      const params = `per_page=24&rating=pg-13&customer_id=${encodeURIComponent(me?.id || 'hyco')}`;
      const url = q.trim()
        ? `${base}/api/v1/${encodeURIComponent(key)}/gifs/search?q=${encodeURIComponent(q)}&${params}`
        : `${base}/api/v1/${encodeURIComponent(key)}/gifs/trending?${params}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.result === false) throw new Error(data.message || 'API-Fehler');
      const list = data.data?.data || data.data || data.results || [];
      const pick = (r) => {
        if (r.type === 'ad') return {};
        const f = r.file || r.files || r.media_formats || {};
        const u = (v) => v?.gif?.url || v?.webp?.url || v?.url;
        const gifUrl = u(f.hd) || u(f.md) || u(f.gif) || r.url;
        const tiny = u(f.sm) || u(f.xs) || u(f.tinygif) || gifUrl;
        return { id: r.id || r.slug || gifUrl, preview: tiny, url: gifUrl };
      };
      setGif({ q, loading: false, error: '', results: list.map(pick).filter((r) => r.url) });
    } catch (e) {
      setGif({ q, loading: false, results: [], error: `GIF-Suche fehlgeschlagen (${e.message}). Key und Anbieter in den Einstellungen prüfen.` });
    }
  };
  const sendGif = async (url) => {
    setGif(null);
    await insert({ content: text.trim(), attachment_url: url });
    setText('');
  };

  const togglePins = async () => {
    if (pins) return setPins(null);
    const { data } = await scope(supabase.from('messages').select('*')).eq('pinned', true).order('id', { ascending: false });
    setPins(data || []);
  };

  const byId = useMemo(() => Object.fromEntries(messages.map((m) => [m.id, m])), [messages]);
  const shown = query ? messages.filter((m) => m.content.toLowerCase().includes(query.toLowerCase())) : messages;
  const typers = Object.entries(typing || {})
    .filter(([uid, ts]) => uid !== me.id && Date.now() - ts < 4000)
    .map(([uid]) => profiles[uid]?.username)
    .filter(Boolean);
  const ctx = { names };

  return (
    <div className="chat">
      <header className="topbar">
        <span className="title">{room.kind === 'channel' ? <i className="hash">#</i> : <i className="hash">@</i>}{room.title}</span>
        {room.topic && <span className="topic">{room.topic}</span>}
        <span className="grow" />
        <input className="search" placeholder="Suchen" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className={pins ? 'icon on' : 'icon'} title="Angepinnte Nachrichten" onClick={togglePins}>📌</button>
        {pins && (
          <div className="popover pins">
            <h4>Angepinnt</h4>
            {!pins.length && <p className="dim small">Noch nichts angepinnt.</p>}
            {pins.map((m) => (
              <div className="pin" key={m.id}>
                <b>{profiles[m.user_id]?.username}</b> <span className="dim time">{timeLabel(m.created_at)}</span>
                <p>{m.content || '📎 Anhang'}</p>
              </div>
            ))}
          </div>
        )}
      </header>

      <div className="messages" ref={box} onScroll={onScroll}>
        {hasMore && !query && <button className="older" onClick={loadOlder}>Ältere Nachrichten laden</button>}
        {!hasMore && !query && (
          <div className="welcome">
            <div className="welcome-icon">{room.kind === 'channel' ? '#' : '@'}</div>
            <h2>{room.kind === 'channel' ? `Willkommen in #${room.title}` : room.title}</h2>
            <p className="dim">{room.kind === 'channel' ? 'Das ist der Anfang dieses Kanals.' : `Das ist der Anfang deiner Direktnachrichten mit ${room.title}.`}</p>
          </div>
        )}
        {shown.map((m, i) => {
          const p = profiles[m.user_id];
          const prev = shown[i - 1];
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
          const grouped = !newDay && prev.user_id === m.user_id && !m.reply_to && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60000;
          const parent = m.reply_to && byId[m.reply_to];
          const groups = {};
          (reactions[m.id] || []).forEach((r) => (groups[r.emoji] = [...(groups[r.emoji] || []), r.user_id]));
          const hit = m.user_id !== me.id && mentionsUser(m.content, me.username);
          return (
            <div key={m.id}>
              {newDay && <div className="divider"><span>{dayLabel(m.created_at)}</span></div>}
              <div className={`msg${grouped ? ' grouped' : ''}${hit ? ' hit' : ''}${editing?.id === m.id ? ' editing' : ''}`}>
                {m.reply_to && (
                  <div className="reply-ref">↱ <b>{parent ? profiles[parent.user_id]?.username : 'Nachricht'}</b> {parent ? (parent.content || '📎 Anhang').slice(0, 90) : 'nicht geladen'}</div>
                )}
                <div className="gutter">
                  {grouped ? <span className="hover-time">{timeLabel(m.created_at)}</span> : <Avatar profile={p} size={40} onClick={() => openProfile(m.user_id)} />}
                </div>
                <div className="body">
                  {!grouped && (
                    <div className="meta">
                      <b className="author" style={{ color: colorOf(m.user_id) || p?.accent }} onClick={() => openProfile(m.user_id)}>{p?.username || 'Unbekannt'}</b>
                      {isSurge(p) && <span className="surge" title="Hyco Surge">⚡</span>}
                      <span className="dim time">{timeLabel(m.created_at)}</span>
                      {m.pinned && <span className="time">📌</span>}
                    </div>
                  )}
                  {m.content && <div className="content">{renderContent(m.content, ctx)}{m.edited_at && <span className="edited"> (bearbeitet)</span>}</div>}
                  {m.attachment_url && (isImage(m.attachment_url)
                    ? <img className="attach" src={m.attachment_url} alt="Anhang" loading="lazy" onClick={() => setLightbox(m.attachment_url)} />
                    : <a className="file" href={m.attachment_url} target="_blank" rel="noreferrer">📎 {decodeURIComponent(m.attachment_url.split('/').pop().replace(/^\d+-/, ''))}</a>)}
                  {Object.keys(groups).length > 0 && (
                    <div className="reactions">
                      {Object.entries(groups).map(([emoji, users]) => (
                        <button key={emoji} className={users.includes(me.id) ? 'chip mine' : 'chip'} title={users.map((u) => profiles[u]?.username).join(', ')} onClick={() => react(m, emoji)}>
                          {emoji} <span>{users.length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="tools" onClick={(e) => e.stopPropagation()}>
                  {QUICK.slice(0, 3).map((e) => <button key={e} onClick={() => react(m, e)}>{e}</button>)}
                  <button title="Reaktion" onClick={() => setPicker(picker === m.id ? null : m.id)}>😀</button>
                  <button title="Antworten" onClick={() => { setReplyTo(m); input.current?.focus(); }}>↩</button>
                  {m.user_id === me.id && <button title="Bearbeiten" onClick={() => startEdit(m)}>✏️</button>}
                  {(can.manage || room.kind === 'dm') && <button title={m.pinned ? 'Lösen' : 'Anpinnen'} onClick={() => supabase.rpc('toggle_pin', { mid: m.id })}>📌</button>}
                  {(m.user_id === me.id || can.manage) && <button title="Löschen" onClick={() => supabase.from('messages').delete().eq('id', m.id)}>🗑️</button>}
                  {picker === m.id && <EmojiPicker onPick={(e) => react(m, e)} />}
                </div>
              </div>
            </div>
          );
        })}
        {query && !shown.length && <p className="dim center-text">Keine Treffer für „{query}".</p>}
      </div>

      <div className="composer">
        {fresh > 0 && <button className="jump" onClick={jumpDown}>↓ {fresh} neue {fresh === 1 ? 'Nachricht' : 'Nachrichten'}</button>}
        {mention && mentionMatches.length > 0 && (
          <div className="popover mentions">
            {mentionMatches.map((p, i) => (
              <a key={p.id} className={i === mention.index ? 'channel active' : 'channel'} onMouseDown={(e) => { e.preventDefault(); pickMention(p.username); }}>
                <Avatar profile={p} size={22} /> {p.username}
              </a>
            ))}
          </div>
        )}
        {replyTo && (
          <div className="bar">Antwort an <b>{profiles[replyTo.user_id]?.username}</b><span className="grow" /><button className="icon" onClick={() => setReplyTo(null)}>✕</button></div>
        )}
        {editing && (
          <div className="bar">Nachricht bearbeiten · Esc zum Abbrechen<span className="grow" /><button className="icon" onClick={() => { setEditing(null); setText(''); }}>✕</button></div>
        )}
        {error && <div className="bar error">{error}</div>}
        <div className="inputrow">
          {can.attach && <button className="icon" title="Datei anhängen" disabled={busy} onClick={() => file.current.click()}>{busy ? '…' : '＋'}</button>}
          <input ref={file} type="file" hidden onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
          <textarea
            ref={input} rows={1} value={text} maxLength={4000} disabled={!can.send}
            placeholder={!can.send ? 'Du darfst in diesem Kanal nicht schreiben.' : room.kind === 'channel' ? `Nachricht an #${room.title}` : `Nachricht an @${room.title}`}
            onChange={onInput} onKeyDown={onKey}
            onPaste={(e) => { const f = [...e.clipboardData.files][0]; if (f && can.attach) { e.preventDefault(); upload(f); } }}
          />
          {can.attach && (
            <button className={isSurge(me) ? 'icon gifbtn' : 'icon gifbtn locked'} title={isSurge(me) ? 'GIF suchen' : 'GIF-Suche – mit Hyco Surge'} onClick={(e) => { e.stopPropagation(); if (!isSurge(me)) return openSurge(); if (gif) setGif(null); else searchGifs(''); }}>GIF</button>
          )}
          <button className="icon" title="Emoji" onClick={(e) => { e.stopPropagation(); setPicker(picker === 'composer' ? null : 'composer'); }}>😊</button>
          {picker === 'composer' && <EmojiPicker onPick={(e) => { setText((t) => t + e); input.current?.focus(); }} />}
        </div>
        {gif && (
          <div className="popover gifs" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <input autoFocus placeholder="GIFs suchen…" value={gif.q} onChange={(e) => searchGifs(e.target.value)} />
              <button className="icon" onClick={() => setGif(null)}>✕</button>
            </div>
            {gif.error && <p className="error small">{gif.error}</p>}
            <div className="gif-grid">
              {gif.results?.map((r) => <img key={r.id} src={r.preview} alt="" loading="lazy" onClick={() => sendGif(r.url)} />)}
            </div>
            {gif.loading && <p className="dim small">Lade…</p>}
            <p className="dim small" style={{ margin: 0 }}>Powered by KLIPY</p>
          </div>
        )}
        <div className="typing">{typers.length > 0 && <><span className="dots"><i /><i /><i /></span> <b>{typers.join(', ')}</b> {typers.length === 1 ? 'schreibt' : 'schreiben'}…</>}</div>
      </div>

      {lightbox && (
        <div className="overlay lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" onClick={(e) => e.stopPropagation()} />
          <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <a href={lightbox} target="_blank" rel="noreferrer">Im Browser öffnen</a>
            <button className="icon" title="Schließen" onClick={() => setLightbox(null)}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}
