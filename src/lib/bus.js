// Kleiner Event-Bus: App empfängt Realtime-Events einmal zentral und verteilt sie an die Ansichten.
const target = new EventTarget();
export const bus = {
  on(type, fn) {
    const h = (e) => fn(e.detail);
    target.addEventListener(type, h);
    return () => target.removeEventListener(type, h);
  },
  emit(type, detail) {
    target.dispatchEvent(new CustomEvent(type, { detail }));
  },
};

export const dmKey = (a, b) => [a, b].sort().join(':');
export const roomOfMessage = (m) => (m.channel_id ? `c:${m.channel_id}` : `d:${m.dm_key}`);
