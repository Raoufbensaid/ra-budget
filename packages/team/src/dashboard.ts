import type { MemberId, TeamExpense } from "./types";

/** Dépense vue par le tableau de bord : date, catégorie et ticket en plus. */
export interface DashboardExpense extends TeamExpense {
  /** Date de la dépense (« AAAA-MM-JJ »). */
  spentOn: string;
  categoryId: string | null;
  hasReceipt: boolean;
}

/** Période incluse ; une borne absente ne limite pas. */
export interface Period {
  from?: string;
  to?: string;
}

export interface TeamSummary {
  /** Total des dépenses validées. */
  totalCents: number;
  counts: { validated: number; pending: number; disputed: number };
  /** Tickets photographiés (dépenses non annulées). */
  receipts: number;
  /** Payé (avancé) et part théorique de chacun, sur les dépenses validées. */
  byMember: { memberId: MemberId; paidCents: number; shareCents: number }[];
  /** Dépenses validées par catégorie, de la plus grosse à la plus petite. */
  byCategory: { categoryId: string | null; cents: number }[];
}

function inPeriod(spentOn: string, period: Period): boolean {
  return (!period.from || spentOn >= period.from) && (!period.to || spentOn <= period.to);
}

/** Tableau de bord d'une Team sur une période. */
export function summarizeTeam(
  expenses: DashboardExpense[],
  memberIds: MemberId[],
  period: Period,
): TeamSummary {
  const list = expenses.filter((e) => e.status !== "cancelled" && inPeriod(e.spentOn, period));
  const validated = list.filter((e) => e.status === "validated");
  const paid = new Map<MemberId, number>();
  const share = new Map<MemberId, number>();
  const category = new Map<string | null, number>();
  for (const e of validated) {
    paid.set(e.paidBy, (paid.get(e.paidBy) ?? 0) + e.totalCents);
    for (const s of e.shares) share.set(s.memberId, (share.get(s.memberId) ?? 0) + s.cents);
    category.set(e.categoryId, (category.get(e.categoryId) ?? 0) + e.totalCents);
  }
  return {
    totalCents: validated.reduce((sum, e) => sum + e.totalCents, 0),
    counts: {
      validated: validated.length,
      pending: list.filter((e) => e.status === "pending").length,
      disputed: list.filter((e) => e.status === "disputed").length,
    },
    receipts: list.filter((e) => e.hasReceipt).length,
    byMember: memberIds.map((memberId) => ({
      memberId,
      paidCents: paid.get(memberId) ?? 0,
      shareCents: share.get(memberId) ?? 0,
    })),
    byCategory: [...category.entries()]
      .map(([categoryId, cents]) => ({ categoryId, cents }))
      .sort((a, b) => b.cents - a.cents),
  };
}

/** Mois (« AAAA-MM ») qui ont au moins une dépense non annulée, du plus récent au plus ancien. */
export function teamMonths(expenses: DashboardExpense[]): string[] {
  const months = new Set(
    expenses.filter((e) => e.status !== "cancelled").map((e) => e.spentOn.slice(0, 7)),
  );
  return [...months].sort((a, b) => b.localeCompare(a));
}
