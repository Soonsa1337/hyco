// Studio-Overlay-Renderer: zeichnet Bildschirm + Facecam + Badge + Sprecher-Liste + Vignette in einen Canvas.
// Reines Canvas-Modul ohne Abhängigkeiten, damit es isoliert testbar ist.
export const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// Liefert eine Funktion frame(tSeconds), die ein Bild zeichnet.
export function createStudioRenderer({ ctx, w, h, sv, cam, overlay, accent = '#ff7a1a', accent2 = '#ff3d6e' }) {
  const u = w / 1920; // Maßstab: alle Größen relativ zu 1080p
  const font = (px, weight = 700) => `${weight} ${Math.round(px * u)}px "Segoe UI", system-ui, sans-serif`;
  const corner = (pos, bw, bh, m) => ({
    x: (pos || 'br').includes('l') ? m : w - bw - m,
    y: (pos || 'br').startsWith('t') ? m : h - bh - m,
  });
  const pill = (x, y, bw, bh, r, fill) => { roundRect(ctx, x, y, bw, bh, r); ctx.fillStyle = fill; ctx.fill(); };

  return (t) => {
    ctx.drawImage(sv, 0, 0, w, h);

    // Vignette: dunkle Ränder, Bild bleibt in der Mitte unberührt
    if (overlay.vignette) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // Facecam mit leuchtendem Rahmen in Akzentfarbe
    if (cam && cam.videoWidth) {
      const frac = overlay.camSize === 's' ? 0.16 : overlay.camSize === 'l' ? 0.34 : 0.24;
      const cw = Math.round(w * frac);
      const ch = overlay.camShape === 'circle' ? cw : Math.round((cw * cam.videoHeight) / cam.videoWidth);
      const m = Math.round(24 * u);
      const { x, y } = corner(overlay.camPos, cw, ch, m);
      const rad = overlay.camShape === 'circle' ? cw / 2 : Math.round(18 * u);
      ctx.save();
      ctx.shadowColor = accent;
      ctx.shadowBlur = 28 * u;
      pill(x, y, cw, ch, rad, accent);
      ctx.restore();
      ctx.save();
      roundRect(ctx, x, y, cw, ch, rad);
      ctx.clip();
      const srcW = overlay.camShape === 'circle' ? cam.videoHeight : cam.videoWidth;
      const sx = overlay.camShape === 'circle' ? (cam.videoWidth - srcW) / 2 : 0;
      if (overlay.mirror) {
        ctx.translate(x + cw, y);
        ctx.scale(-1, 1);
        ctx.drawImage(cam, sx, 0, srcW, cam.videoHeight, 0, 0, cw, ch);
      } else {
        ctx.drawImage(cam, sx, 0, srcW, cam.videoHeight, x, y, cw, ch);
      }
      ctx.restore();
      ctx.lineWidth = Math.max(2, 4 * u);
      ctx.strokeStyle = accent;
      roundRect(ctx, x, y, cw, ch, rad);
      ctx.stroke();
    }

    // Namens-Badge: Initiale, Name, pulsierender LIVE-Punkt, Stream-Zeit
    if (overlay.label) {
      const fs = 30 * u;
      ctx.font = font(fs);
      const time = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      ctx.font = font(22, 600);
      const timeW = ctx.measureText(time).width;
      ctx.font = font(fs);
      const nameW = ctx.measureText(overlay.label).width;
      const bh = Math.round(fs * 1.9);
      const ava = bh - 12 * u;
      const bw = Math.round(12 * u + ava + 14 * u + nameW + 22 * u + 14 * u + timeW + 20 * u);
      const m = Math.round(24 * u);
      const { x, y } = corner(overlay.badgePos || 'tl', bw, bh, m);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 16 * u;
      pill(x, y, bw, bh, bh / 2, 'rgba(12,14,22,0.78)');
      ctx.restore();
      const g = ctx.createLinearGradient(x, y, x + ava, y + ava);
      g.addColorStop(0, accent);
      g.addColorStop(1, accent2);
      ctx.beginPath();
      ctx.arc(x + 6 * u + ava / 2, y + bh / 2, ava / 2, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.font = font(fs * 0.9, 800);
      ctx.fillText(overlay.label[0].toUpperCase(), x + 6 * u + ava / 2, y + bh / 2 + 1);
      ctx.textAlign = 'left';
      ctx.font = font(fs);
      ctx.fillText(overlay.label, x + 12 * u + ava + 14 * u, y + bh / 2 + 1);
      const dx = x + 12 * u + ava + 14 * u + nameW + 22 * u;
      const pulse = 0.55 + 0.45 * Math.sin(t * 4);
      ctx.beginPath();
      ctx.arc(dx, y + bh / 2, 6 * u * (0.8 + 0.3 * pulse), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(240,71,92,${0.6 + 0.4 * pulse})`;
      ctx.fill();
      ctx.font = font(22, 600);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(time, dx + 14 * u, y + bh / 2 + 1);
    }

    // Sprecher-Liste: wer ist im Sprachkanal, wer redet gerade (leuchtet in Akzentfarbe)
    if (overlay.voiceList && overlay.getVoice) {
      const people = overlay.getVoice().slice(0, 8);
      if (people.length) {
        const rowH = 40 * u;
        const pad = 12 * u;
        ctx.font = font(22, 600);
        const bw = Math.round(Math.max(...people.map((p) => ctx.measureText(p.name).width)) + 64 * u);
        const bh = Math.round(people.length * rowH + pad * 2);
        const m = Math.round(24 * u);
        const { x, y } = corner(overlay.voicePos || 'bl', bw, bh, m);
        pill(x, y, bw, bh, 14 * u, 'rgba(12,14,22,0.72)');
        people.forEach((p, i) => {
          const cy = y + pad + rowH * i + rowH / 2;
          ctx.save();
          if (p.speaking) {
            ctx.shadowColor = accent;
            ctx.shadowBlur = 14 * u;
          }
          ctx.beginPath();
          ctx.arc(x + 20 * u, cy, 7 * u, 0, Math.PI * 2);
          ctx.fillStyle = p.muted ? '#f0475c' : p.speaking ? accent : 'rgba(255,255,255,0.35)';
          ctx.fill();
          ctx.restore();
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          ctx.fillStyle = p.speaking ? '#fff' : 'rgba(255,255,255,0.75)';
          ctx.font = font(22, p.speaking ? 800 : 600);
          ctx.fillText(p.name, x + 38 * u, cy + 1);
        });
      }
    }
  };
}
