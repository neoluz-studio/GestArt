"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { demoMode } from "@/lib/runtime";
import { brand } from "@/lib/brand";

export function AppGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const { loading: tenantLoading, hasCompanies } = useTenant();

  const [slow, setSlow] = useState(false);
  const stillLoading = !demoMode && (authLoading || tenantLoading);

  // Si la carga se estira más de 10 segundos, mostramos qué está esperando
  // y una salida (reintentar / limpiar la sesión guardada en el navegador).
  useEffect(() => {
    if (!stillLoading) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setSlow(true);
      console.warn(
        "GestArt: la carga está tardando. authLoading=%s tenantLoading=%s",
        authLoading,
        tenantLoading
      );
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [stillLoading, authLoading, tenantLoading]);

  const resetLocalSession = () => {
    try {
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith("sb-") || key.includes("supabase"))
        .forEach((key) => window.localStorage.removeItem(key));
      window.sessionStorage.removeItem("gestart_company_id");
    } catch {
      // ignorar: el navegador puede bloquear el acceso al almacenamiento
    }
    window.location.href = "/login";
  };

  useEffect(() => {
    if (demoMode || authLoading || tenantLoading) return;

    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    if (!hasCompanies) {
      router.replace("/onboarding");
    }
  }, [
    user,
    authLoading,
    tenantLoading,
    hasCompanies,
    pathname,
    router
  ]);

  if (demoMode) return <>{children}</>;

  if (authLoading || tenantLoading) {
    return (
      <div className="screen-loader">
        <div className="loader-mark">
          <span />
          <span />
          <span />
        </div>
        <strong>Cargando {brand.name}...</strong>
        {slow && (
          <div style={{ maxWidth: 360, textAlign: "center", display: "grid", gap: 10, marginTop: 14 }}>
            <span style={{ fontSize: 12, opacity: 0.8 }}>
              Está tardando más de lo normal. Esperando:{" "}
              <b>{authLoading ? "la sesión de usuario" : "los datos de la empresa"}</b>.
            </span>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <button className="button button-dark" type="button" onClick={() => window.location.reload()}>
                Reintentar
              </button>
              <button className="button modal-secondary" type="button" onClick={resetLocalSession}>
                Limpiar sesión y volver a entrar
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!user || !hasCompanies) return null;

  return <>{children}</>;
}
