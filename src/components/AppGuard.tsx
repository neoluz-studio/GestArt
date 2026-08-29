"use client";

import { useEffect } from "react";
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
      </div>
    );
  }

  if (!user || !hasCompanies) return null;

  return <>{children}</>;
}
