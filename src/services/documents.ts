import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantCompany, TenantSettings } from "@/contexts/TenantContext";

export type DocumentClient = {
  id: string;
  name: string;
  company_name: string | null;
  tax_id: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
};

export type PaymentInformation = {
  bank?: string;
  holder?: string;
  cbu?: string;
  alias?: string;
  account?: string;
  notes?: string;
};

export type DocumentSettings = {
  show_logo?: boolean;
  show_tax_id?: boolean;
  show_contact?: boolean;
  show_payment_information?: boolean;
};

export type CompanyDocumentProfile = {
  company_id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  country: string;
  logo_url: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  primary_color: string;
  quote_template: string;
  quote_header: string | null;
  quote_footer: string | null;
  order_footer: string | null;
  terms_and_conditions: string | null;
  payment_information: PaymentInformation | Record<string, unknown> | unknown[] | null;
  document_settings: DocumentSettings;
  payment_methods: string[];
  locale: string;
  currency: string;
};

export function buildCompanyDocumentProfile(
  company: TenantCompany,
  settings: TenantSettings | null
): CompanyDocumentProfile {
  return {
    company_id: company.id,
    name: company.name,
    legal_name: company.legal_name,
    tax_id: company.tax_id,
    country: company.country,
    logo_url: settings?.logo_url ?? null,
    phone: settings?.phone ?? null,
    whatsapp: settings?.whatsapp ?? null,
    email: settings?.email ?? null,
    website: settings?.website ?? null,
    address: settings?.address ?? null,
    city: settings?.city ?? null,
    province: settings?.province ?? null,
    primary_color: settings?.primary_color || "#6d4aff",
    quote_template: settings?.quote_template || "modern",
    quote_header: settings?.quote_header ?? null,
    quote_footer: settings?.quote_footer ?? null,
    order_footer: settings?.order_footer ?? null,
    terms_and_conditions: settings?.terms_and_conditions ?? null,
    payment_information: settings?.payment_information ?? null,
    document_settings: settings?.document_settings ?? {
      show_logo: true,
      show_tax_id: true,
      show_contact: true,
      show_payment_information: true
    },
    payment_methods: [],
    locale: settings?.locale || "es-AR",
    currency: settings?.currency || "ARS"
  };
}

export async function loadDocumentClient(
  supabase: SupabaseClient,
  companyId: string,
  clientId: string
): Promise<DocumentClient> {
  const { data, error } = await supabase
    .from("clients")
    .select("id,name,company_name,tax_id,phone,email,address")
    .eq("company_id", companyId)
    .eq("id", clientId)
    .single();

  if (error) throw error;
  return data as DocumentClient;
}


export async function loadDocumentPaymentMethods(
  supabase: SupabaseClient,
  companyId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("payment_methods")
    .select("name")
    .eq("company_id", companyId)
    .eq("enabled", true)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((row) => String(row.name)).filter(Boolean);
}

export async function uploadCompanyLogo(
  supabase: SupabaseClient,
  companyId: string,
  file: File
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Seleccioná un archivo de imagen válido.");
  }
  if (file.size > 3 * 1024 * 1024) {
    throw new Error("El logo no puede superar los 3 MB.");
  }

  const extension = (file.name.split(".").pop() || "png")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") || "png";
  const path = `${companyId}/logo-${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from("company-assets")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });
  if (error) throw error;

  const { data } = supabase.storage
    .from("company-assets")
    .getPublicUrl(path);

  return data.publicUrl;
}

export async function logDocumentAction(
  supabase: SupabaseClient,
  companyId: string,
  entityType: "quote" | "order" | "report",
  entityId: string,
  action: "pdf" | "print"
): Promise<void> {
  const { error } = await supabase.rpc("log_document_action", {
    p_company_id: companyId,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_action: action
  });
  if (error) {
    // La exportación no debe fallar si sólo falla el registro de auditoría.
    console.warn("No se pudo auditar la exportación:", error.message);
  }
}
