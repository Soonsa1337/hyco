import { useEffect, useRef, useState } from 'react';
import { QUALITIES, CODECS } from '../lib/voice';
import { appAudioStatus } from '../lib/appAudio';
import { isSurge, SURGE_QUALITIES } from '../lib/surge';
import Avatar from './Avatar.jsx';

// Eine Stream- oder Kamera-Kachel mit Live-Statistik, Stream-Lautstärke und Vollbild
function VideoTile({ v, voice, main, onFocus }) {
  const ref = useRef(null);
  const [stats, setStats] = useState('');

  useEffect(() => {
    const el = ref.current;
    v.track.attach(el);
    // Auflösung und tatsächliche Bildrate direkt am Videoelement messen
    let frames = 0;
    let alive = true;
    const count = () => {
      frames += 1;
      if (alive) el.requestVideoFrameCallback(count);
    };
    el.requestVideoFrameCallback?.(count);
    const timer = setInterval(() => {
      setStats(el.videoWidth ? `${el.videoWidth}×${el.videoHeight} · ${frames} fps` : '');
      frames = 0;
    }, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
      v.track.detach(el);
    };
  }, [v.track]);

  const fullscreen = (e) => {
    e.stopPropagation();
    if (document.fullscreenElement) document.exitFullscreen();
    else ref.current?.parentElement.requestFullscreen();
  };

  // Abdocken: schwebendes Fenster über allen Apps (Bild-im-Bild), bleibt beim Spielen sichtbar
  const popout = async (e) => {
    e.stopPropagation();
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await ref.current?.requestPictureInPicture();
    } catch {}
  };

  return (
    <div className={main ? 'tile main' : 'tile'} onClick={onFocus} onDoubleClick={fullscreen}>
      <video ref={ref} autoPlay playsInline muted />
      {stats && <div className="tag stats">{stats}</div>}
      <div className="tag">
        {v.screen && <b className="live">LIVE</b>}
        {v.name}{v.local ? ' (du)' : ''} · {v.screen ? 'Bildschirm' : 'Kamera'}
      </div>
      <div className="hud" onClick={(e) => e.stopPropagation()}>
        {v.screen && v.hasAudio && !v.local && (
          <>
            🔊
            <input
              type="range" min="0" max="2" step="0.05" title="Stream-Lautstärke"
              value={parseFloat(localStorage.getItem(`svol:${v.identity}`) ?? 1)}
              onChange={(e) => voice.setStreamVolume(v.identity, parseFloat(e.target.value))}
            />
          </>
        )}
        <button title="Abdocken (schwebendes Fenster)" onClick={popout}>⧉</button>
        <button title="Vollbild" onClick={fullscreen}>⛶</button>
      </div>
    </div>
  );
}

function SharePicker({ live, me, onStart, onClose }) {
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState(null);
  const [kind, setKind] = useState('screen');
  const [audioMode, setAudioMode] = useState({ all: 'all', app: 'app', off: 'off' }[localStorage.getItem('audioMode')] || 'all');
  const [appOk, setAppOk] = useState(false);
  const [appInfo, setAppInfo] = useState(null);
  const [apps, setApps] = useState([]);
  const [appPid, setAppPid] = useState(0);
  const [quality, setQuality] = useState(QUALITIES[localStorage.getItem('quality')] ? localStorage.getItem('quality') : '1080p60');
  const [codec, setCodec] = useState(localStorage.getItem('codec') || 'h264');
  const [mode, setMode] = useState(localStorage.getItem('shareMode') || 'motion');
  const [facecam, setFacecam] = useState(localStorage.getItem('facecam') === 'on');
  const [camPos, setCamPos] = useState(localStorage.getItem('camPos') || 'br');
  const [camSize, setCamSize] = useState(localStorage.getItem('camSize') || 'm');
  const [cams, setCams] = useState([]);
  const [camId, setCamId] = useState(localStorage.getItem('camId') || '');
  const [label, setLabel] = useState(localStorage.getItem('streamLabel') || '');
  const [camShape, setCamShape] = useState(localStorage.getItem('camShape') || 'rounded');
  const [mirror, setMirror] = useState(localStorage.getItem('camMirror') === 'on');
  const [badge, setBadge] = useState(localStorage.getItem('badge') !== 'off');
  const [badgePos, setBadgePos] = useState(localStorage.getItem('badgePos') || 'tl');
  const [voiceList, setVoiceList] = useState(localStorage.getItem('voiceList') === 'on');
  const [voicePos, setVoicePos] = useState(localStorage.getItem('voicePos') || 'bl');
  const [vignette, setVignette] = useState(localStorage.getItem('vignette') === 'on');
  const preset = (k) => {
    const p = { clean: [false, false, false, false], minimal: [false, true, false, false], gamer: [true, true, true, true] }[k];
    setFacecam(p[0]); setBadge(p[1]); setVoiceList(p[2]); setVignette(p[3]);
  };

  useEffect(() => {
    window.desktop?.getSources().then((s) => {
      setSources(s);
      setSourceId(s.find((x) => x.id.startsWith('screen'))?.id || s[0]?.id);
    });
    navigator.mediaDevices.enumerateDevices().then((d) => setCams(d.filter((x) => x.kind === 'videoinput')));
    appAudioStatus().then((st) => {
      setAppOk(st.ok);
      setAppInfo(st);
      if (st.ok) window.desktop.appAudio.apps().then(setApps).catch(() => {});
    });
  }, []);

  const start = () => {
    localStorage.setItem('quality', quality);
    localStorage.setItem('codec', codec);
    localStorage.setItem('shareMode', mode);
    localStorage.setItem('audioMode', audioMode);
    localStorage.setItem('facecam', facecam ? 'on' : 'off');
    localStorage.setItem('camPos', camPos);
    localStorage.setItem('camSize', camSize);
    localStorage.setItem('camId', camId);
    localStorage.setItem('streamLabel', label);
    localStorage.setItem('camShape', camShape);
    localStorage.setItem('camMirror', mirror ? 'on' : 'off');
    localStorage.setItem('badge', badge ? 'on' : 'off');
    localStorage.setItem('badgePos', badgePos);
    localStorage.setItem('voiceList', voiceList ? 'on' : 'off');
    localStorage.setItem('voicePos', voicePos);
    localStorage.setItem('vignette', vignette ? 'on' : 'off');
    onStart({
      sourceId, audioMode, appPid: Number(appPid) || 0, quality, codec, mode,
      overlay: { cam: facecam, camId, camPos, camSize, camShape, mirror, label: badge ? (label.trim() || me?.username || 'Hyco') : '', badgePos, voiceList, voicePos, vignette },
    });
  };
  const shown = sources.filter((s) => s.id.startsWith(kind));
  const q = QUALITIES[quality];
  useEffect(() => { if (SURGE_QUALITIES.has(quality) && !isSurge(me)) setQuality('1080p60'); }, [me, quality]);
  const isWindow = /^window:/.test(sourceId || '');

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card wide" onClick={(e) => e.stopPropagation()}>
        <h2>{live ? 'Stream-Einstellungen ändern' : 'Bildschirm übertragen'}</h2>
        <div className="row">
          <button className={kind === 'screen' ? 'tab on' : 'tab'} onClick={() => setKind('screen')}>Bildschirme</button>
          <button className={kind === 'window' ? 'tab on' : 'tab'} onClick={() => setKind('window')}>Anwendungen</button>
        </div>
        <div className="sources">
          {shown.map((s) => (
            <button key={s.id} className={s.id === sourceId ? 'source active' : 'source'} onClick={() => setSourceId(s.id)}>
              <img src={s.thumb} alt="" />
              <small>{s.name}</small>
            </button>
          ))}
        </div>
        <div className="grid2">
          <div>
            <label>Auflösung & Bildrate</label>
            <select value={quality} onChange={(e) => setQuality(e.target.value)}>
              {Object.entries(QUALITIES).map(([k, x]) => <option key={k} value={k} disabled={SURGE_QUALITIES.has(k) && !isSurge(me)}>{x.label}{SURGE_QUALITIES.has(k) ? ' ⚡' : ''}</option>)}
            </select>
          </div>
          <div>
            <label>Optimieren für</label>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="motion">Bewegung (Spiele, Videos)</option>
              <option value="detail">Schärfe (Text, Code)</option>
            </select>
          </div>
        </div>
        <label>Video-Codec</label>
        <select value={codec} onChange={(e) => setCodec(e.target.value)}>
          {Object.entries(CODECS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <label>Ton</label>
        <select value={audioMode} onChange={(e) => setAudioMode(e.target.value)}>
          <option value="all">{appOk ? 'Alles außer Hyco' : 'System-Ton'}{isWindow ? '' : ' (Standard)'}</option>
          {appOk && <option value="app">{isWindow ? 'Nur diese Anwendung (Standard)' : 'Nur eine bestimmte Anwendung'}</option>}
          <option value="off">Kein Ton</option>
        </select>
        {appOk && audioMode === 'app' && !isWindow && (
          <select value={appPid} onChange={(e) => setAppPid(e.target.value)}>
            <option value={0}>Anwendung wählen…</option>
            {apps.map((a) => <option key={a.pid} value={a.pid}>{a.name}{a.active ? ' · spielt gerade' : ''}</option>)}
          </select>
        )}
        {audioMode !== 'off' && (
          <label className={appOk ? 'row check' : 'row check dim'}>
            <input type="checkbox" checked={appOk} disabled readOnly />
            Hyco als Tonquelle ausschließen (Stimmen der anderen, Hinweistöne) – keine Rückkopplung
          </label>
        )}
        {appOk && audioMode !== 'off' && <p className="dim small">Aktiv. Hyco selbst landet nie im Stream.</p>}
        {!appOk && audioMode !== 'off' && (
          <p className="error small">Nicht möglich – die Audio-Komponente ist auf diesem System nicht aktiv ({appInfo?.reason || 'unbekannt'}; {appInfo?.windows || ''}). Es wird der komplette System-Ton inklusive Hyco gesendet. Bitte diesen Text an den Entwickler weitergeben.</p>
        )}

        <h3 className="studio-head">🎬 Studio-Overlay</h3>
        <div className="row presets">
          <span className="dim small" style={{ margin: 0 }}>Vorlage:</span>
          <button type="button" className="tab" onClick={() => preset('gamer')}>🎮 Gamer</button>
          <button type="button" className="tab" onClick={() => preset('minimal')}>✨ Minimal</button>
          <button type="button" className="tab" onClick={() => preset('clean')}>🧼 Ohne Overlay</button>
        </div>

        <label className="row check"><input type="checkbox" checked={facecam} onChange={(e) => setFacecam(e.target.checked)} />Facecam mit Leuchtrahmen</label>
        {facecam && (
          <div className="grid2 sub">
            <div><label>Kamera</label><select value={camId} onChange={(e) => setCamId(e.target.value)}><option value="">Standardkamera</option>{cams.map((c) => <option key={c.deviceId} value={c.deviceId}>{c.label || 'Kamera'}</option>)}</select></div>
            <div><label>Größe</label><select value={camSize} onChange={(e) => setCamSize(e.target.value)}><option value="s">Klein</option><option value="m">Mittel</option><option value="l">Groß</option></select></div>
            <div><label>Position</label><select value={camPos} onChange={(e) => setCamPos(e.target.value)}>{[['tl', 'Oben links'], ['tr', 'Oben rechts'], ['bl', 'Unten links'], ['br', 'Unten rechts']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label>Form</label><select value={camShape} onChange={(e) => setCamShape(e.target.value)}><option value="rounded">Abgerundet</option><option value="circle">Kreis</option></select></div>
            <label className="row check"><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />Spiegeln</label>
          </div>
        )}

        <label className="row check"><input type="checkbox" checked={badge} onChange={(e) => setBadge(e.target.checked)} />Namens-Badge mit LIVE-Puls und Stream-Zeit</label>
        {badge && (
          <div className="grid2 sub">
            <div><label>Angezeigter Name</label><input maxLength={30} placeholder={me?.username || 'Dein Name'} value={label} onChange={(e) => setLabel(e.target.value)} /></div>
            <div><label>Position</label><select value={badgePos} onChange={(e) => setBadgePos(e.target.value)}>{[['tl', 'Oben links'], ['tr', 'Oben rechts'], ['bl', 'Unten links'], ['br', 'Unten rechts']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          </div>
        )}

        <label className="row check"><input type="checkbox" checked={voiceList} onChange={(e) => setVoiceList(e.target.checked)} />Sprecher-Liste (wer redet, leuchtet auf)</label>
        {voiceList && <div className="grid2 sub"><div><label>Position</label><select value={voicePos} onChange={(e) => setVoicePos(e.target.value)}>{[['tl', 'Oben links'], ['tr', 'Oben rechts'], ['bl', 'Unten links'], ['br', 'Unten rechts']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div></div>}

        <label className="row check"><input type="checkbox" checked={vignette} onChange={(e) => setVignette(e.target.checked)} />Vignette (dunkle Ränder, kinoartig)</label>

        <p className="dim small">Sendet mit bis zu {q.bitrate / 1_000_000} Mbit/s. Wenn dein Upload das nicht schafft, wähle eine kleinere Stufe.{(facecam || badge || voiceList || vignette) && ' Das Overlay wird in Hyco direkt ins Bild gerechnet – in der Akzentfarbe deines Farbschemas.'}</p>
        <div className="row end">
          <span className="grow" />
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" disabled={!sourceId} onClick={start}>{live ? 'Übernehmen' : 'Live gehen'}</button>
        </div>
      </div>
    </div>
  );
}

export default function VoiceStage({ channel, voice, profiles, canStream = true, canConnect = true }) {
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState('');
  const [focus, setFocus] = useState(null);
  const joined = voice.channelId === channel.id;

  const run = async (fn) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
  };

  if (!joined) {
    return (
      <div className="stage center">
        <h2>🔊 {channel.name}</h2>
        {canConnect ? (
          <button className="primary big" disabled={voice.connecting} onClick={() => run(() => voice.join(channel.id))}>
            {voice.connecting ? 'Verbinde…' : 'Sprachkanal beitreten'}
          </button>
        ) : <p className="dim">Dir fehlt das Recht, Sprachkanälen beizutreten.</p>}
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const videos = voice.videos;
  const main = videos.find((v) => v.key === focus);
  const rest = videos.filter((v) => v !== main);

  return (
    <div className="stage">
      <header className="topbar"><span className="title"><i className="hash">🔊</i>{channel.name}</span></header>
      {videos.length > 0 && (main ? (
        <div className="videos focus">
          <VideoTile v={main} voice={voice} main onFocus={() => setFocus(null)} />
          {rest.length > 0 && <div className="strip">{rest.map((v) => <VideoTile key={v.key} v={v} voice={voice} onFocus={() => setFocus(v.key)} />)}</div>}
        </div>
      ) : (
        <div className="videos">
          {videos.map((v) => <VideoTile key={v.key} v={v} voice={voice} onFocus={() => setFocus(v.key)} />)}
        </div>
      ))}
      <div className="people">
        {voice.participants.map((p) => (
          <div key={p.identity} className={p.isSpeaking ? 'person speaking' : 'person'}>
            <Avatar profile={profiles[p.identity] || { username: p.name }} size={72} />
            <span>{p.name || p.identity}{!p.isMicrophoneEnabled && !p.identity.endsWith('-obs') ? ' 🔇' : ''}</span>
            {!p.isLocal && (
              <input
                type="range" min="0" max="2" step="0.05" title="Lautstärke"
                value={parseFloat(localStorage.getItem(`vol:${p.identity}`) ?? 1)}
                onChange={(e) => voice.setVolume(p.identity, parseFloat(e.target.value))}
              />
            )}
          </div>
        ))}
      </div>
      {error && <p className="error center-text">{error}</p>}
      <footer className="controls">
        <button className={voice.muted ? 'danger' : ''} onClick={() => run(voice.toggleMute)}>{voice.muted ? '🎙️ Stumm' : '🎙️ Mikro an'}</button>
        <button className={voice.deaf ? 'danger' : ''} onClick={() => run(voice.toggleDeaf)}>{voice.deaf ? '🎧 Taub' : '🎧 Ton an'}</button>
        {canStream && <button className={voice.camera ? 'primary' : ''} onClick={() => run(() => voice.toggleCamera(localStorage.getItem('camRes') || '720p'))}>{voice.camera ? '📷 Kamera aus' : '📷 Kamera'}</button>}
        {!canStream ? null : voice.sharing ? (
          <>
            <button className="primary" onClick={() => setDialog('share')}>⚙️ Stream-Qualität</button>
            <button className="danger" onClick={() => run(voice.stopShare)}>🖥️ Stream beenden</button>
          </>
        ) : <button onClick={() => setDialog('share')}>🖥️ Bildschirm teilen</button>}
        <button className="danger" onClick={() => run(voice.leave)}>📞 Verlassen</button>
      </footer>
      {dialog === 'share' && (
        <SharePicker live={voice.sharing} me={profiles[voice.participants.find((p) => p.isLocal)?.identity]} onClose={() => setDialog(null)} onStart={(opts) => { setDialog(null); run(() => voice.startShare(opts)); }} />
      )}
    </div>
  );
}
