// Stellt eingeloggten Nutzern ein LiveKit-Token für einen Voice-Channel aus.
import { createClient } from "npm:@supabase/supabase-js@2";
import { AccessToken, TrackSource } from "npm:livekit-server-sdk@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Nicht eingeloggt" }, 401);

    const { room } = await req.json();
    // RLS liefert den Kanal nur, wenn der Nutzer Mitglied des Servers ist
    const { data: channel } = await supabase.from("channels").select("id, server_id").eq("id", room).eq("type", "voice").maybeSingle();
    if (!channel) return json({ error: "Unbekannter Voice-Channel" }, 404);
    const perm = async (p: string) => (await supabase.rpc("has_perm", { sid: channel.server_id, perm: p })).data === true;
    if (!(await perm("connect_voice"))) return json({ error: "Dir fehlt das Recht, Sprachkanälen beizutreten." }, 403);
    const sources = [TrackSource.MICROPHONE];
    if (await perm("stream")) sources.push(TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);

    const { data: profile } = await supabase.from("profiles").select("username").eq("id", user.id).single();

    const at = new AccessToken(Deno.env.get("LIVEKIT_API_KEY")!, Deno.env.get("LIVEKIT_API_SECRET")!, {
      identity: user.id,
      name: profile?.username ?? "Unbekannt",
      ttl: "6h",
    });
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishSources: sources });
    return json({ token: await at.toJwt() });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
