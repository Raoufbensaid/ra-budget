/**
 * Accès aux dépenses enregistrées dans Supabase. Les règles RLS de la base
 * garantissent que chacun ne lit et n'écrit que ses propres dépenses.
 */
import type { CategoryId, PurchaseDraft, Unit } from "@ra/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface SavedItem {
  position: number;
  raw_label: string;
  name: string | null;
  quantity: number;
  unit: Unit;
  total_price_cents: number | null;
  category_id: CategoryId | null;
}

export interface SavedPurchase {
  id: string;
  merchant: string | null;
  purchased_on: string;
  total_paid_cents: number | null;
  created_at: string;
  purchase_items: SavedItem[];
}

const PURCHASES_KEY = ["purchases"] as const;

/** Enregistre un brouillon validé (achat + articles en une transaction). */
export async function savePurchase(draft: PurchaseDraft): Promise<string> {
  const { data, error } = await supabase.rpc("create_purchase", { draft });
  if (error) throw error;
  return data as string;
}

export function useSavePurchase() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: savePurchase,
    onSuccess: () => client.invalidateQueries({ queryKey: PURCHASES_KEY }),
  });
}

export function usePurchases() {
  return useQuery({
    queryKey: PURCHASES_KEY,
    queryFn: async (): Promise<SavedPurchase[]> => {
      const { data, error } = await supabase
        .from("purchases")
        .select(
          "id, merchant, purchased_on, total_paid_cents, created_at, purchase_items (position, raw_label, name, quantity, unit, total_price_cents, category_id)",
        )
        .order("purchased_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((p) => ({
        ...p,
        purchase_items: [...(p.purchase_items ?? [])]
          .map((i) => ({ ...i, quantity: Number(i.quantity) }))
          .sort((a, b) => a.position - b.position),
      })) as SavedPurchase[];
    },
  });
}

export function useDeletePurchase() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("purchases").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: PURCHASES_KEY }),
  });
}

/** Total d'une dépense : total payé s'il est connu, sinon somme des articles. */
export function purchaseTotal(p: SavedPurchase): number {
  return p.total_paid_cents ?? p.purchase_items.reduce((s, i) => s + (i.total_price_cents ?? 0), 0);
}
