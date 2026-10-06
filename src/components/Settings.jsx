import { useEffect, useState } from 'react';
import { supabase, inviteCode } from '../lib/supabase';
import Avatar from './Avatar.jsx';
import { bus } from '../lib/bus';
import { isSurge, isAnimatedImage, PERKS } from '../lib/surge';

export const THEMES = { ember: 'Ember', blurple: 'Blurple', mint: 'Mint', sakura: 'Sakura', cyber: 'Cyber' };
const ACCENTS = ['#ff7a1a', '#f04747', '#f47fff', '#7289da', '#3ba55d', '#00d4ff', '#faa61a', '#ffffff'];

export default function Settings({ me, profiles = {}, appSettings = {}, voice, initialTab = 'profile', onClose }) {
  const [tab, setTab] = useState(initialTab);
  const surge = isSurge(me);
  const [bannerUrl, setBannerUrl] = useState(me.banner_url);
  const [grant, setGrant] = useState({ user: '', months: '1', msg: '' });
  const [adm, setAdm] = useState({ tenor_key: appSettings.tenor_key || '', surge_info: appSettings.surge_info || '', stripe_enabled: appSettings.stripe_enabled === 'on', msg: '' });
  const [buying, setBuying] = useState(false);
  const [username, setUsername] = useState(me.username);
  const [status, setStatus] = useState(me.status || '');
  const [bio, setBio] = useState(me.bio || '');
  const [accent, setAccent] = useState(me.accent || ACCENTS[0]);
  const [avatarUrl, setAvatarUrl] = useState(me.avatar_url);
  const [devices, setDevices] = useState([]);
  const [input, setInput] = useState(localStorage.getItem('audioInput') || '');
  const [output, setOutput] = useState(localStorage.getItem('audioOutput') || '');
  const [ptt, setPtt] = useState(localStorage.getItem('ptt') || '');
  const [mic, setMic] = useState({ ns: localStorage.getItem('micNs') !== 'off', ec: localStorage.getItem('micEc') !== 'off', agc: localStorage.getItem('micAgc') !== 'off' });
  const toggleMic = (key, store) => (e) => {
    const on = e.target.checked;
    setMic((m) => ({ ...m, [key]: on }));
    localStorage.setItem(store, on ? 'on' : 'off');
    voice.applyMicSettings?.().catch(() => {});
  };
  const [capture, setCapture] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'ember');
  const [notify, setNotify] = useState(localStorage.getItem('notify') !== 'off');
  const [msg, setMsg] = useState('');
  const [appVersion, setAppVersion] = useState('');
  const [level, setLevel] = useState(0); // Mikrofon-Pegel 0..1
  const [rel, setRel] = useState({ done: '' });

  useEffect(() => {
    window.desktop?.version?.().then(setAppVersion);
  }, []);

  // Pegelanzeige fürs gewählte Mikrofon, solange der Audio-Tab offen ist
  useEffect(() => {
    if (tab !== 'audio') return undefined;
    let ctx; let raf; let stream;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: input ? { exact: input } : undefined, noiseSuppression: mic.ns, echoCancellation: mic.ec, autoGainControl: mic.agc } });
        ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Float32Array(an.fftSize);
        const loop = () => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch {}
    })();
    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close();
    };
  }, [tab, input, mic.ns, mic.ec, mic.agc]);

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
    if (file.size > (surge ? 8 : 2) * 1024 * 1024) return setMsg(surge ? 'Avatar max. 8 MB.' : 'Avatar max. 2 MB.');
    if (!surge && isAnimatedImage(file)) return setMsg('Animierte Avatare gibt es mit Hyco Surge.');
    const path = `${me.id}/${Date.now()}-${file.name.replace(/[^\w.]/g, '_')}`;
    const { error } = await supabase.storage.from('avatars').upload(path, file);
    if (error) return setMsg(error.message);
    setAvatarUrl(supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl);
  };

  const uploadBanner = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return setMsg('Banner max. 8 MB.');
    const path = `${me.id}/banner-${Date.now()}-${file.name.replace(/[^\w.]/g, '_')}`;
    const { error } = await supabase.storage.from('avatars').upload(path, file);
    if (error) return setMsg(error.message);
    setBannerUrl(supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl);
  };

  const giveSurge = async (months) => {
    if (!grant.user) return setGrant({ ...grant, msg: 'Bitte Nutzer wählen.' });
    const { data, error } = await supabase.rpc('grant_surge', { target: grant.user, months });
    setGrant({ ...grant, msg: error ? error.message : months > 0 ? `Surge vergeben bis ${new Date(data).toLocaleDateString('de-DE')}.` : 'Surge entzogen.' });
  };
  const saveAdmin = async () => {
    const rows = [['tenor_key', adm.tenor_key.trim()], ['surge_info', adm.surge_info.trim()], ['stripe_enabled', adm.stripe_enabled ? 'on' : 'off']].map(([key, value]) => ({ key, value }));
    const { error } = await supabase.from('app_settings').upsert(rows);
    setAdm({ ...adm, msg: error ? error.message : 'Gespeichert.' });
  };
  const buySurge = async () => {
    setBuying(true);
    try {
      const { data, error } = await supabase.functions.invoke('surge-checkout', { body: {} });
      if (error || !data?.url) throw new Error(error?.message || data?.error || 'Checkout nicht verfügbar');
      window.open(data.url, '_blank');
    } catch (e) {
      setMsg(`Bezahlung gerade nicht möglich: ${e.message}`);
    }
    setBuying(false);
  };

  const save = async (e) => {
    e.preventDefault();
    const { error } = await supabase
      .from('profiles')
      .update({ username: username.trim(), status: status.trim(), bio: bio.trim(), accent, avatar_url: avatarUrl, banner_url: surge ? bannerUrl : me.banner_url })
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
          {[['profile', 'Mein Profil'], ['surge', '⚡ Hyco Surge'], ['audio', 'Sprache & Audio'], ['look', 'Darstellung'], ['invite', 'Freunde einladen'], ['updates', 'Updates']].map(([k, label]) => (
            <a key={k} className={tab === k ? 'channel active' : 'channel'} onClick={() => setTab(k)}>{label}</a>
          ))}
          <span className="grow" />
          <a className="channel danger-text" onClick={() => supabase.auth.signOut()}>Ausloggen</a>
        </nav>
        <form onSubmit={save}>
          {tab === 'profile' && (
            <>
              <h2>Mein Profil</h2>
              <div className={surge ? 'preview surge-glow' : 'preview'} style={{ background: surge && bannerUrl ? `url(${bannerUrl}) center/cover` : `linear-gradient(135deg, ${accent}, #1b2030)` }}>
                <Avatar profile={{ username, avatar_url: avatarUrl, accent }} size={72} />
                <div><b>{username}</b><small>{status || 'Online'}</small></div>
              </div>
              <label>Avatar {surge ? '(auch animiert: GIF, WebP)' : '(animierte Avatare mit Surge)'}</label>
              <input type="file" accept="image/*" onChange={upload} />
              <label>Profilbanner {surge ? '' : '– Surge-Vorteil'}</label>
              {surge
                ? <div className="row"><input type="file" accept="image/*" onChange={uploadBanner} />{bannerUrl && <button type="button" onClick={() => setBannerUrl(null)}>Entfernen</button>}</div>
                : <p className="dim small" style={{ margin: 0 }}>Mit Hyco Surge kannst du ein eigenes Bild als Banner setzen. <a onClick={() => setTab('surge')}>Mehr erfahren</a></p>}
              <label>Benutzername</label>
              <input value={username} minLength={3} maxLength={24} required onChange={(e) => setUsername(e.target.value)} />
              <label>Status-Text</label>
              <input value={status} maxLength={80} placeholder="Was machst du gerade?" onChange={(e) => setStatus(e.target.value)} />
              <label>Über mich</label>
              <textarea rows={3} maxLength={300} value={bio} onChange={(e) => setBio(e.target.value)} />
              <label>Profilfarbe</label>
              <div className="swatches">
                {ACCENTS.map((c) => <button type="button" key={c} className={c === accent ? 'swatch on' : 'swatch'} style={{ background: c }} onClick={() => setAccent(c)} />)}
                {surge && <input type="color" className="color" title="Beliebige Farbe (Surge)" value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : '#ff7a1a'} onChange={(e) => setAccent(e.target.value)} />}
              </div>
            </>
          )}
          {tab === 'audio' && (
            <>
              <h2>Sprache & Audio</h2>
              <label>Eingabegerät (Mikrofon)</label>
              <select value={input} onChange={pick('audioinput', setInput)}><option value="">Systemstandard</option>{options('audioinput')}</select>
              <div className="meter" title="Mikrofon-Pegel"><i style={{ width: `${Math.round(level * 100)}%` }} /></div>
              <p className="dim small" style={{ margin: 0 }}>Sprich etwas – der Balken zeigt, was dein Mikrofon nach der Verarbeitung liefert.</p>
              <label>Ausgabegerät (Kopfhörer/Lautsprecher)</label>
              <select value={output} onChange={pick('audiooutput', setOutput)}><option value="">Systemstandard</option>{options('audiooutput')}</select>
              <label>Mikrofon-Verarbeitung</label>
              <label className="row check"><input type="checkbox" checked={mic.ns} onChange={toggleMic('ns', 'micNs')} />Geräuschunterdrückung (Tastatur, Lüfter, Hintergrund)</label>
              <label className="row check"><input type="checkbox" checked={mic.ec} onChange={toggleMic('ec', 'micEc')} />Echounterdrückung (verhindert Rückkopplung über Lautsprecher)</label>
              <label className="row check"><input type="checkbox" checked={mic.agc} onChange={toggleMic('agc', 'micAgc')} />Automatische Lautstärke (gleicht leise und laute Stimme aus)</label>
              <p className="dim small">Wirkt sofort, auch mitten im Gespräch. Für Musik oder sehr gute Mikrofone alle drei ausschalten.</p>
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
          {tab === 'surge' && (
            <>
              <div className="surge-hero">
                <h2>⚡ Hyco Surge</h2>
                <p>{surge ? `Du hast Surge – aktiv bis ${new Date(me.surge_until).toLocaleDateString('de-DE')}.` : 'Mehr Ausdruck, mehr Qualität. Das Premium-Paket für Hyco.'}</p>
              </div>
              <div className="perks">
                {PERKS.map(([icon, text]) => <div key={text} className="perk"><span>{icon}</span>{text}</div>)}
              </div>
              {!surge && (appSettings.stripe_enabled === 'on'
                ? <div className="row"><button type="button" className="primary" disabled={buying} onClick={buySurge}>{buying ? 'Öffne Bezahlung…' : 'Surge abonnieren'}</button></div>
                : <p className="ok">{appSettings.surge_info || 'Frag den Admin nach Surge.'}</p>)}
              {me.is_admin && (
                <>
                  <h2>Surge vergeben (Admin)</h2>
                  <div className="row">
                    <select value={grant.user} onChange={(e) => setGrant({ ...grant, user: e.target.value, msg: '' })}>
                      <option value="">Nutzer wählen…</option>
                      {Object.values(profiles).sort((a, b) => a.username.localeCompare(b.username)).map((p) => (
                        <option key={p.id} value={p.id}>{p.username}{isSurge(p) ? ` · Surge bis ${new Date(p.surge_until).toLocaleDateString('de-DE')}` : ''}</option>
                      ))}
                    </select>
                    <select value={grant.months} onChange={(e) => setGrant({ ...grant, months: e.target.value })}>
                      {[1, 3, 6, 12, 120].map((m) => <option key={m} value={m}>{m === 120 ? 'Dauerhaft (10 Jahre)' : `${m} Monat${m > 1 ? 'e' : ''}`}</option>)}
                    </select>
                  </div>
                  <div className="row">
                    <button type="button" className="primary" onClick={() => giveSurge(Number(grant.months))}>Vergeben / verlängern</button>
                    <button type="button" className="danger" onClick={() => giveSurge(0)}>Entziehen</button>
                  </div>
                  {grant.msg && <p className={/vergeben|entzogen/.test(grant.msg) ? 'ok' : 'error'}>{grant.msg}</p>}

                  <h2>Surge-Einstellungen (Admin)</h2>
                  <label>Hinweistext für Nutzer ohne Surge</label>
                  <input value={adm.surge_info} maxLength={200} onChange={(e) => setAdm({ ...adm, surge_info: e.target.value })} />
                  <label>KLIPY-API-Key für die GIF-Suche (kostenlos unter partner.klipy.com/api-keys – Tenor wurde 2026 abgeschaltet)</label>
                  <input value={adm.tenor_key} onChange={(e) => setAdm({ ...adm, tenor_key: e.target.value })} />
                  <label className="row check"><input type="checkbox" checked={adm.stripe_enabled} onChange={(e) => setAdm({ ...adm, stripe_enabled: e.target.checked })} />Bezahlung über Stripe anbieten (Funktionen müssen eingerichtet sein)</label>
                  <div className="row"><button type="button" className="primary" onClick={saveAdmin}>Speichern</button>{adm.msg && <span className={adm.msg === 'Gespeichert.' ? 'ok' : 'error'}>{adm.msg}</span>}</div>
                </>
              )}
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
