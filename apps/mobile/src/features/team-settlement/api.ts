/**
 * Clôture d'une Team : bilan, validations et remboursements. Lecture sous
 * RLS ; toutes les actions passent par des fonctions de la base.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

export type Via = "app" | "email" | "owner";
export type RepaymentStatus = "pending" | "declared" | "partial" | "confirmed";

export interface SettlementBalance {
  memberId: string;
  position: number;
  paidCents: number;
  shareCents: number;
  balanceCents: number;
  mustApprove: boolean;
}

export interface SettlementApproval {
  memberId: string;
  decision: "approved" | "refused";
  reason: string | null;
  via: Via;
}

export interface RepaymentEventView {
  id: string;
  kind: "declared" | "confirmed";
  amountCents: number;
  via: Via;
  createdAt: string;
}

export interface Repayment {
  id: string;
  position: number;
  fromMember: string;
  toMember: string;
  amountCents: number;
  declaredCents: number;
  confirmedCents: number;
  status: RepaymentStatus;
  events: RepaymentEventView[];
}

export interface Settlement {
  id: string;
  teamId: string;
  requestedBy: string | null;
  status: "pending" | "approved" | "superseded";
  totalCents: number;
  expenseCount: number;
  createdAt: string;
  balances: SettlementBalance[];
  approvals: SettlementApproval[];
  repayments: Repayment[];
}

const KEY = ["team-settlement"] as const;

const SELECT =
  "id, team_id, requested_by, status, total_cents, expenses, created_at, settlement_balances (member_id, position, paid_cents, share_cents, balance_cents, must_approve), settlement_approvals (member_id, decision, reason, via), repayments (id, position, from_member, to_member, amount_cents, declared_cents, confirmed_cents, status, repayment_events (id, kind, amount_cents, via, created_at))";

interface Row {
  id: string;
  team_id: string;
  requested_by: string | null;
  status: Settlement["status"];
  total_cents: number;
  expenses: unknown[];
  created_at: string;
  settlement_balances: {
    member_id: string;
    position: number;
    paid_cents: number;
    share_cents: number;
    balance_cents: number;
    must_approve: boolean;
  }[];
  settlement_approvals: {
    member_id: string;
    decision: "approved" | "refused";
    reason: string | null;
    via: Via;
  }[];
  repayments: {
    id: string;
    position: number;
    from_member: string;
    to_member: string;
    amount_cents: number;
    declared_cents: number;
    confirmed_cents: number;
    status: RepaymentStatus;
    repayment_events: {
      id: string;
      kind: "declared" | "confirmed";
      amount_cents: number;
      via: Via;
      created_at: string;
    }[];
  }[];
}

function toSettlement(r: Row): Settlement {
  return {
    id: r.id,
    teamId: r.team_id,
    requestedBy: r.requested_by,
    status: r.status,
    totalCents: Number(r.total_cents),
    expenseCount: Array.isArray(r.expenses) ? r.expenses.length : 0,
    createdAt: r.created_at,
    balances: [...(r.settlement_balances ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((b) => ({
        memberId: b.member_id,
        position: b.position,
        paidCents: Number(b.paid_cents),
        shareCents: Number(b.share_cents),
        balanceCents: Number(b.balance_cents),
        mustApprove: b.must_approve,
      })),
    approvals: (r.settlement_approvals ?? []).map((a) => ({
      memberId: a.member_id,
      decision: a.decision,
      reason: a.reason,
      via: a.via,
    })),
    repayments: [...(r.repayments ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((p) => ({
        id: p.id,
        position: p.position,
        fromMember: p.from_member,
        toMember: p.to_member,
        amountCents: Number(p.amount_cents),
        declaredCents: Number(p.declared_cents),
        confirmedCents: Number(p.confirmed_cents),
        status: p.status,
        events: [...(p.repayment_events ?? [])]
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((e) => ({
            id: e.id,
            kind: e.kind,
            amountCents: Number(e.amount_cents),
            via: e.via,
            createdAt: e.created_at,
          })),
      })),
  };
}

/** Rafraîchit le bilan dès qu'il change (temps réel ; la RLS filtre). */
function useSettlementRealtime(teamId: string) {
  const client = useQueryClient();
  useEffect(() => {
    if (!teamId) return;
    const refresh = () => void client.invalidateQueries({ queryKey: KEY });
    const channel = supabase
      .channel(`settlement-${teamId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_settlements", filter: `team_id=eq.${teamId}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "settlement_approvals" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "repayments", filter: `team_id=eq.${teamId}` },
        refresh,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [client, teamId]);
}

/** Dernier bilan de la Team (en cours, validé ou remplacé), ou null. */
export function useLatestSettlement(teamId: string) {
  useSettlementRealtime(teamId);
  return useQuery({
    queryKey: [...KEY, teamId],
    enabled: teamId.length > 0,
    queryFn: async (): Promise<Settlement | null> => {
      const { data, error } = await supabase
        .from("team_settlements")
        .select(SELECT)
        .eq("team_id", teamId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? toSettlement(data as unknown as Row) : null;
    },
  });
}

function useSettlementRpc<TArgs extends Record<string, unknown>, TResult = void>(fn: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs): Promise<TResult> => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw error;
      return data as TResult;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: KEY });
      void client.invalidateQueries({ queryKey: ["teams"] });
    },
  });
}

export const useRequestSettlement = () =>
  useSettlementRpc<{ p_team: string }, string>("request_settlement");
export const useApproveSettlement = () =>
  useSettlementRpc<{ p_settlement: string; p_member: string | null }>("approve_settlement");
export const useDisputeSettlement = () =>
  useSettlementRpc<{ p_settlement: string; p_reason: string; p_member: string | null }>(
    "dispute_settlement",
  );
export const useDeclareRepayment = () =>
  useSettlementRpc<{ p_repayment: string; p_amount: number; p_member: string | null }>(
    "declare_repayment",
  );
export const useConfirmRepayment = () =>
  useSettlementRpc<{ p_repayment: string; p_amount: number; p_member: string | null }>(
    "confirm_repayment",
  );
export const useArchiveTeam = () => useSettlementRpc<{ p_team: string }>("archive_team");

const KNOWN = [
  "forbidden",
  "team_locked",
  "expenses_open",
  "reason_required",
  "settlement_closed",
  "not_concerned",
  "invalid_amount",
  "repayment_closed",
  "not_settled",
] as const;

/** Texte à afficher pour une erreur de clôture ou de remboursement. */
export function settlementErrorMessage(error: unknown, t: TFunction): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
  return (KNOWN as readonly string[]).includes(message)
    ? t(`settlement.errors.${message}`)
    : t("settlement.errors.generic");
}
