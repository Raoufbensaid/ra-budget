import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

interface SessionState {
  session: Session | null;
  /** Vrai tant qu'on ne sait pas encore si une session est enregistrée. */
  loading: boolean;
}

const SessionContext = createContext<SessionState>({ session: null, loading: true });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ session: null, loading: true });
  const queryClient = useQueryClient();
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        lastUserId.current = data.session?.user.id ?? null;
        setState({ session: data.session, loading: false });
      })
      .catch(() => setState({ session: null, loading: false }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      // Déconnexion ou changement de compte : on oublie les données en cache du
      // compte précédent, pour qu'un autre compte sur cet appareil ne les voie jamais.
      const userId = session?.user.id ?? null;
      if (userId !== lastUserId.current) queryClient.clear();
      lastUserId.current = userId;
      setState({ session, loading: false });
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
