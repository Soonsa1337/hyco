// Updates kommen direkt aus den GitHub-Releases des Projekts – kein manuelles Freigeben nötig.
const REPO = 'Soonsa1337/hyco';

const newer = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

// Liefert { version, current, notes, urls, sha256, size } wenn eine neuere Version veröffentlicht ist, sonst null
export async function checkForUpdate() {
  if (!window.desktop?.version) return null;
  const current = await window.desktop.version();
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) return null;
  const rel = await res.json();
  const version = String(rel.tag_name || '').replace(/^v/, '');
  const asset = (rel.assets || []).find((a) => /\.exe$/i.test(a.name));
  if (!version || !asset || !newer(version, current)) return null;
  const sha256 = String(asset.digest || '').startsWith('sha256:') ? asset.digest.slice(7) : null;
  return { version, current, notes: rel.body || '', urls: [asset.browser_download_url], sha256, size: asset.size };
}
