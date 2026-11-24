import type { Balance, MemberId, TeamExpense, Transfer } from "./types";

/**
 * Soldes de chaque membre sur les seules dépenses validées.
 * La somme des soldes vaut toujours 0.
 */
export function computeBalances(memberIds: MemberId[], expenses: TeamExpense[]): Balance[] {
  const paid = new Map<MemberId, number>();
  const share = new Map<MemberId, number>();
  for (const e of expenses) {
    if (e.status !== "validated") continue;
    paid.set(e.paidBy, (paid.get(e.paidBy) ?? 0) + e.totalCents);
    for (const s of e.shares) share.set(s.memberId, (share.get(s.memberId) ?? 0) + s.cents);
  }
  return memberIds.map((memberId) => {
    const paidCents = paid.get(memberId) ?? 0;
    const shareCents = share.get(memberId) ?? 0;
    return { memberId, paidCents, shareCents, balanceCents: paidCents - shareCents };
  });
}

interface Open {
  memberId: MemberId;
  cents: number;
  order: number;
}

function sortOpen(list: Open[]): void {
  list.sort((a, b) => b.cents - a.cents || a.order - b.order);
}

/**
 * Virements qui soldent tous les comptes. À chaque étape, le plus gros
 * débiteur paie le plus gros créancier (égalités : ordre des membres).
 * Chaque virement solde au moins une personne : au plus n − 1 virements.
 */
export function planRepayments(balances: Balance[]): Transfer[] {
  const creditors: Open[] = [];
  const debtors: Open[] = [];
  balances.forEach((b, order) => {
    if (b.balanceCents > 0) creditors.push({ memberId: b.memberId, cents: b.balanceCents, order });
    if (b.balanceCents < 0) debtors.push({ memberId: b.memberId, cents: -b.balanceCents, order });
  });
  const transfers: Transfer[] = [];
  sortOpen(creditors);
  sortOpen(debtors);
  while (creditors.length > 0 && debtors.length > 0) {
    const creditor = creditors[0] as Open;
    const debtor = debtors[0] as Open;
    const amountCents = Math.min(creditor.cents, debtor.cents);
    transfers.push({ from: debtor.memberId, to: creditor.memberId, amountCents });
    creditor.cents -= amountCents;
    debtor.cents -= amountCents;
    if (creditor.cents === 0) creditors.shift();
    if (debtor.cents === 0) debtors.shift();
    sortOpen(creditors);
    sortOpen(debtors);
  }
  return transfers;
}
