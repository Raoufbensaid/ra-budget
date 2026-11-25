/**
 * Données du tableau de bord : les dépenses d'une période (avec leurs articles)
 * et le budget mensuel du profil. Les règles RLS limitent tout au compte connecté.
 * Ta part des dépenses de Team validées y est ajoutée.
 */
import type { InsightPurchase } from "@ra/insights";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/auth/session-provider";
import type { SavedItem } from "@/features/purchases/api";
import { fetchTeamShares, shareAsPurchase } from "@/features/team-shares/api";
import { supabase } from "@/lib/supabase";

/**
 * Dépenses entre deux dates incluses (« AAAA-MM-JJ »). La clé commence par
 * « purchases » : un ajout ou une suppression rafraîchit aussi le tableau de bord.
 */
export function usePurchasesBetween(from: string, to: string) {
  const userId = useSession().session?.user.id ?? null;
  return useQuery({
    queryKey: ["purchases", userId, "between", from, to],
    enabled: userId !== null,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<InsightPurchase[]> => {
      const { data, error } = await supabase
        .from("purchases")
        .select(
          "id, merchant, purchased_on, total_paid_cents, purchase_items (position, raw_label, name, quantity, unit, total_price_cents, category_id)",
        )
        .gte("purchased_on", from)
        .lte("purchased_on", to)
        .order("purchased_on", { ascending: true })
        .limit(5000);
      if (error) throw error;
      const shares = await fetchTeamShares(from, to);
      const own: InsightPurchase[] = (data ?? []).map((p) => ({
        id: p.id as string,
        merchant: p.merchant as string | null,
        purchasedOn: p.purchased_on as string,
        totalPaidCents: p.total_paid_cents as number | null,
        items: [...((p.purchase_items ?? []) as SavedItem[])]
          .sort((a, b) => a.position - b.position)
          .map((i) => ({
            rawLabel: i.raw_label,
            name: i.name,
            quantity: Number(i.quantity),
            unit: i.unit,
            totalPriceCents: i.total_price_cents,
            categoryId: i.category_id,
          })),
      }));
      // Ta part des dépenses de Team validées compte comme une dépense à toi.
      return [...own, ...shares.map(shareAsPurchase)].sort((a, b) =>
        a.purchasedOn.localeCompare(b.purchasedOn),
      );
    },
  });
}

/** Budget mensuel en centimes, ou null s'il n'est pas défini. */
export function useBudget() {
  const userId = useSession().session?.user.id ?? null;
  return useQuery({
    queryKey: ["profile", userId, "budget"],
    enabled: userId !== null,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("monthly_budget_cents")
        .eq("id", userId as string)
        .maybeSingle();
      if (error) throw error;
      return (data?.monthly_budget_cents as number | null | undefined) ?? null;
    },
  });
}

export function useSetBudget() {
  const client = useQueryClient();
  const userId = useSession().session?.user.id ?? null;
  return useMutation({
    mutationFn: async (cents: number | null) => {
      if (!userId) throw new Error("not signed in");
      const { error } = await supabase
        .from("profiles")
        .update({ monthly_budget_cents: cents })
        .eq("id", userId);
      if (error) throw error;
      return cents;
    },
    onSuccess: (cents) => client.setQueryData(["profile", userId, "budget"], cents),
  });
}
