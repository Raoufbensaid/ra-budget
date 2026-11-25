/**
 * Modèles des e-mails de Ra Budget, en français, dans le style de l'e-mail
 * de code de connexion. Module pur (sans Deno ni réseau) : testé avec Vitest.
 */

export interface OutboxEmail {
  kind: string;
  payload: Record<string, unknown>;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** 123456 → « 1 234,56 € ». */
export function formatEuros(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const euros = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const rest = (abs % 100).toString().padStart(2, "0");
  return `${sign}${euros},${rest} €`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function str(payload: Record<string, unknown>, key: string, fallback = ""): string {
  const v = payload[key];
  return typeof v === "string" ? v : fallback;
}

function cents(payload: Record<string, unknown>, key: string): number {
  const v = payload[key];
  return typeof v === "number" ? v : 0;
}

function token(payload: Record<string, unknown>): string {
  const t = str(payload, "token");
  if (!t) throw new Error("missing_token");
  return encodeURIComponent(t);
}

interface Parts {
  subject: string;
  title: string;
  /** Paragraphes en texte brut (échappés pour le HTML). */
  lines: string[];
  button: string;
  url: string;
  footer: string;
}

function layout(p: Parts): RenderedEmail {
  const paragraphs = p.lines
    .map((l) => `<p style="margin: 0 0 12px;">${escapeHtml(l)}</p>`)
    .join("\n  ");
  const html = `<div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 420px; margin: 0 auto; padding: 24px; color: #15171a;">
  <p style="color: #0e7c66; font-weight: 700; letter-spacing: 1px; font-size: 12px;">RA BUDGET</p>
  <h1 style="font-size: 20px; margin: 8px 0 16px;">${escapeHtml(p.title)}</h1>
  ${paragraphs}
  <p style="margin: 20px 0;"><a href="${escapeHtml(p.url)}" style="display: inline-block; background: #0e7c66; color: #ffffff; text-decoration: none; font-weight: 600; padding: 12px 20px; border-radius: 10px;">${escapeHtml(p.button)}</a></p>
  <p style="color: #6a6e75; font-size: 13px;">${escapeHtml(p.footer)}</p>
  <p style="color: #6a6e75; font-size: 12px; word-break: break-all;">${escapeHtml(p.url)}</p>
</div>`;
  const text = [p.title, "", ...p.lines, "", `${p.button} : ${p.url}`, "", p.footer].join("\n");
  return { subject: p.subject, html, text };
}

/** Construit l'e-mail à partir d'une ligne de la file d'envoi. */
export function renderEmail(email: OutboxEmail, siteUrl: string): RenderedEmail {
  const site = siteUrl.replace(/\/+$/, "");
  const p = email.payload ?? {};
  const team = str(p, "team_name", "ta Team");

  switch (email.kind) {
    case "team_invitation": {
      const inviter = str(p, "inviter");
      return layout({
        subject: `Invitation dans la Team « ${team} »`,
        title: `Rejoins la Team « ${team} »`,
        lines: [
          inviter
            ? `${inviter} t'invite à partager les dépenses de la Team « ${team} » sur Ra Budget.`
            : `Tu es invité·e à partager les dépenses de la Team « ${team} » sur Ra Budget.`,
          "Connecte-toi avec cette adresse e-mail pour accepter ou refuser l'invitation.",
        ],
        button: "Voir l'invitation",
        url: `${site}/invite/${token(p)}`,
        footer:
          "Ce lien est valable 7 jours. Si tu ne connais pas cette personne, ignore simplement cet e-mail.",
      });
    }
    case "approve_expense": {
      const title = str(p, "title", "Dépense");
      const name = str(p, "name");
      const payer = str(p, "payer");
      return layout({
        subject: `Valide la dépense « ${title} » (${team})`,
        title: p.corrected === true ? "Une dépense a été corrigée" : "Une dépense à valider",
        lines: [
          name ? `Bonjour ${name},` : "Bonjour,",
          p.corrected === true
            ? `La dépense « ${title} » de la Team « ${team} » a été corrigée. Vérifie la nouvelle version.`
            : `Une dépense de la Team « ${team} » te concerne : « ${title} »${payer ? `, payée par ${payer}` : ""}.`,
          `Total : ${formatEuros(cents(p, "total_cents"))} — ta part : ${formatEuros(cents(p, "share_cents"))}.`,
          "Ouvre le lien pour la valider ou signaler une erreur. Pas besoin de compte.",
        ],
        button: "Voir la dépense",
        url: `${site}/t/${token(p)}`,
        footer:
          "Ce lien ne sert qu'une fois et reste valable 7 jours. Ne le transfère pas : il agit en ton nom.",
      });
    }
    case "approval_requested": {
      const title = str(p, "title", "Dépense");
      const teamId = encodeURIComponent(str(p, "team_id"));
      const expenseId = encodeURIComponent(str(p, "expense_id"));
      return layout({
        subject: `Dépense à valider : « ${title} » (${team})`,
        title: p.corrected === true ? "Une dépense a été corrigée" : "Une dépense à valider",
        lines: [
          `La dépense « ${title} » de la Team « ${team} » attend ta validation.`,
          `Total : ${formatEuros(cents(p, "total_cents"))} — ta part : ${formatEuros(cents(p, "share_cents"))}.`,
        ],
        button: "Ouvrir dans Ra Budget",
        url: `${site}/teams/${teamId}/expenses/${expenseId}`,
        footer: "Tu reçois cet e-mail parce que tu participes à cette Team.",
      });
    }
    default:
      throw new Error("unknown_kind");
  }
}
