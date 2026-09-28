"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { demoMode } from "@/lib/runtime";
import { supabaseBrowser } from "@/lib/supabase/browser";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  realMode: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children
}: {
  children: React.ReactNode;
}) {

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!demoMode);

  const initialized = useRef(false);


  const refresh = useCallback(async () => {

    if (demoMode || !supabaseBrowser) {
      setSession(null);
      setLoading(false);
      return;
    }

    const {
      data
    } = await supabaseBrowser.auth.getSession();

    setSession(data.session);
    setLoading(false);

  }, []);



  useEffect(() => {

    if (initialized.current) return;

    initialized.current = true;

    void refresh();


    if (demoMode || !supabaseBrowser) {
      return;
    }


    const {
      data: {
        subscription
      }
    } = supabaseBrowser.auth.onAuthStateChange(
      (event, nextSession) => {

        // Supabase dispara este evento cada vez que la pestaña recupera el
        // foco (por ejemplo, al volver de WhatsApp) para refrescar el token
        // en segundo plano. Si seguimos disparando setSession en cada
        // TOKEN_REFRESHED con el mismo usuario, todo el árbol de contexto
        // (TenantContext y las páginas que dependen de currentCompany)
        // vuelve a recargar datos y el usuario pierde lo que estaba
        // escribiendo. Solo actualizamos el estado cuando el usuario
        // realmente cambió (login, logout, cambio de cuenta).
        setSession((current) => {
          const sameUser = current?.user?.id && current.user.id === nextSession?.user?.id;
          if (event === "TOKEN_REFRESHED" && sameUser) {
            return current;
          }
          return nextSession;
        });
        setLoading(false);

      }
    );


    return () => {
      subscription.unsubscribe();
    };


  }, [refresh]);



  const signOut = useCallback(async () => {

    if (supabaseBrowser) {
      await supabaseBrowser.auth.signOut();
    }

    setSession(null);

  }, []);



  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      realMode: !demoMode,
      signOut,
      refresh
    }),
    [
      session,
      loading,
      signOut,
      refresh
    ]
  );


  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );

}



export function useAuth() {

  const value = useContext(AuthContext);

  if (!value) {
    throw new Error(
      "useAuth debe usarse dentro de AuthProvider."
    );
  }

  return value;

}