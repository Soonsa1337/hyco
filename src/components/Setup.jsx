import { useState } from 'react';

// Erster Start ohne eingebackene Zugangsdaten: Server-Verbindung eintragen
export default function Setup() {
  const [code, setCode] = useState('');
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [livekit, setLivekit] = useState('');
  const [msg, setMsg] = useState('');

  const save = (e) => {
    e.preventDefault();
    let cfg = { url: url.trim(), key: key.trim(), livekit: livekit.trim() };
    if (code.trim()) {
      try {
        cfg = JSON.parse(atob(code.trim()));
      } catch {
        return setMsg('Einladungscode ist ungültig.');
      }
    }
    if (!/^https:\/\//.test(cfg.url || '') || !cfg.key || !/^wss?:\/\//.test(cfg.livekit || '')) {
      return setMsg('Bitte Einladungscode oder alle drei Werte korrekt eintragen.');
    }
    localStorage.setItem('hycoConfig', JSON.stringify({ url: cfg.url, key: cfg.key, livekit: cfg.livekit }));
    location.reload();
  };

  return (
    <div className="auth">
      <form className="card wide" onSubmit={save}>
        <h1>Hyco einrichten</h1>
        <label>Einladungscode (von einem Freund, der Hyco schon nutzt)</label>
        <input value={code} placeholder="Code einfügen…" onChange={(e) => setCode(e.target.value)} />
        <p className="dim">— oder als Betreiber die Serverdaten eintragen —</p>
        <label>Supabase Project URL</label>
        <input value={url} placeholder="https://xxxx.supabase.co" onChange={(e) => setUrl(e.target.value)} />
        <label>Supabase anon public Key</label>
        <input value={key} onChange={(e) => setKey(e.target.value)} />
        <label>LiveKit URL</label>
        <input value={livekit} placeholder="wss://xxxx.livekit.cloud" onChange={(e) => setLivekit(e.target.value)} />
        {msg && <p className="error">{msg}</p>}
        <button className="primary">Speichern & starten</button>
      </form>
    </div>
  );
}
