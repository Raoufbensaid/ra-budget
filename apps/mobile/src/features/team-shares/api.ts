/**
 * Ta part des dépenses de Team validées (décision : « seulement ma part »).
 * Elle compte dans l'Historique et dans le Bilan comme une dépense personnelle.
 */
import type { CategoryId } from "@ra/core";
import type { InsightPurchase } from "@ra/insights";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/features/auth/session-provider";
import { supabase } from "@/lib/supabase";

export interface TeamShare {
  expenseId: string;
  teamId: string;
  teamName: string;
  teamIcon: string;
  title: string;
  spentOn: string;
  categoryId: CategoryId | null;
  totalCents: number;
  shareCents: number;
}

interface Row {
  expense_id: string;
  team_id: string;
  team_name: string;
  team_icon: string;
  title: string;
  spent_on: string;
  category_id: CategoryId | null;
  total_cents: number;
  share_cents: number;
}

/** Parts entre deux dates incluses (« AAAA-MM-JJ »), ou toutes. */
export async function fetchTeamShares(from?: string, to?: string): Promise<TeamShare[]> {
  const { data, error } = await supabase.rpc("my_team_shares", {
    p_from: from ?? null,
    p_to: to ?? null,
  });
  if (error) throw error;
  return ((data ?? []) as Row[]).map((r) => ({
    expenseId: r.expense_id,
    teamId: r.team_id,
    teamName: r.team_name,
    teamIcon: r.team_icon,
    title: r.title,
    spentOn: r.spent_on,
    categoryId: r.category_id,
    totalCents: r.total_cents,
    shareCents: r.share_cents,
  }));
}

/** Une part de Team vue comme une dépense personnelle (pour le Bilan). */
export function shareAsPurchase(share: TeamShare): InsightPurchase {
  return {
    id: `team-${share.expenseId}`,
    merchant: share.teamName,
    purchasedOn: share.spentOn,
    totalPaidCents: share.shareCents,
    items: [
      {
        rawLabel: share.title,
        name: share.title,
        quantity: 1,
        unit: "piece",
        totalPriceCents: share.shareCents,
        categoryId: share.categoryId,
      },
    ],
  };
}

/** Toutes tes parts de Team (Historique). La clé commence par « purchases ». */
export function useTeamShares() {
  const userId = useSession().session?.user.id ?? null;
  return useQuery({
    queryKey: ["purchases", userId, "team-shares"],
    enabled: userId !== null,
    queryFn: () => fetchTeamShares(),
  });
}
