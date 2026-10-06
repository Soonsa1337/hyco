// Erzeugt eine Stripe-Checkout-Sitzung für das Surge-Abo. Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_ID
// Deploy erst, wenn ein Stripe-Konto vorhanden ist (siehe README).
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Nicht eingeloggt" }, 401);
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: Deno.env.get("STRIPE_PRICE_ID")!, quantity: 1 }],
      customer_email: user.email ?? undefined,
      client_reference_id: user.id,
      metadata: { user_id: user.id },
      subscription_data: { metadata: { user_id: user.id } },
      success_url: "https://github.com/Soonsa1337/hyco#surge-danke",
      cancel_url: "https://github.com/Soonsa1337/hyco#surge-abgebrochen",
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
