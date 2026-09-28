import type { SupabaseClient } from "@supabase/supabase-js";

export type CashOverview = {
  current_balance: number;
  income_today: number;
  expense_today: number;
  period_expected: number;
  last_closed_at: string | null;
  last_difference: number;
};

export type CashMethodBalance = {
  payment_method_id: string | null;
  code: string | null;
  name: string;
  balance: number;
  income: number;
  expense: number;
};

export type CashMovement = {
  id: string;
  movement_type: "income" | "expense";
  category: string | null;
  concept: string;
  amount: number;
  payment_method_id: string | null;
  payment_method_name: string | null;
  order_id: string | null;
  order_number: number | null;
  supplier_id: string | null;
  client_id: string | null;
client_name: string | null;

quote_id: string | null;
quote_number: number | null;
  supplier_name: string | null;
  notes: string | null;
  reference: string | null;
  occurred_at: string;
  created_by: string | null;
  created_by_name: string | null;
  source: string;
  reversal_of_id: string | null;
  reversed_by_id: string | null;
};

export type PaymentMethod = {
  id: string;
  code: string;
  name: string;
};

export type CashClosure = {
  id: string;
  opened_at: string;
  closed_at: string;
  opening_balance: number;
  income_total: number;
  expense_total: number;
  expected_balance: number;
  actual_balance: number;
  difference: number;
  notes: string | null;
  closed_by_name: string | null;
};

export type ManualCashMovementInput = {

  movement_type: "income" | "expense";

  concept: string;

  category?: string | null;

  amount: number;

  payment_method_id: string;

  client_id?: string | null;

  quote_id?: string | null;

  order_id?: string | null;

  supplier_id?: string | null;

  notes?: string | null;

  reference?: string | null;

  occurred_at?: string | null;

};

export async function getCashOverview(
  supabase: SupabaseClient,
  companyId: string
): Promise<CashOverview> {
  const { data, error } = await supabase.rpc("get_cash_overview", {
    p_company_id: companyId
  });
  if (error) throw error;
  const row = data?.[0] ?? {};
  return {
    current_balance: Number(row.current_balance ?? 0),
    income_today: Number(row.income_today ?? 0),
    expense_today: Number(row.expense_today ?? 0),
    period_expected: Number(row.period_expected ?? 0),
    last_closed_at: row.last_closed_at ?? null,
    last_difference: Number(row.last_difference ?? 0)
  };
}

export async function getCashMethodBalances(
  supabase: SupabaseClient,
  companyId: string
): Promise<CashMethodBalance[]> {
  const { data, error } = await supabase.rpc("get_cash_method_balances", {
    p_company_id: companyId
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    payment_method_id: row.payment_method_id == null ? null : String(row.payment_method_id),
    code: row.code == null ? null : String(row.code),
    name: String(row.name ?? "Sin método"),
    balance: Number(row.balance ?? 0),
    income: Number(row.income ?? 0),
    expense: Number(row.expense ?? 0)
  }));
}

export async function listCashMovements(
  supabase: SupabaseClient,
  companyId: string,
  filters: {
    search?: string;
    type?: string;
    paymentMethodId?: string;
    fromDate?: string;
    toDate?: string;
  } = {}
): Promise<CashMovement[]> {
  const { data, error } = await supabase.rpc("get_cash_movements", {
    p_company_id: companyId,
    p_search: filters.search?.trim() || null,
    p_type: filters.type?.trim() || null,
    p_payment_method_id: filters.paymentMethodId || null,
    p_from_date: filters.fromDate || null,
    p_to_date: filters.toDate || null
  });
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
  ...row,

  amount: Number(row.amount ?? 0),

  order_number:
    row.order_number == null
      ? null
      : Number(row.order_number),

  quote_number:
    row.quote_number == null
      ? null
      : Number(row.quote_number),

  source: String(row.source ?? "manual")

})) as CashMovement[];
}

export async function listPaymentMethods(
  supabase: SupabaseClient,
  companyId: string
): Promise<PaymentMethod[]> {
  const { data, error } = await supabase
    .from("payment_methods")
    .select("id,code,name")
    .eq("company_id", companyId)
    .eq("enabled", true)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as PaymentMethod[];
}

export async function createManualCashMovement(
  supabase: SupabaseClient,
  companyId: string,
  input: ManualCashMovementInput
): Promise<string> {

 const { data, error } = await supabase.rpc(
  "record_manual_cash_movement",
  {
    p_company_id: companyId,

    p_movement_type: input.movement_type,

    p_concept: input.concept.trim(),

    p_category: input.category?.trim() || null,

    p_amount: input.amount,

    p_payment_method_id: input.payment_method_id,


    p_client_id: input.client_id || null,

    p_quote_id: input.quote_id || null,

    p_supplier_id: input.supplier_id || null,

    p_notes: input.notes?.trim() || null,

    p_reference: input.reference?.trim() || null,

    p_occurred_at: input.occurred_at
      ? new Date(input.occurred_at).toISOString()
      : null
  }
);

  if (error) throw error;

  return data as string;
}
export async function reverseCashMovement(
  supabase: SupabaseClient,
  companyId: string,
  movementId: string,
  reason: string
): Promise<string> {
  const { data, error } = await supabase.rpc("reverse_cash_movement", {
    p_company_id: companyId,
    p_movement_id: movementId,
    p_reason: reason.trim()
  });
  if (error) throw error;
  return data as string;
}

export async function previewCashClosure(
  supabase: SupabaseClient,
  companyId: string
) {
  const { data, error } = await supabase.rpc("preview_cash_closure", {
    p_company_id: companyId
  });
  if (error) throw error;
  const row = data?.[0] ?? {};
  return {
    opened_at: String(row.opened_at ?? new Date().toISOString()),
    opening_balance: Number(row.opening_balance ?? 0),
    income_total: Number(row.income_total ?? 0),
    expense_total: Number(row.expense_total ?? 0),
    expected_balance: Number(row.expected_balance ?? 0)
  };
}

export async function closeCash(
  supabase: SupabaseClient,
  companyId: string,
  actualBalance: number,
  notes?: string | null
): Promise<string> {
  const { data, error } = await supabase.rpc("close_cash_register", {
    p_company_id: companyId,
    p_actual_balance: actualBalance,
    p_notes: notes?.trim() || null
  });
  if (error) throw error;
  return data as string;
}

export async function listCashClosures(
  supabase: SupabaseClient,
  companyId: string
): Promise<CashClosure[]> {
  const { data, error } = await supabase.rpc("get_cash_closures", {
    p_company_id: companyId
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    opening_balance: Number(row.opening_balance ?? 0),
    income_total: Number(row.income_total ?? 0),
    expense_total: Number(row.expense_total ?? 0),
    expected_balance: Number(row.expected_balance ?? 0),
    actual_balance: Number(row.actual_balance ?? 0),
    difference: Number(row.difference ?? 0)
  })) as CashClosure[];
}
export async function deleteCashMovement(
  supabase: SupabaseClient,
  companyId: string,
  movementId: string
): Promise<void> {

  const { error } = await supabase.rpc(
    "delete_cash_movement_safe",
    {
      p_company_id: companyId,
      p_movement_id: movementId
    }
  );

  if (error) throw error;
}