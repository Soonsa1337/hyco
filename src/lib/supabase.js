import { createClient } from '@supabase/supabase-js';

// Zugangsdaten: beim Build eingebacken (.env) oder beim ersten Start eingegeben (localStorage)
const env = import.meta.env;
let saved = null;
try {
  saved = JSON.parse(localStorage.getItem('hycoConfig') || 'null');
} catch {}
export const config = {
  url: env.VITE_SUPABASE_URL || saved?.url || '',
  key: env.VITE_SUPABASE_ANON_KEY || saved?.key || '',
  livekit: env.VITE_LIVEKIT_URL || saved?.livekit || '',
};
export const configured = Boolean(config.url && config.key && config.livekit);
export const inviteCode = configured ? btoa(JSON.stringify(config)) : '';
export const supabase = configured ? createClient(config.url, config.key) : null;

// Edge Function aufrufen und Fehlertext sauber herausreichen
export async function callFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try {
      msg = (await error.context.json()).error || msg;
    } catch {}
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
