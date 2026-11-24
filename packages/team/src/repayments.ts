import type { RepaymentEvent, RepaymentStatus } from "./types";

export interface RepaymentProgress {
  declaredCents: number;
  confirmedCents: number;
  remainingCents: number;
  status: RepaymentStatus;
}

/**
 * Avancement d'un remboursement. Seules les confirmations du créancier
 * comptent comme reçues : une déclaration du débiteur ne suffit jamais.
 */
export function repaymentProgress(
  amountCents: number,
  events: RepaymentEvent[],
): RepaymentProgress {
  const sum = (kind: RepaymentEvent["kind"]) =>
    events.filter((e) => e.kind === kind).reduce((s, e) => s + e.amountCents, 0);
  const declaredCents = sum("declared");
  const confirmedCents = Math.min(sum("confirmed"), amountCents);
  const remainingCents = amountCents - confirmedCents;
  let status: RepaymentStatus;
  if (remainingCents === 0) status = "confirmed";
  else if (confirmedCents > 0) status = "partial";
  else if (declaredCents > 0) status = "declared";
  else status = "pending";
  return { declaredCents, confirmedCents, remainingCents, status };
}

/** Une confirmation doit être un montant entier, positif, et pas plus que le reste dû. */
export function canConfirm(
  amountCents: number,
  events: RepaymentEvent[],
  confirmCents: number,
): boolean {
  if (!Number.isInteger(confirmCents) || confirmCents <= 0) return false;
  return confirmCents <= repaymentProgress(amountCents, events).remainingCents;
}
