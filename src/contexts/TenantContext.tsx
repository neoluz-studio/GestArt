"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import { demoMode } from "@/lib/runtime";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { company as demoCompany } from "@/lib/demo-data";

export type TenantCompany = {
  id: string;
  name: string;
  legal_name: string | null;
  slug: string;
  tax_id: string | null;
  industry: string | null;
  country: string;
};

export type TenantMembership = {
  company_id: string;
  role_id: string | null;
  status: string;
  companies: TenantCompany | null;
  roles: { id: string; name: string } | null;
};

export type TenantSettings = {
  company_id: string;
  logo_url: string | null;
  sidebar_logo_url: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  theme: string;
  currency: string;
  locale: string;
  timezone: string;
  quote_template?: string | null;
  quote_header?: string | null;
  quote_footer?: string | null;
  order_footer?: string | null;
  terms_and_conditions?: string | null;
  payment_information?: Record<string, unknown> | unknown[] | null;
  document_settings?: {
    show_logo?: boolean;
    show_tax_id?: boolean;
    show_contact?: boolean;
    show_payment_information?: boolean;
  } | null;
  dashboard_options?: Record<string, boolean> | null;
};

export type TenantModule = {
  module_id: string;
  enabled: boolean;
  custom_label: string | null;
  custom_icon: string | null;
  sort_order: number;
  modules: {
    code: string;
    default_label: string;
    default_icon: string | null;
    is_core: boolean;
  } | null;
};

type TenantContextValue = {
  memberships: TenantMembership[];
  currentCompany: TenantCompany | null;
  currentRole: string | null;
  settings: TenantSettings | null;
  modules: TenantModule[];
  loading: boolean;
  hasCompanies: boolean;
  setCurrentCompanyId: (companyId: string) => void;
  reload: () => Promise<void>;
};

const TenantContext = createContext<TenantContextValue | null>(null);
const DEMO_ID = "demo-company";

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [currentCompanyId, setCurrentCompanyIdState] = useState<string | null>(
    demoMode ? DEMO_ID : null
  );
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [modules, setModules] = useState<TenantModule[]>([]);
  const [loading, setLoading] = useState(!demoMode);

  const applyTheme = useCallback((next: TenantSettings | null) => {
    if (typeof document === "undefined" || !next) return;
    document.documentElement.style.setProperty(
      "--primary",
      next.primary_color || "#6d4aff"
    );
    document.documentElement.style.setProperty(
      "--secondary",
      next.secondary_color || "#17151d"
    );
    document.documentElement.style.setProperty(
      "--accent",
      next.accent_color || "#b9ff66"
    );
  }, []);

  const loadCompanyConfiguration = useCallback(
    async (companyId: string) => {
      if (!supabaseBrowser || demoMode) return;

      const [{ data: settingsData }, { data: modulesData }] = await Promise.all([
        supabaseBrowser
          .from("company_settings")
          .select("*")
          .eq("company_id", companyId)
          .maybeSingle(),
        supabaseBrowser
          .from("company_modules")
          .select(
            "module_id,enabled,custom_label,custom_icon,sort_order,modules(code,default_label,default_icon,is_core)"
          )
          .eq("company_id", companyId)
          .order("sort_order")
      ]);

      const nextSettings = (settingsData ?? null) as TenantSettings | null;
      setSettings(nextSettings);
      setModules((modulesData ?? []) as unknown as TenantModule[]);
      applyTheme(nextSettings);
    },
    [applyTheme]
  );

  const reload = useCallback(async () => {
    if (demoMode) {
      setMemberships([]);
      setModules([]);
      setLoading(false);
      return;
    }

    if (!supabaseBrowser || !user) {
      setMemberships([]);
      setCurrentCompanyIdState(null);
      setSettings(null);
      setModules([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const { data, error } = await supabaseBrowser
      .from("company_memberships")
      .select(
        "company_id, role_id, status, companies(id,name,legal_name,slug,tax_id,industry,country), roles(id,name)"
      )
      .eq("user_id", user.id)
      .in("status", ["active", "invited"]);

    if (error) {
      console.error("No se pudieron cargar las empresas:", error.message);
      setMemberships([]);
      setLoading(false);
      return;
    }

    const next = (data ?? []) as unknown as TenantMembership[];
    setMemberships(next);

    const saved =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("gestart_company_id")
        : null;

    const desired =
      next.find((item) => item.company_id === saved)?.company_id ??
      next[0]?.company_id ??
      null;

    setCurrentCompanyIdState(desired);

    if (desired) {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("gestart_company_id", desired);
      }
      await loadCompanyConfiguration(desired);
    } else {
      setSettings(null);
      setModules([]);
    }

    setLoading(false);
  }, [user, loadCompanyConfiguration]);

 useEffect(() => {

  if (!authLoading) {
    void reload();
  }

}, [authLoading, reload]);

  const setCurrentCompanyId = useCallback(
    (companyId: string) => {
      setCurrentCompanyIdState(companyId);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("gestart_company_id", companyId);
      }
      void loadCompanyConfiguration(companyId);
    },
    [loadCompanyConfiguration]
  );

  const currentMembership = memberships.find(
    (item) => item.company_id === currentCompanyId
  );

  const currentCompany: TenantCompany | null = demoMode
    ? {
        id: DEMO_ID,
        name: demoCompany.name,
        legal_name: demoCompany.legalName,
        slug: "grafica-lopez",
        tax_id: demoCompany.taxId,
        industry: "grafica",
        country: "AR"
      }
    : currentMembership?.companies ?? null;

  const value = useMemo(
    () => ({
      memberships,
      currentCompany,
      currentRole: demoMode
        ? "Administrador"
        : currentMembership?.roles?.name ?? null,
      settings,
      modules,
      loading: authLoading || loading,
      hasCompanies: demoMode || memberships.length > 0,
      setCurrentCompanyId,
      reload
    }),
    [
      memberships,
      currentCompany,
      currentMembership,
      settings,
      modules,
      authLoading,
      loading,
      setCurrentCompanyId,
      reload
    ]
  );

  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}

export function useTenant() {
  const value = useContext(TenantContext);
  if (!value) throw new Error("useTenant debe usarse dentro de TenantProvider.");
  return value;
}
