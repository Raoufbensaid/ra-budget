/** Identifiant d'un membre de Team (inscrit ou invité). */
export type MemberId = string;

/** Part d'un bénéficiaire dans une dépense, en centimes. */
export interface Share {
  memberId: MemberId;
  cents: number;
}

export type ExpenseStatus = "pending" | "validated" | "disputed" | "cancelled";

export interface TeamExpense {
  id: string;
  paidBy: MemberId;
  totalCents: number;
  shares: Share[];
  status: ExpenseStatus;
}

export interface Balance {
  memberId: MemberId;
  /** Ce que le membre a avancé. */
  paidCents: number;
  /** Ce que le membre a consommé (somme de ses parts). */
  shareCents: number;
  /** payé − part : positif = on lui doit, négatif = il doit. */
  balanceCents: number;
}

export interface Transfer {
  from: MemberId;
  to: MemberId;
  amountCents: number;
}

export type SplitError = "empty" | "not_integer" | "negative" | "duplicate" | "sum_mismatch";

export interface RepaymentEvent {
  /** Déclaration du débiteur ou confirmation de réception par le créancier. */
  kind: "declared" | "confirmed";
  amountCents: number;
}

export type RepaymentStatus = "pending" | "declared" | "partial" | "confirmed";
