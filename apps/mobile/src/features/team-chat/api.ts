/** Discussion d'une Team : messages et messages automatiques, en temps réel. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

export interface TeamMessage {
  id: string;
  authorMember: string | null;
  kind: "text" | "system";
  body: string;
  event: string | null;
  expenseId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

const KEY = ["team-messages"] as const;

export function useTeamMessages(teamId: string) {
  const client = useQueryClient();
  useEffect(() => {
    if (!teamId) return;
    const channel = supabase
      .channel(`messages-${teamId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "team_messages",
          filter: `team_id=eq.${teamId}`,
        },
        () => void client.invalidateQueries({ queryKey: [...KEY, teamId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [client, teamId]);

  return useQuery({
    queryKey: [...KEY, teamId],
    enabled: teamId.length > 0,
    queryFn: async (): Promise<TeamMessage[]> => {
      const { data, error } = await supabase
        .from("team_messages")
        .select("id, author_member, kind, body, event, expense_id, data, created_at")
        .eq("team_id", teamId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      // Du plus ancien au plus récent, pour un affichage de haut en bas.
      return (data ?? [])
        .map((m) => ({
          id: m.id as string,
          authorMember: m.author_member as string | null,
          kind: m.kind as TeamMessage["kind"],
          body: m.body as string,
          event: m.event as string | null,
          expenseId: m.expense_id as string | null,
          data: (m.data ?? {}) as Record<string, unknown>,
          createdAt: m.created_at as string,
        }))
        .reverse();
    },
  });
}

export function useSendMessage(teamId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const { error } = await supabase.rpc("send_message", { p_team: teamId, p_body: body });
      if (error) throw error;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: [...KEY, teamId] }),
  });
}
