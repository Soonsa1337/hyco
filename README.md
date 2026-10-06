# Hyco – private Discord/Skype-Alternative

Electron + React (Desktop) · Supabase (Auth, DB, Realtime-Chat, Presence, Avatare) · LiveKit (Voice, Screenshare, OBS-Ingest über WebRTC inkl. STUN/TURN).

## Architektur

| Bereich | Umsetzung |
|---|---|
| Login/Registrierung | Supabase Auth (E-Mail + Passwort), Session bleibt lokal gespeichert |
| Profil, Freunde, Kanäle, Nachrichten | Postgres-Tabellen mit Row Level Security (`supabase/schema.sql`) |
| Realtime-Chat | Supabase Realtime (`postgres_changes` auf `messages`) |
| Online-Status / wer sitzt im Voice | Supabase Presence (Kanal `online`) |
| Voice + Screenshare | LiveKit-Raum pro Sprachkanal; LiveKit Cloud stellt Signaling, SFU und TURN → funktioniert durch NAT/Router |
| Raum-Zugang | Edge Function `livekit-token` prüft den Supabase-Login und signiert ein LiveKit-Token (API-Secret bleibt auf dem Server) |
| Bildschirm + System-Ton | Electron `desktopCapturer` + `setDisplayMediaRequestHandler` mit `audio: 'loopback'` |

```
electron/main.cjs, preload.cjs     Fenster, Quellenliste, Loopback-Audio
src/lib/supabase.js                Supabase-Client
src/lib/voice.js                   komplette RTC-Logik (join, mute, deafen, Geräte, Screenshare)
src/components/                    Auth, Chat, Friends, Settings, VoiceStage
supabase/schema.sql                Tabellen, RLS, Realtime, Avatar-Bucket
supabase/functions/                livekit-token, obs-ingress
```

## Setup (einmalig, ca. 15 Minuten)

Voraussetzung: Node.js 20+ (https://nodejs.org).

### 1. Supabase
1. Auf https://supabase.com ein Projekt anlegen (Free-Tarif reicht).
2. **SQL Editor** → Inhalt von `supabase/schema.sql` einfügen → Run. Danach genauso `supabase/migration-002.sql` (Direktnachrichten, Reaktionen, Pins, Anhänge, Status) `supabase/migration-003.sql` (Updates über den Client, Admin-Kennzeichen) und `supabase/migration-004.sql` (eigene Server, Einladungen, Rollen, Rechte) ausführen.
3. **Authentication → Sign In / Providers → Email**: „Confirm email" ausschalten (sonst muss jeder Freund erst eine Mail bestätigen).
4. **Project Settings → API**: `Project URL` und `anon public` Key notieren.

### 2. LiveKit
1. Auf https://cloud.livekit.io ein Projekt anlegen (Free-Tarif reicht für kleine Gruppen).
2. **Settings → Keys**: WebSocket-URL (`wss://…livekit.cloud`), API Key und API Secret notieren.

### 3. Edge Functions deployen
```bash
npx supabase login
npx supabase link --project-ref DEIN_PROJECT_REF
npx supabase secrets set LIVEKIT_URL=wss://DEINPROJEKT.livekit.cloud LIVEKIT_API_KEY=xxx LIVEKIT_API_SECRET=yyy
npx supabase functions deploy livekit-token
```

### 4. App konfigurieren und starten
```bash
cp .env.example .env      # Windows: copy .env.example .env  → Werte eintragen
npm install
npm run dev               # startet die App im Entwicklungsmodus
```

## Als .exe für Freunde bauen
```bash
npm run dist:win          # auf Windows ausführen → release/Hyco Setup 1.0.0.exe
npm run dist:mac          # auf einem Mac ausführen → release/Hyco-1.0.0.dmg
```
Die `.env`-Werte werden eingebacken – deine Freunde installieren nur die Setup-Datei und registrieren sich.
Die Datei ist nicht signiert: Windows SmartScreen zeigt „Weitere Informationen → Trotzdem ausführen".

## Bedienung
- Sprachkanal anklicken → „Beitreten" (oder Doppelklick in der Seitenleiste).
- ⚙️ unten links: Profil, Avatar, Status, Mikrofon- und Ausgabegerät.
- 🖥️ Bildschirm teilen: Fenster/Bildschirm, Qualität (720p60 / 1080p30 / 1080p60) und Ton an/aus wählen. Doppelklick auf einen Stream = Vollbild.

## Bekannte Grenzen
- **System-Ton beim Screenshare** funktioniert unter Windows. Unter macOS liefert Electron ohne Zusatztreiber (z. B. BlackHole) keinen System-Ton – dort den OBS-Weg nutzen.
- Der Loopback nimmt den **gesamten** System-Ton auf, also auch die Stimmen der anderen aus Hyco. Zuschauer können sich dadurch selbst leise als Echo hören. Abhilfe: Hyco-Ausgabe auf ein anderes Gerät legen als das Spiel, oder über OBS mit „Anwendungsaudioaufnahme" streamen.
- Alle registrierten Nutzer sehen alle Kanäle (ein gemeinsamer „Server"). Wer die App-Datei hat, kann sich registrieren – nur an Freunde weitergeben oder in Supabase Registrierungen nach dem Onboarding deaktivieren.
- Jeder eingeloggte Nutzer darf Kanäle anlegen; Löschen geht nur im Supabase-Dashboard.

## Updates verteilen
1. Version in `package.json` erhöhen und `npm run dist:win` ausführen.
2. Die neue Version selbst installieren und testen.
3. In Hyco: Einstellungen → Updates → „Update freigeben (Admin)" → die neue `Hyco Setup x.y.z.exe` wählen → „Hochladen & freigeben".
4. Alle Nutzer sehen innerhalb von 15 Minuten (oder nach Neustart) unten in der linken Leiste einen grünen ⬇-Knopf; ein Klick lädt das Update, prüft die SHA-256-Prüfsumme, installiert still und startet Hyco neu.

Die Dateien liegen im öffentlichen Supabase-Bucket `updates` (in 40-MB-Teilen, weil der Free-Tarif 50 MB pro Datei erlaubt). Hochladen dürfen nur Profile mit `is_admin = true`.

## Server, Rollen und Rechte
- Jeder Nutzer kann Server erstellen (linke Leiste → „+") oder per Einladungslink `hyco://invite/CODE` beitreten. Der Link öffnet Hyco direkt; im Chat erscheint er als Knopf.
- Rechte kommen aus der Rolle `@everyone` plus den vergebenen Rollen; der Besitzer darf alles. Durchgesetzt wird das in der Datenbank (`has_perm`), nicht nur in der Oberfläche.
- Servereinstellungen: Übersicht, Rollen, Mitglieder (Rollen vergeben, kicken, bannen), Einladungen (Ablauf, max. Nutzungen), Bans.
- Es gibt keine Rollen-Hierarchie: Wer „Rollen verwalten" hat, kann jede Rolle vergeben und ändern – also auch sich selbst Administrator geben. Dieses Recht nur an vertraute Personen vergeben.
