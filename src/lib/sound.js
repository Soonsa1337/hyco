// Kurze UI-Töne per WebAudio (keine Audiodateien nötig)
let ctx;
let silent = false; // während einer Bildschirmübertragung mit Ton: keine UI-Töne, damit sie nicht mitlaufen
export const setUiSilent = (v) => { silent = v; };
function tone(freqs, dur = 0.12, vol = 0.06) {
  if (silent) return;
  try {
    ctx = ctx || new AudioContext();
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * dur;
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur);
    });
  } catch {}
}
export const sounds = {
  message: () => tone([880, 1175]),
  join: () => tone([523, 784]),
  leave: () => tone([784, 523]),
  mute: () => tone([330], 0.08),
  unmute: () => tone([660], 0.08),
  surge: () => tone([523, 659, 784, 1047, 1319], 0.14),
};
