/**
 * Client Supabase. L'URL et la clé « publishable » sont publiques par nature : la
 * sécurité repose sur les règles RLS de la base (chacun ne voit que ses données).
 */
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

/** Faux si le fichier .env n'est pas encore rempli. */
export const supabaseConfigured = Boolean(url && key);

export const supabase = createClient(url ?? "http://localhost:54321", key ?? "non-configure", {
  auth: {
    // Sur le web, le navigateur garde la session (localStorage) ; sur mobile, AsyncStorage.
    storage: Platform.OS === "web" ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Sur mobile, on ne rafraîchit la session que lorsque l'app est au premier plan.
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
