"use client";

import { AuthProvider } from "@/contexts/AuthContext";
import { TenantProvider } from "@/contexts/TenantContext";
import { AppStateProvider } from "@/contexts/AppStateContext";
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
  <TenantProvider>
    <AppStateProvider>
      {children}
    </AppStateProvider>
  </TenantProvider>
</AuthProvider>
  );
}
