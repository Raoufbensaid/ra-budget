/**
 * Dépenses d'une Team. Lecture sous RLS ; création, correction et annulation
 * par des fonctions de la base qui vérifient les droits et les parts.
 */
import type { CategoryId, Unit } from "@ra/core";
import type { Decision, ExpenseStatus, SplitMode } from "@ra/team";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

export interface TeamExpenseItem {
  /** Position dans le ticket (1, 2, 3…), unique dans la dépense. */
  position: number;
  label: string;
  quantity: number;
  unit: Unit;
  unitPriceCents: number | null;
  totalCents: number;
  categoryId: CategoryId | null;
}

export interface TeamExpenseView {
  id: string;
  teamId: string;
  enteredBy: string;
  paidBy: string;
  title: string;
  spentOn: string;
  totalCents: number;
  categoryId: CategoryId | null;
  splitMode: SplitMode;
  status: ExpenseStatus;
  version: number;
  receiptId: string | null;
  createdAt: string;
  beneficiaries: { memberId: string; shareCents: number }[];
  items: TeamExpenseItem[];
  /** Décisions sur la version courante seulement. */
  approvals: { memberId: string; decision: Decision; via: "app" | "email" | "owner" }[];
  disputes: ExpenseDispute[];
}

export interface ExpenseDispute {
  id: string;
  memberId: string;
  version: number;
  kind: "refuse" | "error" | "correction";
  reason: string;
  status: "open" | "resolved";
  createdAt: string;
}

/** Brouillon envoyé à create_expense / update_expense. */
export interface ExpenseDraft {
  paid_by: string;
  title: string;
  spent_on: string;
  total_cents: number;
  category_id: CategoryId | null;
  split_mode: SplitMode;
  beneficiaries: { member_id: string; share_cents?: number }[];
  items?: {
    label: string;
    quantity: number;
    unit_price_cents: number | null;
    total_cents: number;
    category_id: CategoryId | null;
  }[];
}

const KEY = ["team-expenses"] as const;

const SELECT =
  "id, team_id, entered_by, paid_by, title, spent_on, total_cents, category_id, split_mode, status, version, receipt_id, created_at, expense_beneficiaries (member_id, position, share_cents), receipt_items (position, label, quantity, unit_price_cents, total_cents, category_id), expense_approvals (member_id, version, decision, via), expense_disputes (id, member_id, version, kind, reason, status, created_at)";

interface Row {
  id: string;
  team_id: string;
  entered_by: string;
  paid_by: string;
  title: string;
  spent_on: string;
  total_cents: number;
  category_id: CategoryId | null;
  split_mode: SplitMode;
  status: ExpenseStatus;
  version: number;
  receipt_id: string | null;
  created_at: string;
  expense_beneficiaries: { member_id: string; position: number; share_cents: number }[];
  receipt_items: {
    position: number;
    label: string;
    quantity: number | string;
    unit_price_cents: number | null;
    total_cents: number;
    category_id: CategoryId | null;
  }[];
  expense_approvals: {
    member_id: string;
    version: number;
    decision: Decision;
    via: "app" | "email" | "owner";
  }[];
  expense_disputes: {
    id: string;
    member_id: string;
    version: number;
    kind: ExpenseDispute["kind"];
    reason: string;
    status: ExpenseDispute["status"];
    created_at: string;
  }[];
}

function toView(r: Row): TeamExpenseView {
  return {
    id: r.id,
    teamId: r.team_id,
    enteredBy: r.entered_by,
    paidBy: r.paid_by,
    title: r.title,
    spentOn: r.spent_on,
    totalCents: r.total_cents,
    categoryId: r.category_id,
    splitMode: r.split_mode,
    status: r.status,
    version: r.version,
    receiptId: r.receipt_id,
    createdAt: r.created_at,
    beneficiaries: [...(r.expense_beneficiaries ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((b) => ({ memberId: b.member_id, shareCents: b.share_cents })),
    items: [...(r.receipt_items ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        position: i.position,
        label: i.label,
        quantity: Number(i.quantity),
        unit: "piece" as const,
        unitPriceCents: i.unit_price_cents,
        totalCents: i.total_cents,
        categoryId: i.category_id,
      })),
    approvals: (r.expense_approvals ?? [])
      .filter((a) => a.version === r.version)
      .map((a) => ({ memberId: a.member_id, decision: a.decision, via: a.via })),
    disputes: [...(r.expense_disputes ?? [])]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((d) => ({
        id: d.id,
        memberId: d.member_id,
        version: d.version,
        kind: d.kind,
        reason: d.reason,
        status: d.status,
        createdAt: d.created_at,
      })),
  };
}

/** Rafraîchit les dépenses d'une Team dès qu'elles changent (temps réel). */
function useExpensesRealtime(teamId: string) {
  const client = useQueryClient();
  useEffect(() => {
    if (!teamId) return;
    const channel = supabase
      .channel(`expenses-${teamId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "expenses", filter: `team_id=eq.${teamId}` },
        () => void client.invalidateQueries({ queryKey: KEY }),
      )
      // Les validations et contestations n'ont pas de team_id : la RLS filtre.
      .on("postgres_changes", { event: "*", schema: "public", table: "expense_approvals" }, () =>
        client.invalidateQueries({ queryKey: KEY }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "expense_disputes" }, () =>
        client.invalidateQueries({ queryKey: KEY }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [client, teamId]);
}

export function useTeamExpenses(teamId: string) {
  useExpensesRealtime(teamId);
  return useQuery({
    queryKey: [...KEY, teamId],
    enabled: teamId.length > 0,
    queryFn: async (): Promise<TeamExpenseView[]> => {
      const { data, error } = await supabase
        .from("expenses")
        .select(SELECT)
        .eq("team_id", teamId)
        .order("spent_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return ((data ?? []) as Row[]).map(toView);
    },
  });
}

export function useTeamExpense(expenseId: string) {
  return useQuery({
    queryKey: [...KEY, "one", expenseId],
    enabled: expenseId.length > 0,
    queryFn: async (): Promise<TeamExpenseView | null> => {
      const { data, error } = await supabase
        .from("expenses")
        .select(SELECT)
        .eq("id", expenseId)
        .maybeSingle();
      if (error) throw error;
      return data ? toView(data as Row) : null;
    },
  });
}

function useExpenseRpc<TArgs extends Record<string, unknown>, TResult = void>(fn: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs): Promise<TResult> => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw error;
      return data as TResult;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  });
}

export const useCreateExpense = () =>
  useExpenseRpc<{ p_team: string; p_draft: ExpenseDraft }, string>("create_expense");
export const useUpdateExpense = () =>
  useExpenseRpc<{ p_expense: string; p_draft: ExpenseDraft }>("update_expense");
export const useCancelExpense = () =>
  useExpenseRpc<{ p_expense: string; p_reason: string }>("cancel_expense");

/** Peut corriger ou annuler : a saisi, a payé, ou est le créateur de la Team. */
export function canEditExpense(
  expense: TeamExpenseView,
  myMemberId: string | undefined,
  isOwner: boolean,
): boolean {
  if (expense.status === "cancelled") return false;
  return (
    isOwner ||
    (myMemberId !== undefined && [expense.enteredBy, expense.paidBy].includes(myMemberId))
  );
}

export const useApproveExpense = () =>
  useExpenseRpc<{ p_expense: string; p_version: number; p_member: string | null }>(
    "approve_expense",
  );
export const useDisputeExpense = () =>
  useExpenseRpc<{
    p_expense: string;
    p_version: number;
    p_kind: ExpenseDispute["kind"];
    p_reason: string;
    p_member: string | null;
  }>("dispute_expense");

export interface HistoryEntry {
  id: number;
  action: string;
  actorMember: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

/** Historique d'une dépense (création, corrections, validations, contestations…). */
export function useExpenseHistory(expenseId: string) {
  return useQuery({
    queryKey: [...KEY, "history", expenseId],
    enabled: expenseId.length > 0,
    queryFn: async (): Promise<HistoryEntry[]> => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, action, actor_member, data, created_at")
        .eq("target_id", expenseId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as number,
        action: r.action as string,
        actorMember: r.actor_member as string | null,
        data: (r.data ?? {}) as Record<string, unknown>,
        createdAt: r.created_at as string,
      }));
    },
  });
}
