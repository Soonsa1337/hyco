import { useEffect, useState } from 'react';
import { supabase, inviteCode } from '../lib/supabase';
import Avatar from './Avatar.jsx';
import { bus } from '../lib/bus';

export const THEMES = { ember: 'Ember', blurple: 'Blurple', mint: 'Mint', sakura: 'Sakura', cyber: 'Cyber' };
const ACCENTS = ['#ff7a1a', '#f04747', '#f47fff', '#7289da', '#3ba55d', '#00d4ff', '#faa61a', '#ffffff'];

export default function Settings({ me, voice, onClose }) {
  const [tab, setTab] = useState('profile');
  const [username, setUsername] = useState(me.username);
  const [status, setStatus] = useState(me.status || '');
  const [bio, setBio] = useState(me.bio || '');
  const [accent, setAccent] = useState(me.accent || ACCENTS[0]);
  const [avatarUrl, setAvatarUrl] = useState(me.avatar_url);
  const [devices, setDevices] = useState([]);
  const [input, setInput] = useState(localStorage.getItem('audioInput') || '');
  const [output, setOutput] = useState(localStorage.getItem('audioOutput') || '');
  const [ptt, setPtt] = useState(localStorage.getItem('ptt') || '');
  const [capture, setCapture] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'ember');
  const [notify, setNotify] = useState(localStorage.getItem('notify') !== 'off');
  const [msg, setMsg] = useState('');
  const [appVersion, setAppVersion] = useState('');
  const [rel, setRel] = useState({ done: '' });

  useEffect(() => {
    window.desktop?.version?.().then(setAppVersion);
  }, []);

  useEffect(() => {
    // Einmal Mikrofonzugriff anfragen, sonst liefert enumerateDevices keine Namen
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => s.getTracks().forEach((t) => t.stop()))
      .catch(() => {})
      .finally(async () => setDevices(await navigator.mediaDevices.enumerateDevices()));
  }, []);

  useEffect(() => {
    if (!capture) return undefined;
    const onKey = (e) => {
      e.preventDefault();
      const code = e.code === 'Escape' ? '' : e.code;
      localStorage.setItem('ptt', code);
      setPtt(code);
      setCapture(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capture]);

  const upload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setMsg('Avatar max. 2 MB.');
    const path = `${me.id}/${Date.now()}-${file.name.replace(/[^\w.]/g, '_')}`;
    const { error } = await supabase.storage.from('avatars').upload(path, file);
    if (error) return setMsg(error.message);
    setAvatarUrl(supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl);
  };

  const save = async (e) => {
    e.preventDefault();
    const { error } = await supabase
      .from('profiles')
      .update({ username: username.trim(), status: status.trim(), bio: bio.trim(), accent, avatar_url: avatarUrl })
      .eq('id', me.id);
    if (error) return setMsg(error.code === '23505' ? 'Benutzername ist vergeben.' : error.message);
    onClose();
  };

  const pick = (kind, set) => (e) => {
    set(e.target.value);
    voice.setDevice(kind, e.target.value);
  };
  const options = (kind) =>
    devices.filter((d) => d.kind === kind).map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>);
  const applyTheme = (t) => {
    setTheme(t);
    localStorage.setItem('theme', t);
    document.documentElement.dataset.theme = t;
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="settings" onClick={(e) => e.stopPropagation()}>
        <nav>
          <h4>Einstellungen</h4>
          {[['profile', 'Mein Profil'], ['audio', 'Sprache & Audio'], ['look', 'Darstellung'], ['invite', 'Freunde einladen'], ['updates', 'Updates']].map(([k, label]) => (
            <a key={k} className={tab === k ? 'channel active' : 'channel'} onClick={() => setTab(k)}>{label}</a>
          ))}
          <span className="grow" />
          <a className="channel danger-text" onClick={() => supabase.auth.signOut()}>Ausloggen</a>
        </nav>
        <form onSubmit={save}>
          {tab === 'profile' && (
            <>
              <h2>Mein Profil</h2>
              <div className="preview" style={{ background: `linear-gradient(135deg, ${accent}, #1b2030)` }}>
                <Avatar profile={{ username, avatar_url: avatarUrl, accent }} size={72} />
                <div><b>{username}</b><small>{status || 'Online'}</small></div>
              </div>
              <label>Avatar</label>
              <input type="file" accept="image/*" onChange={upload} />
              <label>Benutzername</label>
              <input value={username} minLength={3} maxLength={24} required onChange={(e) => setUsername(e.target.value)} />
              <label>Status-Text</label>
              <input value={status} maxLength={80} placeholder="Was machst du gerade?" onChange={(e) => setStatus(e.target.value)} />
              <label>Über mich</label>
              <textarea rows={3} maxLength={300} value={bio} onChange={(e) => setBio(e.target.value)} />
              <label>Profilfarbe</label>
              <div className="swatches">
                {ACCENTS.map((c) => <button type="button" key={c} className={c === accent ? 'swatch on' : 'swatch'} style={{ background: c }} onClick={() => setAccent(c)} />)}
              </div>
            </>
          )}
          {tab === 'audio' && (
            <>
              <h2>Sprache & Audio</h2>
              <label>Eingabegerät (Mikrofon)</label>
              <select value={input} onChange={pick('audioinput', setInput)}><option value="">Systemstandard</option>{options('audioinput')}</select>
              <label>Ausgabegerät (Kopfhörer/Lautsprecher)</label>
              <select value={output} onChange={pick('audiooutput', setOutput)}><option value="">Systemstandard</option>{options('audiooutput')}</select>
              <label>Kamera-Auflösung</label>
              <select defaultValue={localStorage.getItem('camRes') || '720p'} onChange={(e) => localStorage.setItem('camRes', e.target.value)}>
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
              </select>
              <label>Push-to-Talk</label>
              <div className="row">
                <button type="button" className={capture ? 'primary' : ''} onClick={() => setCapture(true)}>
                  {capture ? 'Taste drücken… (Esc = aus)' : ptt ? `Taste: ${ptt}` : 'Aus – Sprachaktivierung'}
                </button>
                {ptt && <button type="button" onClick={() => { localStorage.setItem('ptt', ''); setPtt(''); }}>Deaktivieren</button>}
              </div>
              <p className="dim small">Push-to-Talk funktioniert, solange das Hyco-Fenster im Vordergrund ist. Änderung gilt ab dem nächsten Beitritt.</p>
            </>
          )}
          {tab === 'look' && (
            <>
              <h2>Darstellung</h2>
              <label>Farbschema</label>
              <div className="themes">
                {Object.entries(THEMES).map(([k, label]) => (
                  <button type="button" key={k} data-theme={k} className={k === theme ? 'theme on' : 'theme'} onClick={() => applyTheme(k)}><i />{label}</button>
                ))}
              </div>
              <label className="row check">
                <input type="checkbox" checked={notify} onChange={(e) => { setNotify(e.target.checked); localStorage.setItem('notify', e.target.checked ? 'on' : 'off'); }} />
                Desktop-Benachrichtigungen und Töne bei Direktnachrichten und Erwähnungen
              </label>
            </>
          )}
          {tab === 'invite' && (
            <>
              <h2>Freunde einladen</h2>
              <p className="dim">Gib deinen Freunden die Hyco-Setup-Datei und diesen Code. Beim ersten Start fügen sie ihn unter „Einladungscode" ein.</p>
              <textarea readOnly rows={5} value={inviteCode} onFocus={(e) => e.target.select()} />
              <button type="button" onClick={() => navigator.clipboard.writeText(inviteCode)}>Code kopieren</button>
            </>
          )}
          {tab === 'updates' && (
            <>
              <h2>Updates</h2>
              <p>Installierte Version: <b>{appVersion || '–'}</b></p>
              <div className="row"><button type="button" onClick={() => { bus.emit('check-update'); setMsg(''); setRel({ ...rel, done: 'Suche läuft – wenn es ein Update gibt, erscheint unten links in der Leiste ein ⬇-Knopf.' }); }}>Nach Updates suchen</button></div>
              <p className="dim small" style={{ margin: 0 }}>Neue Versionen werden automatisch von GitHub geladen und per ⬇-Knopf angeboten. Alle Versionen: github.com/Soonsa1337/hyco/releases</p>
              {rel.done && <p className="ok">{rel.done}</p>}
            </>
          )}
          {msg && <p className="error">{msg}</p>}
          <div className="row end">
            <span className="grow" />
            <button type="button" onClick={onClose}>Schließen</button>
            {tab === 'profile' && <button className="primary">Speichern</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
