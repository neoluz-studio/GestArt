import type { SupabaseClient } from "@supabase/supabase-js";

export type ClientSummary = {
  id: string;
  name: string;
  company_name: string | null;
  tax_id: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  instagram: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  order_count: number;
  quote_count: number;
  total_purchased: number;
  total_paid: number;
  balance: number;
  last_order_date: string | null;
};

export type ClientInput = {
  name: string;
  company_name?: string | null;
  tax_id?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  instagram?: string | null;
  notes?: string | null;
  is_active?: boolean;
};

export type ClientDetail = {
  client: ClientSummary;
  orders: Array<{
    id: string;
    order_number: number;
    status: string;
    total: number;
    order_date: string;
    delivery_date: string | null;
  }>;
  quotes: Array<{
    id: string;
    quote_number: number;
    status: string;
    total: number;
    issue_date: string;
    valid_until: string | null;
  }>;
  payments: Array<{
    id: string;
    amount: number;
    created_at: string;
    order_number: number | null;
    method: string | null;
  }>;
};

export async function listClients(
  supabase: SupabaseClient,
  companyId: string,
  search = ""
): Promise<ClientSummary[]> {
  const { data, error } = await supabase.rpc("get_client_summaries", {
    p_company_id: companyId,
    p_search: search.trim() || null
  });

  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    order_count: Number(row.order_count ?? 0),
    quote_count: Number(row.quote_count ?? 0),
    total_purchased: Number(row.total_purchased ?? 0),
    total_paid: Number(row.total_paid ?? 0),
    balance: Number(row.balance ?? 0)
  })) as ClientSummary[];
}

export async function createClient(
  supabase: SupabaseClient,
  companyId: string,
  userId: string,
  input: ClientInput
) {
  const name = input.name.trim();
  if (!name) throw new Error("El nombre del cliente es obligatorio.");

  const { data, error } = await supabase
    .from("clients")
    .insert({
      company_id: companyId,
      name,
      company_name: input.company_name?.trim() || null,
      tax_id: input.tax_id?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      address: input.address?.trim() || null,
      instagram: input.instagram?.trim() || null,
      notes: input.notes?.trim() || null,
      is_active: input.is_active ?? true,
      created_by: userId,
      updated_by: userId
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function updateClient(
  supabase: SupabaseClient,
  companyId: string,
  clientId: string,
  userId: string,
  input: ClientInput
) {
  const name = input.name.trim();
  if (!name) throw new Error("El nombre del cliente es obligatorio.");

  const { error } = await supabase
    .from("clients")
    .update({
      name,
      company_name: input.company_name?.trim() || null,
      tax_id: input.tax_id?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      address: input.address?.trim() || null,
      instagram: input.instagram?.trim() || null,
      notes: input.notes?.trim() || null,
      is_active: input.is_active ?? true,
      updated_by: userId
    })
    .eq("company_id", companyId)
    .eq("id", clientId);

  if (error) throw error;
}

export async function deleteClient(
  supabase: SupabaseClient,
  companyId: string,
  clientId: string
) {
  const { error } = await supabase.rpc("delete_client_safe", {
    p_company_id: companyId,
    p_client_id: clientId
  });
  if (error) throw error;
}

export async function loadClientDetail(
  supabase: SupabaseClient,
  companyId: string,
  client: ClientSummary
): Promise<ClientDetail> {
  const [{ data: orders, error: ordersError }, { data: quotes, error: quotesError }, { data: payments, error: paymentsError }] =
    await Promise.all([
      supabase
        .from("orders")
        .select("id,order_number,status,total,order_date,delivery_date")
        .eq("company_id", companyId)
        .eq("client_id", client.id)
        .order("order_date", { ascending: false })
        .limit(20),
      supabase
        .from("quotes")
        .select("id,quote_number,status,total,issue_date,valid_until")
        .eq("company_id", companyId)
        .eq("client_id", client.id)
        .order("issue_date", { ascending: false })
        .limit(20),
      supabase
        .from("payments")
        .select("id,amount,created_at,orders!inner(client_id,order_number),payment_methods(name)")
        .eq("company_id", companyId)
        .eq("orders.client_id", client.id)
        .order("created_at", { ascending: false })
        .limit(20)
    ]);

  if (ordersError) throw ordersError;
  if (quotesError) throw quotesError;
  if (paymentsError) throw paymentsError;

  return {
    client,
    orders: (orders ?? []).map((row) => ({ ...row, total: Number(row.total ?? 0) })),
    quotes: (quotes ?? []).map((row) => ({ ...row, total: Number(row.total ?? 0) })),
    payments: (payments ?? []).map((row: any) => ({
      id: row.id,
      amount: Number(row.amount ?? 0),
      created_at: row.created_at,
      order_number: Array.isArray(row.orders) ? row.orders[0]?.order_number ?? null : row.orders?.order_number ?? null,
      method: Array.isArray(row.payment_methods) ? row.payment_methods[0]?.name ?? null : row.payment_methods?.name ?? null
    }))
  };
}
