import type { MemberId, Share, SplitError } from "./types";

/**
 * Partage égal au centime près : chacun reçoit la part entière, et les
 * centimes restants vont aux premiers membres, dans l'ordre donné.
 */
export function splitEqual(totalCents: number, memberIds: MemberId[]): Share[] {
  const n = memberIds.length;
  if (n === 0) return [];
  const base = Math.floor(totalCents / n);
  const rest = totalCents - base * n;
  return memberIds.map((memberId, i) => ({ memberId, cents: base + (i < rest ? 1 : 0) }));
}

/** Vérifie des parts personnalisées ; null si elles sont valables. */
export function validateShares(totalCents: number, shares: Share[]): SplitError | null {
  if (shares.length === 0) return "empty";
  if (shares.some((s) => !Number.isInteger(s.cents))) return "not_integer";
  if (shares.some((s) => s.cents < 0)) return "negative";
  if (new Set(shares.map((s) => s.memberId)).size !== shares.length) return "duplicate";
  const sum = shares.reduce((acc, s) => acc + s.cents, 0);
  return sum === totalCents ? null : "sum_mismatch";
}

export type SplitMode = "equal" | "custom";

export type BuildSharesResult = { shares: Share[] } | { error: SplitError | "invalid_total" };

/**
 * Parts d'une dépense à partir du formulaire : partage égal ou parts
 * personnalisées (prises dans l'ordre des bénéficiaires, puis vérifiées).
 */
export function buildShares(
  totalCents: number,
  beneficiaries: MemberId[],
  mode: SplitMode,
  custom: Record<MemberId, number> = {},
): BuildSharesResult {
  if (!Number.isInteger(totalCents) || totalCents <= 0) return { error: "invalid_total" };
  if (beneficiaries.length === 0) return { error: "empty" };
  if (mode === "equal") return { shares: splitEqual(totalCents, beneficiaries) };
  const shares = beneficiaries.map((memberId) => ({ memberId, cents: custom[memberId] ?? 0 }));
  const error = validateShares(totalCents, shares);
  return error ? { error } : { shares };
}
