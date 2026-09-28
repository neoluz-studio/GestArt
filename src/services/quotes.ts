import type { SupabaseClient } from "@supabase/supabase-js";

export type QuoteStatus =
  | "draft"
  | "sent"
  | "approved"
  | "rejected"
  | "converted"
  | "cancelled"
  | "expired";

export type StoredQuoteStatus =
  | "draft"
  | "sent"
  | "approved"
  | "rejected"
  | "converted"
  | "cancelled";

export type QuoteItemInput = {
  id?: string;
  description: string;
  quantity: number;
  unit_price: number;
};

export type QuoteInput = {
  client_id: string;
  issue_date: string;
  valid_until?: string | null;
  status: Exclude<StoredQuoteStatus, "converted">;
  discount: number;
  notes?: string | null;
  items: QuoteItemInput[];
};

export type QuotePickerSummary = {
  id: string;
  quote_number: number;
  client_id: string;
  status: string;
  issue_date: string;
  total: number;
  converted_order_id: string | null;
};

export type QuoteSummary = {
  id: string;
  quote_number: number;
  client_id: string;
  client_name: string;
  client_company: string | null;
  client_phone: string | null;
  client_email: string | null;
  status: QuoteStatus;
  stored_status: StoredQuoteStatus;
  issue_date: string;
  valid_until: string | null;
  subtotal: number;
  discount: number;
  total: number;
  item_count: number;
  first_item: string | null;
  notes: string | null;
  sent_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  converted_at: string | null;
  converted_order_id: string | null;
  converted_order_number: number | null;
  created_at: string;
  updated_at: string;
};

export type QuoteDetail = {
  quote: QuoteSummary;
  items: Array<{
    id: string;
    description: string;
    quantity: number;
    unit_price: number;
    total: number;
    sort_order: number;
  }>;
};

export type QuoteOverview = {
  total_quotes: number;
  open_quotes: number;
  approved_quotes: number;
  converted_quotes: number;
  quoted_total: number;
};

export type ConversionResult = {
  order_id: string;
  order_number: number;
};

export async function getQuoteOverview(
  supabase: SupabaseClient,
  companyId: string
): Promise<QuoteOverview> {
  const { data, error } = await supabase.rpc("get_quote_overview", {
    p_company_id: companyId
  });
  if (error) throw error;

  const row = data?.[0] ?? {};
  return {
    total_quotes: Number(row.total_quotes ?? 0),
    open_quotes: Number(row.open_quotes ?? 0),
    approved_quotes: Number(row.approved_quotes ?? 0),
    converted_quotes: Number(row.converted_quotes ?? 0),
    quoted_total: Number(row.quoted_total ?? 0)
  };
}

export async function listQuotes(
  supabase: SupabaseClient,
  companyId: string,
  filters: { search?: string; status?: string; days?: string } = {}
): Promise<QuoteSummary[]> {
  const { data, error } = await supabase.rpc("get_quote_summaries", {
    p_company_id: companyId,
    p_search: filters.search?.trim() || null,
    p_status: filters.status || null,
    p_days: filters.days ? Number(filters.days) : null,
    p_quote_id: null
  });
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    quote_number: Number(row.quote_number ?? 0),
    subtotal: Number(row.subtotal ?? 0),
    discount: Number(row.discount ?? 0),
    total: Number(row.total ?? 0),
    item_count: Number(row.item_count ?? 0),
    converted_order_number:
      row.converted_order_number == null ? null : Number(row.converted_order_number)
  })) as QuoteSummary[];
}

export async function loadQuoteDetail(
  supabase: SupabaseClient,
  companyId: string,
  quoteId: string
): Promise<QuoteDetail> {
  const { data: summaryRows, error: summaryError } = await supabase.rpc(
    "get_quote_summaries",
    {
      p_company_id: companyId,
      p_search: null,
      p_status: null,
      p_days: null,
      p_quote_id: quoteId
    }
  );
  if (summaryError) throw summaryError;
  if (!summaryRows?.[0]) throw new Error("No se encontró el presupuesto.");

  const row = summaryRows[0] as Record<string, unknown>;
  const quote: QuoteSummary = {
    ...row,
    quote_number: Number(row.quote_number ?? 0),
    subtotal: Number(row.subtotal ?? 0),
    discount: Number(row.discount ?? 0),
    total: Number(row.total ?? 0),
    item_count: Number(row.item_count ?? 0),
    converted_order_number:
      row.converted_order_number == null ? null : Number(row.converted_order_number)
  } as QuoteSummary;

  const { data: items, error: itemsError } = await supabase
    .from("quote_items")
    .select("id,description,quantity,unit_price,total,sort_order")
    .eq("company_id", companyId)
    .eq("quote_id", quoteId)
    .order("sort_order");

  if (itemsError) throw itemsError;

  return {
    quote,
    items: (items ?? []).map((item) => ({
      ...item,
      quantity: Number(item.quantity ?? 0),
      unit_price: Number(item.unit_price ?? 0),
      total: Number(item.total ?? 0),
      sort_order: Number(item.sort_order ?? 0)
    }))
  };
}

export async function createQuote(
  supabase: SupabaseClient,
  companyId: string,
  input: QuoteInput
): Promise<string> {
  const { data, error } = await supabase.rpc("create_quote", {
    p_company_id: companyId,
    p_client_id: input.client_id,
    p_issue_date: input.issue_date,
    p_valid_until: input.valid_until || null,
    p_status: input.status,
    p_discount: Number(input.discount || 0),
    p_notes: input.notes?.trim() || null,
    p_items: input.items.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price)
    }))
  });

  if (error) throw error;
  return String(data);
}

export async function updateQuote(
  supabase: SupabaseClient,
  companyId: string,
  quoteId: string,
  input: QuoteInput
): Promise<void> {
  const { error } = await supabase.rpc("update_quote", {
    p_company_id: companyId,
    p_quote_id: quoteId,
    p_client_id: input.client_id,
    p_issue_date: input.issue_date,
    p_valid_until: input.valid_until || null,
    p_status: input.status,
    p_discount: Number(input.discount || 0),
    p_notes: input.notes?.trim() || null,
    p_items: input.items.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price)
    }))
  });

  if (error) throw error;
}

export async function changeQuoteStatus(
  supabase: SupabaseClient,
  companyId: string,
  quoteId: string,
  status: Exclude<StoredQuoteStatus, "converted">
): Promise<void> {
  const { error } = await supabase.rpc("change_quote_status", {
    p_company_id: companyId,
    p_quote_id: quoteId,
    p_status: status
  });
  if (error) throw error;
}

export async function duplicateQuote(
  supabase: SupabaseClient,
  companyId: string,
  quoteId: string
): Promise<string> {
  const { data, error } = await supabase.rpc("duplicate_quote", {
    p_company_id: companyId,
    p_quote_id: quoteId
  });
  if (error) throw error;
  return String(data);
}

export async function convertQuoteToOrder(
  supabase: SupabaseClient,
  companyId: string,
  quoteId: string,
  input: {
    delivery_date?: string | null;
    priority?: "urgent" | "high" | "normal" | "low";
    notes?: string | null;
  }
): Promise<ConversionResult> {
  const { data, error } = await supabase.rpc("convert_quote_to_order", {
    p_company_id: companyId,
    p_quote_id: quoteId,
    p_delivery_date: input.delivery_date || null,
    p_priority: input.priority || "normal",
    p_notes: input.notes?.trim() || null
  });
  if (error) throw error;

  const value =
    typeof data === "string"
      ? JSON.parse(data)
      : (data ?? {});

  return {
    order_id: String(value.order_id),
    order_number: Number(value.order_number)
  };
}
export async function listQuotesByClient(
  supabase: SupabaseClient,
  companyId: string,
  clientId: string
): Promise<QuotePickerSummary[]> {

  const { data, error } = await supabase
    .from("quotes")
    .select(`
      id,
      quote_number,
      client_id,
      status,
      issue_date,
      total,
      converted_order_id
    `)
    .eq("company_id", companyId)
    .eq("client_id", clientId)
    .order("issue_date", {
      ascending: false
    });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    quote_number: Number(row.quote_number ?? 0),
    client_id: row.client_id,
    status: row.status,
    issue_date: row.issue_date,
    total: Number(row.total ?? 0),
    converted_order_id: row.converted_order_id ?? null
  } satisfies QuotePickerSummary));
}