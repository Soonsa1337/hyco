// App-genauer Stream-Ton: PCM-Daten aus der nativen Komponente werden über ein AudioWorklet
// in eine MediaStream-Tonspur verwandelt, die LiveKit wie ein Mikrofon senden kann.
const WORKLET = `
class HycoPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.port.onmessage = (e) => {
      this.queue.push(e.data);
      // bei Stau (z. B. Fenster lange im Hintergrund) alte Daten verwerfen, statt die Latenz wachsen zu lassen
      if (this.queue.length > 25) this.queue.splice(0, this.queue.length - 25);
    };
  }
  process(_inputs, outputs) {
    const L = outputs[0][0];
    const R = outputs[0][1] || L;
    let i = 0;
    while (i < L.length) {
      const chunk = this.queue[0];
      if (!chunk) { for (; i < L.length; i += 1) { L[i] = 0; R[i] = 0; } break; }
      const frames = chunk.length / 2;
      while (i < L.length && this.offset < frames) {
        L[i] = chunk[this.offset * 2];
        R[i] = chunk[this.offset * 2 + 1];
        i += 1;
        this.offset += 1;
      }
      if (this.offset >= frames) { this.queue.shift(); this.offset = 0; }
    }
    return true;
  }
}
registerProcessor('hyco-pcm', HycoPcm);
`;

export const appAudioAvailable = async () => Boolean(await window.desktop?.appAudio?.available?.());

// opts: { mode: 'exclude' } (alles außer Hyco) oder { mode: 'include', pid } / { mode: 'include', windowId }
export async function createAppAudioTrack(opts) {
  const ctx = new AudioContext({ sampleRate: 48000 });
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const node = new AudioWorkletNode(ctx, 'hyco-pcm', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  const dest = ctx.createMediaStreamDestination();
  node.connect(dest);
  const off = window.desktop.appAudio.onData((buf) => node.port.postMessage(new Float32Array(buf)));
  try {
    await window.desktop.appAudio.start(opts);
  } catch (e) {
    off();
    node.disconnect();
    ctx.close();
    throw new Error(String(e.message || e).replace(/^.*Error: /, ''));
  }
  const track = dest.stream.getAudioTracks()[0];
  const stop = async () => {
    off();
    try { await window.desktop.appAudio.stop(); } catch {}
    node.disconnect();
    ctx.close();
  };
  return { track, stop };
}
