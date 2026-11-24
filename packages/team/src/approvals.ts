import type { MemberId } from "./types";

export type Decision = "approved" | "refused";

export interface ApprovalRecord {
  memberId: MemberId;
  decision: Decision;
}

export interface ApprovalState {
  status: "pending" | "validated" | "disputed";
  approved: MemberId[];
  waiting: MemberId[];
  refused: MemberId[];
}

/** Personnes qui doivent valider : le payeur d'abord, puis les bénéficiaires. */
export function requiredApprovers(paidBy: MemberId, beneficiaries: MemberId[]): MemberId[] {
  return [paidBy, ...beneficiaries.filter((id) => id !== paidBy)].filter(
    (id, i, list) => list.indexOf(id) === i,
  );
}

/**
 * Statut d'une dépense d'après les décisions sur sa version courante :
 * un refus la rend contestée ; elle n'est validée que si tous ont validé.
 */
export function approvalState(required: MemberId[], approvals: ApprovalRecord[]): ApprovalState {
  const decisionOf = new Map(approvals.map((a) => [a.memberId, a.decision]));
  const approved = required.filter((id) => decisionOf.get(id) === "approved");
  const refused = required.filter((id) => decisionOf.get(id) === "refused");
  const waiting = required.filter((id) => !decisionOf.has(id));
  const status = refused.length > 0 ? "disputed" : waiting.length === 0 ? "validated" : "pending";
  return { status, approved, waiting, refused };
}
