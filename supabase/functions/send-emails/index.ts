/**
 * Envoi des e-mails de la file `email_outbox` par l'API Brevo.
 *
 * Appelée par la base à chaque ajout dans la file (pg_net). Elle ne reçoit
 * aucune donnée : un appel ne fait que vider la file, donc elle n'a pas besoin
 * de connexion (verify_jwt = false). Les secrets sont lus dans
 * l'environnement de la fonction, saisis avec `supabase secrets set` :
 * - BREVO_API_KEY : clé API Brevo (xkeysib-…) ;
 * - MAIL_FROM : adresse d'expéditeur validée dans Brevo ;
 * - SITE_URL : adresse de la version web (liens des e-mails).
 */
import { renderEmail } from "../_shared/email-templates.ts";

interface OutboxRow {
  id: string;
  to_email: string;
  kind: string;
  payload: Record<string, unknown>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Clé serveur fournie par Supabase (nouvelle clé secrète, sinon l'ancienne). */
function serviceKey(): string | undefined {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, string>;
      const key = parsed.default ?? Object.values(parsed)[0];
      if (key) return key;
    } catch {
      // On essaie l'ancienne clé.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? undefined;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const key = serviceKey();
  const url = Deno.env.get("SUPABASE_URL");
  if (!key || !url) throw new Error("server_key_missing");
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc_${name}_${res.status}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

async function sendOne(row: OutboxRow, brevoKey: string, from: string, site: string) {
  const mail = renderEmail(row, site);
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": brevoKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Ra Budget", email: from },
      to: [{ email: row.to_email }],
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
    }),
  });
  if (!res.ok) throw new Error(`brevo_${res.status}`);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);

  const brevoKey = Deno.env.get("BREVO_API_KEY");
  const from = Deno.env.get("MAIL_FROM");
  const site = Deno.env.get("SITE_URL");
  if (!brevoKey || !from || !site) {
    // Rien n'est réservé : les e-mails attendent la configuration.
    return json({ ok: false, reason: "not_configured" }, 503);
  }

  let sent = 0;
  let failed = 0;
  try {
    for (let batch = 0; batch < 5; batch++) {
      const rows = await rpc<OutboxRow[]>("claim_outbox", { p_limit: 20 });
      if (!rows || rows.length === 0) break;
      for (const row of rows) {
        try {
          await sendOne(row, brevoKey, from, site);
          await rpc("complete_outbox", { p_id: row.id, p_error: null });
          sent++;
        } catch (e) {
          const message = e instanceof Error ? e.message : "send_failed";
          await rpc("complete_outbox", { p_id: row.id, p_error: message });
          failed++;
        }
      }
    }
  } catch (e) {
    return json({ ok: false, reason: e instanceof Error ? e.message : "error", sent, failed }, 500);
  }
  return json({ ok: true, sent, failed });
});
