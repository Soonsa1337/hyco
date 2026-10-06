import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { callFunction, config } from './supabase';
import { sounds, setUiSilent } from './sound';
import { createAppAudioTrack, appAudioAvailable } from './appAudio';

// Bitraten liegen bewusst deutlich über dem, was Discord sendet (1080p60 dort ca. 8 Mbit/s)
export const QUALITIES = {
  '720p30': { label: '720p · 30 fps', w: 1280, h: 720, fps: 30, bitrate: 4_000_000 },
  '720p60': { label: '720p · 60 fps', w: 1280, h: 720, fps: 60, bitrate: 6_000_000 },
  '1080p30': { label: '1080p · 30 fps', w: 1920, h: 1080, fps: 30, bitrate: 8_000_000 },
  '1080p60': { label: '1080p · 60 fps', w: 1920, h: 1080, fps: 60, bitrate: 12_000_000 },
  '1440p60': { label: '1440p · 60 fps', w: 2560, h: 1440, fps: 60, bitrate: 18_000_000 },
  '4k30': { label: '4K · 30 fps', w: 3840, h: 2160, fps: 30, bitrate: 22_000_000 },
  '4k60': { label: '4K · 60 fps', w: 3840, h: 2160, fps: 60, bitrate: 30_000_000 },
  source: { label: 'Original (Quelle) · 60 fps', w: 0, h: 0, fps: 60, bitrate: 25_000_000 },
};
export const CODECS = { h264: 'H.264 (kompatibel, GPU-beschleunigt)', vp9: 'VP9 (schärfer bei gleicher Bitrate)', av1: 'AV1 (beste Qualität, braucht starke CPU/GPU)' };
export const CAMERA = { '720p': { width: 1280, height: 720, frameRate: 30 }, '1080p': { width: 1920, height: 1080, frameRate: 30 } };

const stored = (k) => localStorage.getItem(k) || '';

const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// Studio-Compositing stoppen: Zeichenschleife beenden, Kameras/Capture freigeben, Hilfselemente entfernen
const tearDownCompositor = (ex) => {
  if (!ex) return;
  cancelAnimationFrame(ex.raf);
  ex.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  ex.els.forEach((el) => { el.srcObject = null; });
  if (ex.stop) ex.stop().catch(() => {});
};

// Kapselt die komplette LiveKit/WebRTC-Logik (Signaling, ICE/STUN/TURN macht LiveKit).
export function useVoice() {
  const roomRef = useRef(null);
  const audioEls = useRef(new Set());
  const shareTracks = useRef([]);
  const compositor = useRef(null); // { raf, els:[], streams:[] } für das Studio-Compositing
  const deafRef = useRef(false);
  const [state, setState] = useState({ channelId: null, connecting: false, muted: false, deaf: false, sharing: false, camera: false });
  const [, bump] = useState(0);
  const refresh = useCallback(() => bump((n) => n + 1), []);
  const patch = (p) => setState((s) => ({ ...s, ...p }));

  const cleanup = () => {
    shareTracks.current.forEach((t) => t.stop());
    shareTracks.current = [];
    tearDownCompositor(compositor.current);
    compositor.current = null;
    audioEls.current.forEach((el) => el.remove());
    audioEls.current.clear();
    roomRef.current = null;
    deafRef.current = false;
    setState({ channelId: null, connecting: false, muted: false, deaf: false, sharing: false, camera: false });
  };

  const leave = useCallback(async () => {
    const room = roomRef.current;
    if (room) await room.disconnect(); // löst RoomEvent.Disconnected -> cleanup aus
  }, []);

  const join = useCallback(async (channelId) => {
    if (roomRef.current) await roomRef.current.disconnect();
    patch({ connecting: true });
    try {
      const { token } = await callFunction('livekit-token', { room: channelId });
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          deviceId: stored('audioInput') || undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        audioOutput: { deviceId: stored('audioOutput') || undefined },
      });

      room
        .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach();
            el.muted = deafRef.current;
            document.body.appendChild(el);
            audioEls.current.add(el);
            const saved = parseFloat(localStorage.getItem(`vol:${participant.identity}`));
            if (!Number.isNaN(saved)) participant.setVolume(saved);
            const stream = parseFloat(localStorage.getItem(`svol:${participant.identity}`));
            if (!Number.isNaN(stream)) participant.setVolume(stream, Track.Source.ScreenShareAudio);
          }
          refresh();
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach((el) => {
            if (audioEls.current.delete(el)) el.remove();
          });
          refresh();
        })
        .on(RoomEvent.ParticipantConnected, sounds.join)
        .on(RoomEvent.ParticipantDisconnected, sounds.leave)
        .on(RoomEvent.Disconnected, () => {
          sounds.leave();
          cleanup();
        });
      [
        RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackMuted,
        RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished,
        RoomEvent.ActiveSpeakersChanged,
      ].forEach((ev) => room.on(ev, refresh));

      await room.connect(config.livekit, token);
      roomRef.current = room;
      // Push-to-Talk: Mikro startet stumm und wird nur bei gedrückter Taste geöffnet
      let muted = Boolean(localStorage.getItem('ptt'));
      try {
        await room.localParticipant.setMicrophoneEnabled(!muted);
      } catch {
        muted = true; // kein Mikrofon / keine Berechtigung -> nur zuhören
      }
      sounds.join();
      setState({ channelId, connecting: false, muted, deaf: false, sharing: false, camera: false });
    } catch (e) {
      patch({ connecting: false });
      throw e;
    }
  }, [refresh]);

  const setMuted = async (muted) => {
    await roomRef.current?.localParticipant.setMicrophoneEnabled(!muted);
    (muted ? sounds.mute : sounds.unmute)();
    patch({ muted });
  };

  // Lautstärke einzelner Teilnehmer (0–2)
  const setVolume = (identity, volume) => {
    localStorage.setItem(`vol:${identity}`, volume);
    roomRef.current?.remoteParticipants.get(identity)?.setVolume(volume);
    refresh();
  };

  // Push-to-Talk-Taste (solange das Fenster fokussiert ist)
  useEffect(() => {
    const code = localStorage.getItem('ptt');
    if (!state.channelId || !code) return undefined;
    const talk = (on) => (e) => {
      if (e.code !== code || e.repeat || deafRef.current) return;
      if (on && /^(INPUT|TEXTAREA)$/.test(e.target.tagName) && e.code.startsWith('Key')) return;
      roomRef.current?.localParticipant.setMicrophoneEnabled(on);
      patch({ muted: !on });
    };
    const down = talk(true);
    const up = talk(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [state.channelId]);
  const toggleMute = () => setMuted(!state.muted);

  // Deafen = nichts hören + selbst stumm (wie bei Discord)
  const toggleDeaf = async () => {
    const deaf = !state.deaf;
    deafRef.current = deaf;
    audioEls.current.forEach((el) => (el.muted = deaf));
    patch({ deaf });
    if (deaf) await setMuted(true);
  };

  const setDevice = async (kind, deviceId) => {
    localStorage.setItem(kind === 'audioinput' ? 'audioInput' : 'audioOutput', deviceId);
    await roomRef.current?.switchActiveDevice(kind, deviceId);
  };

  const stopShare = useCallback(async () => {
    const room = roomRef.current;
    const tracks = shareTracks.current;
    shareTracks.current = [];
    for (const t of tracks) {
      try {
        await room?.localParticipant.unpublishTrack(t, true);
      } catch {}
      t.stop();
    }
    tearDownCompositor(compositor.current);
    compositor.current = null;
    setUiSilent(false);
    patch({ sharing: false });
  }, []);

  // Facecam + Overlay-Text in Hyco direkt ins Bild rechnen (Canvas), ohne externes Programm.
  // Liefert die auszusendende Videospur und merkt sich alles zum späteren Aufräumen.
  const composeStudio = async (screenStream, q, overlay) => {
    const sv = document.createElement('video');
    sv.srcObject = new MediaStream([screenStream.getVideoTracks()[0]]);
    sv.muted = true;
    await sv.play().catch(() => {});
    if (!sv.videoWidth) await new Promise((r) => { sv.onloadedmetadata = r; });

    const ex = { raf: 0, els: [sv], streams: [] };
    let cam = null;
    if (overlay.cam) {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: overlay.camId ? { exact: overlay.camId } : undefined, width: 1280, height: 720 }, audio: false,
        });
        cam = document.createElement('video');
        cam.srcObject = camStream;
        cam.muted = true;
        await cam.play().catch(() => {});
        ex.els.push(cam);
        ex.streams.push(camStream);
      } catch {}
    }

    const w = q.w || sv.videoWidth || 1920;
    const h = q.h || sv.videoHeight || 1080;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });

    const draw = () => {
      ex.raf = requestAnimationFrame(draw);
      try {
        ctx.drawImage(sv, 0, 0, w, h);
        if (cam && cam.videoWidth) {
          const frac = overlay.camSize === 's' ? 0.16 : overlay.camSize === 'l' ? 0.34 : 0.24;
          const cw = Math.round(w * frac);
          const ch = Math.round((cw * cam.videoHeight) / cam.videoWidth);
          const m = Math.round(w * 0.015);
          const x = (overlay.camPos || 'br').includes('l') ? m : w - cw - m;
          const y = (overlay.camPos || 'br').startsWith('t') ? m : h - ch - m;
          const rad = Math.round(cw * 0.06);
          ctx.save();
          roundRect(ctx, x, y, cw, ch, rad);
          ctx.clip();
          ctx.drawImage(cam, x, y, cw, ch);
          ctx.restore();
          ctx.lineWidth = Math.max(2, Math.round(w * 0.0025));
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          roundRect(ctx, x, y, cw, ch, rad);
          ctx.stroke();
        }
        if (overlay.label) {
          const fs = Math.round(h * 0.03);
          ctx.font = `600 ${fs}px "Segoe UI", system-ui, sans-serif`;
          const pad = Math.round(fs * 0.4);
          const tw = ctx.measureText(overlay.label).width;
          const bx = Math.round(w * 0.015);
          const by = Math.round(w * 0.015);
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          roundRect(ctx, bx, by, tw + pad * 2, fs + pad * 2, pad);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.textBaseline = 'top';
          ctx.fillText(overlay.label, bx + pad, by + pad);
        }
      } catch {}
    };
    draw();

    const out = canvas.captureStream(q.fps);
    ex.streams.push(out);
    return { track: out.getVideoTracks()[0], extra: ex };
  };

  // Bildschirm/Fenster übertragen. Läuft schon ein Stream, wird er mit den neuen Einstellungen ersetzt.
  // audioMode: 'all' = alles außer Hyco, 'app' = nur eine Anwendung (Fenster bzw. gewählte App), 'off' = ohne Ton.
  // Hyco selbst wird immer ausgeschlossen (native Komponente); nur ohne sie bleibt der komplette System-Ton als Rückfall.
  const startShare = async ({ sourceId, audio, audioMode = audio ? 'all' : 'off', appPid = 0, quality, codec = 'h264', mode = 'motion', overlay }) => {
    const room = roomRef.current;
    if (!room) return;
    if (shareTracks.current.length) await stopShare();
    const q = QUALITIES[quality];
    if (audioMode === 'system') audioMode = 'all';
    const native = audioMode !== 'off' && (await appAudioAvailable());
    const systemAudio = audioMode !== 'off' && !native;
    await window.desktop?.pick({ id: sourceId, audio: systemAudio });
    const size = q.w ? { width: { ideal: q.w, max: q.w }, height: { ideal: q.h, max: q.h } } : {};
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { ...size, frameRate: { ideal: q.fps, max: q.fps } },
      audio: systemAudio
        ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000, restrictOwnAudio: true }
        : false,
    });
    const screenTrack = stream.getVideoTracks()[0];
    // Beendet der Nutzer die Freigabe über die Windows-Leiste, Stream sauber stoppen
    screenTrack.onended = stopShare;

    // Studio: Facecam/Overlay nur ins Bild rechnen, wenn gewünscht – sonst unveränderter Direkt-Stream
    const published = [];
    const useStudio = overlay && (overlay.cam || overlay.label);
    const ex = { raf: 0, els: [], streams: [stream] };
    let video = screenTrack;
    if (useStudio) {
      try {
        const studio = await composeStudio(stream, q, overlay);
        video = studio.track;
        ex.els = studio.extra.els;
        ex.streams = [stream, ...studio.extra.streams];
      } catch {
        video = screenTrack; // bei Problemen auf den normalen Bildschirm-Stream zurückfallen
      }
    }
    compositor.current = ex;
    video.contentHint = mode === 'detail' ? 'detail' : 'motion'; // Text scharf halten oder Framerate priorisieren
    await room.localParticipant.publishTrack(video, {
      source: Track.Source.ScreenShare,
      simulcast: false,
      videoCodec: codec,
      backupCodec: codec === 'h264' ? false : { codec: 'h264' },
      degradationPreference: mode === 'detail' ? 'maintain-resolution' : 'maintain-framerate',
      videoEncoding: { maxBitrate: q.bitrate, maxFramerate: q.fps, priority: 'high' },
    });
    published.push(video);

    // App-genauer Ton über die native Komponente: Fenster-Stream -> Ton dieser Anwendung,
    // Bildschirm-Stream -> gewählte Anwendung oder alles außer Hyco (kein Echo der anderen Stimmen)
    let sound = stream.getAudioTracks()[0];
    let appAudioError = '';
    if (native) {
      try {
        const isWindow = /^window:/.test(sourceId || '');
        const windowId = isWindow ? Number((sourceId.split(':')[1] || '0')) : 0;
        const only = audioMode === 'app';
        const opts = only && appPid ? { mode: 'include', pid: appPid } : only && isWindow && windowId ? { mode: 'include', windowId } : { mode: 'exclude' };
        const r = await createAppAudioTrack(opts);
        sound = r.track;
        ex.stop = r.stop;
      } catch (e) {
        appAudioError = e.message;
      }
    }
    if (sound) {
      // Chromium-Bordmittel: eigene App-Ausgabe (Stimmen der anderen) aus dem aufgenommenen System-Ton ausnehmen
      try {
        await sound.applyConstraints({ restrictOwnAudio: true });
      } catch {}
      setUiSilent(true); // keine Hyco-Töne (Nachricht, Beitritt …) in den Stream, solange mit Ton übertragen wird
      await room.localParticipant.publishTrack(sound, {
        source: Track.Source.ScreenShareAudio,
        dtx: false,
        red: false,
        forceStereo: true,
        audioPreset: { maxBitrate: 256_000 },
      });
      published.push(sound);
    }
    shareTracks.current = published;
    patch({ sharing: true });
    if (appAudioError) throw new Error(`Stream läuft ohne Ton – App-Ton nicht verfügbar: ${appAudioError}`);
  };

  // Webcam an/aus
  const toggleCamera = async (resolution = '720p') => {
    const room = roomRef.current;
    if (!room) return;
    const on = !room.localParticipant.isCameraEnabled;
    await room.localParticipant.setCameraEnabled(on, { resolution: CAMERA[resolution] }, { simulcast: false, videoEncoding: { maxBitrate: resolution === '1080p' ? 5_000_000 : 3_000_000, maxFramerate: 30 } });
    patch({ camera: on });
  };

  // Lautstärke des Stream-Tons eines Teilnehmers (getrennt von seiner Stimme)
  const setStreamVolume = (identity, volume) => {
    localStorage.setItem(`svol:${identity}`, volume);
    roomRef.current?.remoteParticipants.get(identity)?.setVolume(volume, Track.Source.ScreenShareAudio);
    refresh();
  };

  const room = roomRef.current;
  const participants = room ? [room.localParticipant, ...room.remoteParticipants.values()] : [];
  const videos = [];
  for (const p of participants) {
    for (const pub of p.videoTrackPublications.values()) {
      if (pub.track && !pub.isMuted) {
        const screen = pub.source === Track.Source.ScreenShare;
        const hasAudio = [...p.audioTrackPublications.values()].some((a) => a.source === Track.Source.ScreenShareAudio);
        videos.push({ key: pub.trackSid, track: pub.track, name: p.name || p.identity, identity: p.identity, local: p.isLocal, screen, hasAudio });
      }
    }
  }

  return { ...state, participants, videos, join, leave, toggleMute, toggleDeaf, setDevice, setVolume, setStreamVolume, startShare, stopShare, toggleCamera };
}
