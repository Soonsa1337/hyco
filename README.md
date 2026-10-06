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
2. **SQL Editor** → Inhalt von `supabase/schema.sql` einfügen → Run. Danach genauso `supabase/migration-002.sql` (Direktnachrichten, Reaktionen, Pins, Anhänge, Status) `supabase/migration-003.sql` (Updates über den Client, Admin-Kennzeichen) `supabase/migration-004.sql` (eigene Server, Einladungen, Rollen, Rechte) und `supabase/migration-005.sql` (Hyco Surge) ausführen.
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
Jeder Push auf `main` baut per GitHub Actions den Windows-Installer und veröffentlicht ihn als Release (`v<Version aus package.json>`).
Die App prüft alle 15 Minuten die GitHub-Releases; bei einer neueren Version erscheint der ⬇-Knopf, ein Klick lädt, prüft die Prüfsumme (sofern GitHub sie liefert), installiert still und startet neu.
Vorgehen für eine neue Version: `version` in `package.json` erhöhen, committen, pushen – fertig.

## Hyco Surge (Premium)
- Vorteile: ⚡-Abzeichen, animierte Avatare, Profilbanner, freie Profilfarbe, GIF-Suche, Uploads bis 25 MB, Streams in 1440p/4K.
- **Vergabe durch den Admin:** Einstellungen → ⚡ Hyco Surge → „Surge vergeben" (Nutzer + Laufzeit). Ebenso Entziehen.
- **GIF-Suche:** braucht einen kostenlosen KLIPY-API-Key (https://partner.klipy.com/api-keys; KLIPY ist Tenor-kompatibel, Tenor wurde am 30.06.2026 abgeschaltet). In Einstellungen → Hyco Surge eintragen.
- **Bezahlung über Stripe (optional):** Stripe-Konto anlegen, ein Abo-Produkt mit Preis erstellen, dann
  `supabase secrets set STRIPE_SECRET_KEY=sk_… STRIPE_PRICE_ID=price_… STRIPE_WEBHOOK_SECRET=whsec_…`,
  die Funktionen `surge-checkout` und `stripe-webhook` deployen (bei `stripe-webhook` „Verify JWT" ausschalten),
  in Stripe den Webhook auf `https://<projekt>.supabase.co/functions/v1/stripe-webhook` mit den Events `invoice.paid` und `customer.subscription.deleted` anlegen
  und in Hyco „Bezahlung über Stripe anbieten" einschalten. Hinweis: Wer Abos verkauft, braucht Impressum, AGB und Widerrufsbelehrung.
