import { supabase, config } from './supabase';

const BASE = `${config.url}/storage/v1/object/public/updates`;
const CHUNK = 40 * 1024 * 1024; // Supabase Free erlaubt max. 50 MB pro Datei

const newer = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

// Liefert { version, notes, urls, sha256, size } wenn eine neuere Version freigegeben ist, sonst null
export async function checkForUpdate() {
  if (!window.desktop?.version) return null;
  const current = await window.desktop.version();
  const res = await fetch(`${BASE}/latest.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const latest = await res.json();
  if (!latest?.version || !newer(latest.version, current)) return null;
  return { ...latest, current, urls: latest.parts.map((p) => `${BASE}/${p}`) };
}

// Admin: Installer in Teilen hochladen und als aktuelle Version freigeben
export async function publishUpdate(file, version, notes, onProgress) {
  const buf = await file.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const count = Math.ceil(buf.byteLength / CHUNK);
  const parts = [];
  for (let i = 0; i < count; i += 1) {
    const path = `${version}/part${i}`;
    const blob = new Blob([buf.slice(i * CHUNK, (i + 1) * CHUNK)], { type: 'application/octet-stream' });
    const { error } = await supabase.storage.from('updates').upload(path, blob, { upsert: true, contentType: 'application/octet-stream' });
    if (error) throw new Error(`Teil ${i + 1}: ${error.message}`);
    parts.push(path);
    onProgress(Math.round(((i + 1) / count) * 100));
  }
  const manifest = new Blob([JSON.stringify({ version, notes, parts, sha256: hash, size: buf.byteLength, published: new Date().toISOString() })], { type: 'application/json' });
  const { error } = await supabase.storage.from('updates').upload('latest.json', manifest, { upsert: true, contentType: 'application/json', cacheControl: '0' });
  if (error) throw new Error(error.message);
}
