import { daysInMonth, elapsedDays, type MonthKey } from "./months";

export type BudgetLevel = "ok" | "watch" | "over";

export interface BudgetStatus {
  budgetCents: number;
  spentCents: number;
  /** Reste à dépenser (négatif en cas de dépassement). */
  remainingCents: number;
  /** Part du budget consommée (peut dépasser 1). */
  used: number;
  /** Part du mois écoulée, entre 0 et 1. */
  timeElapsed: number;
  /**
   * - ok : on dépense moins vite que le temps passe ;
   * - watch : plus vite que le temps passe, mais encore sous le budget ;
   * - over : budget dépassé.
   */
  level: BudgetLevel;
  /** Ce qu'on peut encore dépenser par jour restant ; null si le mois est fini. */
  perDayLeftCents: number | null;
}

export function budgetStatus(
  budgetCents: number,
  spentCents: number,
  month: MonthKey,
  today: string,
): BudgetStatus {
  const total = daysInMonth(month);
  const elapsed = elapsedDays(month, today);
  const remainingCents = budgetCents - spentCents;
  const used = budgetCents > 0 ? spentCents / budgetCents : 0;
  const timeElapsed = elapsed / total;
  // Jours restants en comptant aujourd'hui.
  const daysLeft = total - elapsed + 1;
  const finished = elapsed >= total && month < today.slice(0, 7);
  const level: BudgetLevel =
    spentCents > budgetCents ? "over" : used > Math.max(timeElapsed, 0) + 0.1 ? "watch" : "ok";
  return {
    budgetCents,
    spentCents,
    remainingCents,
    used,
    timeElapsed,
    level,
    perDayLeftCents:
      finished || elapsed === 0 ? null : Math.max(0, Math.floor(remainingCents / daysLeft)),
  };
}
