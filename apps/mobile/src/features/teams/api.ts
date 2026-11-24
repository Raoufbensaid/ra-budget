/**
 * Accès aux Teams. Les lectures passent par la RLS ; toutes les modifications
 * passent par des fonctions de la base qui vérifient les droits et laissent
 * une trace dans l'historique.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useSession } from "@/features/auth/session-provider";
import { supabase } from "@/lib/supabase";

export type TeamStatus = "active" | "closing" | "settling" | "settled" | "archived";
export type MemberRole = "owner" | "member" | "guest";
export type MemberStatus = "invited" | "active" | "removed";

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string | null;
  displayName: string;
  email: string | null;
  role: MemberRole;
  status: MemberStatus;
}

export interface PendingInvitation {
  id: string;
  teamId: string;
  email: string;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  icon: string;
  status: TeamStatus;
  createdBy: string;
  createdAt: string;
  members: TeamMember[];
  /** Invitations en attente (visibles par les membres de la Team). */
  invitations: PendingInvitation[];
}

/** Invitation reçue par le compte connecté. */
export interface ReceivedInvitation {
  id: string;
  teamId: string;
  teamName: string;
  teamIcon: string;
}

const TEAMS_KEY = ["teams"] as const;

const SELECT =
  "id, name, icon, status, created_by, created_at, team_members (id, team_id, user_id, display_name, email, role, status), team_invitations (id, team_id, email, created_at, accepted_at, declined_at, cancelled_at)";

interface TeamRow {
  id: string;
  name: string;
  icon: string;
  status: TeamStatus;
  created_by: string;
  created_at: string;
  team_members: {
    id: string;
    team_id: string;
    user_id: string | null;
    display_name: string;
    email: string | null;
    role: MemberRole;
    status: MemberStatus;
  }[];
  team_invitations: {
    id: string;
    team_id: string;
    email: string;
    created_at: string;
    accepted_at: string | null;
    declined_at: string | null;
    cancelled_at: string | null;
  }[];
}

const ROLE_ORDER: Record<MemberRole, number> = { owner: 0, member: 1, guest: 2 };

function toTeam(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    members: (row.team_members ?? [])
      .map((m) => ({
        id: m.id,
        teamId: m.team_id,
        userId: m.user_id,
        displayName: m.display_name,
        email: m.email,
        role: m.role,
        status: m.status,
      }))
      .sort(
        (a, b) =>
          ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.displayName.localeCompare(b.displayName),
      ),
    invitations: (row.team_invitations ?? [])
      .filter((i) => !i.accepted_at && !i.declined_at && !i.cancelled_at)
      .map((i) => ({ id: i.id, teamId: i.team_id, email: i.email, createdAt: i.created_at })),
  };
}

/** Membre correspondant au compte connecté dans une Team. */
export function myMember(team: Team, userId: string | null): TeamMember | undefined {
  return team.members.find((m) => m.userId !== null && m.userId === userId);
}

/** Membres encore présents (actifs ou invités), sans les membres retirés. */
export function visibleMembers(team: Team): TeamMember[] {
  return team.members.filter((m) => m.status !== "removed");
}

/** Rafraîchit les Teams dès qu'une Team ou un membre change (temps réel). */
function useTeamsRealtime(userId: string | null) {
  const client = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const refresh = () => void client.invalidateQueries({ queryKey: TEAMS_KEY });
    const channel = supabase
      // Nom unique : la liste et le détail peuvent être ouverts en même temps.
      .channel(`teams-${userId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_invitations" }, refresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [client, userId]);
}

/** Mes Teams et les invitations reçues en attente. */
export function useTeams() {
  const session = useSession().session;
  const userId = session?.user.id ?? null;
  const email = session?.user.email?.toLowerCase() ?? null;
  useTeamsRealtime(userId);
  return useQuery({
    queryKey: [...TEAMS_KEY, userId],
    enabled: userId !== null,
    queryFn: async (): Promise<{ teams: Team[]; invitations: ReceivedInvitation[] }> => {
      const [teamsRes, invRes] = await Promise.all([
        supabase.from("teams").select(SELECT).order("created_at", { ascending: false }),
        supabase
          .from("team_invitations")
          .select("id, team_id, teams (name, icon)")
          .eq("email", email ?? "")
          .is("accepted_at", null)
          .is("declined_at", null)
          .is("cancelled_at", null),
      ]);
      if (teamsRes.error) throw teamsRes.error;
      if (invRes.error) throw invRes.error;
      const all = ((teamsRes.data ?? []) as TeamRow[]).map(toTeam);
      const invRows = (invRes.data ?? []) as unknown as {
        id: string;
        team_id: string;
        teams: { name: string; icon: string } | null;
      }[];
      return {
        teams: all.filter((t) => myMember(t, userId)?.status === "active"),
        invitations: invRows
          .filter((i) => i.teams !== null)
          .map((i) => ({
            id: i.id,
            teamId: i.team_id,
            teamName: i.teams?.name ?? "",
            teamIcon: i.teams?.icon ?? "👥",
          })),
      };
    },
  });
}

export function useTeam(id: string) {
  const userId = useSession().session?.user.id ?? null;
  useTeamsRealtime(userId);
  return useQuery({
    queryKey: [...TEAMS_KEY, userId, id],
    enabled: userId !== null && id.length > 0,
    queryFn: async (): Promise<Team | null> => {
      const { data, error } = await supabase
        .from("teams")
        .select(SELECT)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toTeam(data as TeamRow) : null;
    },
  });
}

/** Mutation qui appelle une fonction de la base puis rafraîchit les Teams. */
function useTeamRpc<TArgs extends Record<string, unknown>, TResult = void>(fn: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs): Promise<TResult> => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw error;
      return data as TResult;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: TEAMS_KEY }),
  });
}

export const useCreateTeam = () =>
  useTeamRpc<{ p_name: string; p_icon: string }, string>("create_team");
export const useUpdateTeam = () =>
  useTeamRpc<{ p_team: string; p_name: string; p_icon: string }>("update_team");
export const useAddGuest = () =>
  useTeamRpc<{ p_team: string; p_name: string; p_email: string | null }, string>("add_guest");
export const useUpdateGuest = () =>
  useTeamRpc<{ p_member: string; p_name: string; p_email: string | null }>("update_guest");
export const useInviteMember = () =>
  useTeamRpc<{ p_team: string; p_email: string }, string>("invite_member");
export const useRespondInvitation = () =>
  useTeamRpc<{ p_invitation: string; p_accept: boolean }, string | null>("respond_invitation");
export const useCancelInvitation = () => useTeamRpc<{ p_invitation: string }>("cancel_invitation");
export const useRemoveMember = () => useTeamRpc<{ p_member: string }>("remove_member");
export const useLeaveTeam = () => useTeamRpc<{ p_team: string }>("leave_team");
export const useDeleteTeam = () => useTeamRpc<{ p_team: string }>("delete_team");
