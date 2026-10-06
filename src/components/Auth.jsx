import { useState } from 'react';
import { supabase } from '../lib/supabase';
import logo from '../assets/logo.png';

export default function Auth() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    const res =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { username: username.trim() } } });
    setBusy(false);
    if (res.error) setMsg(res.error.message);
    else if (mode === 'register' && !res.data.session) setMsg('Bitte bestätige deine E-Mail und logge dich dann ein.');
  };

  return (
    <div className="auth">
      <form onSubmit={submit} className="card">
        <img className="logo big" src={logo} alt="Hyco" />
        <p className="dim">{mode === 'login' ? 'Willkommen zurück!' : 'Account erstellen'}</p>
        {mode === 'register' && (
          <input placeholder="Benutzername (3–24 Zeichen)" value={username} minLength={3} maxLength={24} required onChange={(e) => setUsername(e.target.value)} />
        )}
        <input type="email" placeholder="E-Mail" value={email} required onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="Passwort (min. 6 Zeichen)" value={password} minLength={6} required onChange={(e) => setPassword(e.target.value)} />
        <button className="primary" disabled={busy}>{mode === 'login' ? 'Einloggen' : 'Registrieren'}</button>
        {msg && <p className="error">{msg}</p>}
        <a onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Noch keinen Account? Registrieren' : 'Schon registriert? Einloggen'}
        </a>
      </form>
    </div>
  );
}
