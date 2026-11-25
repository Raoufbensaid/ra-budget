import type { CategoryId } from "@ra/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { supabase } from "@/lib/supabase";

/** État d'un lien reçu par e-mail (voir token_view dans la base). */
export type LinkState = "open" | "used" | "revoked" | "expired" | "stale" | "closed" | "invalid";

export interface LinkExpense {
  title: string;
  spent_on?: string;
  total_cents?: number;
  category_id?: CategoryId | null;
  split_mode?: "equal" | "custom";
  status?: string;
  payer?: string;
  i_paid?: boolean;
  entered_by?: string;
  my_share_cents?: number;
  beneficiaries?: { name: string; share_cents: number; is_me: boolean }[];
  items?: { label: string; quantity: number; total_cents: number }[];
}

export interface LinkSettlement {
  total_cents: number;
  expense_count: number;
  my_balance_cents: number;
  balances: {
    name: string;
    paid_cents: number;
    share_cents: number;
    balance_cents: number;
    is_me: boolean;
  }[];
  transfers: { from: string; to: string; amount_cents: number; involves_me: boolean }[];
}

export interface LinkRepayment {
  from_name: string;
  amount_cents: number;
  declared_cents: number;
  confirmed_cents: number;
  remaining_cents: number;
}

export interface LinkView {
  state: LinkState;
  kind?: "approve_expense" | "accept_invitation" | "approve_settlement" | "confirm_repayment";
  team_name?: string;
  member_name?: string;
  email?: string;
  inviter?: string | null;
  expense?: LinkExpense;
  settlement?: LinkSettlement;
  repayment?: LinkRepayment;
}

export type DisputeKind = "refuse" | "error" | "correction";

const linkKey = (token: string) => ["action-link", token] as const;

/** Ce que montre un lien. Fonctionne sans compte. */
export function useLinkView(token: string) {
  return useQuery({
    queryKey: linkKey(token),
    enabled: token.length > 0,
    retry: false,
    staleTime: 0,
    queryFn: async (): Promise<LinkView> => {
      const { data, error } = await supabase.rpc("token_view", { p_token: token });
      if (error) throw error;
      return data as LinkView;
    },
  });
}

/** Valider ou contester (dépense, bilan), ou confirmer une réception, par lien. */
export function useLinkAct(token: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      action: "approve" | "dispute" | "confirm";
      kind?: DisputeKind;
      reason?: string;
      amountCents?: number;
    }) => {
      const { error } = await supabase.rpc("token_act", {
        p_token: token,
        p_action: args.action,
        p_kind: args.kind ?? null,
        p_reason: args.reason ?? null,
        p_amount: args.amountCents ?? null,
      });
      if (error) throw error;
    },
    onError: () => client.invalidateQueries({ queryKey: linkKey(token) }),
  });
}

/** Demande un nouveau lien après expiration (envoyé à l'adresse d'origine). */
export function useLinkResend(token: string) {
  return useMutation({
    mutationFn: async (): Promise<"sent" | "too_soon" | "not_expired" | "invalid"> => {
      const { data, error } = await supabase.rpc("token_resend", { p_token: token });
      if (error) throw error;
      return (data as { state: "sent" | "too_soon" | "not_expired" | "invalid" }).state;
    },
  });
}

const KNOWN = [
  "link_used",
  "link_revoked",
  "link_expired",
  "link_stale",
  "link_closed",
  "link_invalid",
  "stale_version",
  "reason_required",
  "invalid_amount",
  "settlement_closed",
  "repayment_closed",
] as const;

/** Texte à afficher pour une erreur d'action par lien. */
export function linkErrorMessage(error: unknown, t: TFunction): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
  return (KNOWN as readonly string[]).includes(message)
    ? t(`links.errors.${message}`)
    : t("links.errors.generic");
}
