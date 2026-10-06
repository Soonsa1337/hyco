// Stripe-Webhook: setzt surge_until bei bezahlter Rechnung, entfernt es bei Kündigung.
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET. "Verify JWT" für diese Funktion AUSschalten.
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

Deno.serve(async (req) => {
  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
  const sig = req.headers.get("stripe-signature") ?? "";
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), sig, Deno.env.get("STRIPE_WEBHOOK_SECRET")!);
  } catch (e) {
    return new Response(`Webhook-Signatur ungültig: ${e}`, { status: 400 });
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const setUntil = (userId: string, until: string | null) => admin.from("profiles").update({ surge_until: until }).eq("id", userId);

  if (event.type === "invoice.paid") {
    const inv = event.data.object as Stripe.Invoice;
    const subId = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;
    if (subId) {
      const sub = await stripe.subscriptions.retrieve(subId);
      const userId = sub.metadata?.user_id;
      if (userId) await setUntil(userId, new Date(sub.current_period_end * 1000).toISOString());
    }
  } else if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    if (sub.metadata?.user_id) await setUntil(sub.metadata.user_id, null);
  }
  return new Response("ok");
});
