// Hyco Surge – Premium-Status und Vorteile
export const isSurge = (profile) => Boolean(profile?.surge_until && new Date(profile.surge_until) > new Date());

export const PERKS = [
  ['⚡', 'Surge-Abzeichen neben deinem Namen'],
  ['🎞️', 'Animierte Avatare (GIF, WebP, APNG)'],
  ['🖼️', 'Eigenes Profilbanner als Bild'],
  ['🎨', 'Beliebige Profilfarbe statt Vorgaben'],
  ['🔍', 'GIF-Suche direkt im Chat'],
  ['📦', 'Uploads bis 25 MB statt 8 MB'],
  ['📺', 'Streams in 1440p und 4K'],
];

export const uploadLimit = (profile) => (isSurge(profile) ? 25 : 8) * 1024 * 1024;
export const SURGE_QUALITIES = new Set(['1440p60', '4k30', '4k60', 'source']);
export const isAnimatedImage = (file) => /^image\/(gif|webp|apng)$/.test(file.type) || /\.(gif|apng)$/i.test(file.name);
