import { useEffect, useState } from 'react';
import { checkForUpdate } from '../lib/update';
import { bus } from '../lib/bus';

// Update-Knopf in der Server-Leiste + Dialog mit Fortschritt
export default function Updater() {
  const [update, setUpdate] = useState(null);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const check = () => checkForUpdate().then(setUpdate).catch(() => {});
    check();
    const timer = setInterval(check, 15 * 60000);
    const off = bus.on('check-update', check);
    const offProgress = window.desktop?.onUpdateProgress?.(setProgress);
    return () => {
      clearInterval(timer);
      off();
      offProgress?.();
    };
  }, []);

  if (!update) return null;

  const install = async () => {
    setError('');
    setProgress(0);
    try {
      await window.desktop.installUpdate({ urls: update.urls, sha256: update.sha256, version: update.version });
    } catch (e) {
      setProgress(null);
      setError(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  return (
    <>
      <button className="pill update" title={`Update ${update.version} verfügbar`} onClick={() => setOpen(true)}>⬇</button>
      {open && (
        <div className="overlay" onClick={() => progress === null && setOpen(false)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <h2>Update verfügbar</h2>
            <p>Hyco <b>{update.version}</b> ist da (installiert: {update.current}).</p>
            {update.notes && <p className="notes">{update.notes}</p>}
            {progress !== null ? (
              <>
                <div className="progress"><i style={{ width: `${progress}%` }} /></div>
                <p className="dim small">{progress < 100 ? `Lade herunter… ${progress} %` : 'Installiere – Hyco startet gleich neu.'}</p>
              </>
            ) : (
              <div className="row end">
                <span className="grow" />
                <button onClick={() => setOpen(false)}>Später</button>
                <button className="primary" onClick={install}>Jetzt aktualisieren</button>
              </div>
            )}
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
