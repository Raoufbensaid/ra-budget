/** Notifications de l'application (validation demandée, contestation…), en temps réel. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useSession } from "@/features/auth/session-provider";
import { supabase } from "@/lib/supabase";

export type NotificationKind =
  | "approval_requested"
  | "expense_corrected"
  | "expense_disputed"
  | "expense_validated"
  | "team_invitation"
  | "settlement_requested"
  | "settlement_disputed"
  | "settlement_validated"
  | "repayment_declared"
  | "repayment_confirmed"
  | "team_settled";

export interface AppNotification {
  id: string;
  teamId: string;
  kind: NotificationKind;
  expenseId: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

const KEY = ["notifications"] as const;

/** Les 50 dernières notifications du compte connecté. */
export function useNotifications() {
  const userId = useSession().session?.user.id ?? null;
  const client = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${userId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => void client.invalidateQueries({ queryKey: KEY }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [client, userId]);

  return useQuery({
    queryKey: [...KEY, userId],
    enabled: userId !== null,
    queryFn: async (): Promise<AppNotification[]> => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, team_id, kind, expense_id, data, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((n) => ({
        id: n.id as string,
        teamId: n.team_id as string,
        kind: n.kind as NotificationKind,
        expenseId: n.expense_id as string | null,
        data: (n.data ?? {}) as Record<string, unknown>,
        readAt: n.read_at as string | null,
        createdAt: n.created_at as string,
      }));
    },
  });
}

export function useUnreadCount(): number {
  return (useNotifications().data ?? []).filter((n) => n.readAt === null).length;
}

/** Marque comme lues les notifications données (ou toutes si `null`). */
export function useMarkRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[] | null) => {
      const { error } = await supabase.rpc("mark_notifications_read", { p_ids: ids });
      if (error) throw error;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  });
}
