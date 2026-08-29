import type { SupabaseClient } from "@supabase/supabase-js";

export type ReportOverview = {
  sales_total: number;
  collections_total: number;
  outstanding_total: number;
  orders_count: number;
  average_ticket: number;
  active_clients: number;
  cash_income: number;
  cash_expense: number;
  cash_net: number;
  completed_jobs: number;
  average_production_hours: number;
  inventory_value: number;
  low_stock_count: number;
};

export type ReportSeriesPoint = {
  period_date: string;
  sales: number;
  collections: number;
  cash_income: number;
  cash_expense: number;
  orders_count: number;
};

export type TopClientReport = {
  client_id: string;
  client_name: string;
  company_name: string | null;
  orders_count: number;
  sales_total: number;
  paid_total: number;
  outstanding_total: number;
};

export type OrderStatusReport = {
  status: string;
  orders_count: number;
  sales_total: number;
};

export type PaymentMethodReport = {
  payment_method_id: string;
  code: string;
  name: string;
  payments_count: number;
  amount: number;
  share_pct: number;
};

export type ProductionStageReport = {
  status: string;
  jobs_count: number;
  overdue_count: number;
  completed_count: number;
  average_hours: number;
};

export type InventoryReport = {
  material_id: string;
  code: string | null;
  name: string;
  category: string | null;
  unit: string;
  current_stock: number;
  minimum_stock: number;
  unit_cost: number;
  inventory_value: number;
  consumed_quantity: number;
  consumed_value: number;
  low_stock: boolean;
};

export type ReportBundle = {
  overview: ReportOverview;
  series: ReportSeriesPoint[];
  topClients: TopClientReport[];
  orderStatuses: OrderStatusReport[];
  paymentMethods: PaymentMethodReport[];
  production: ProductionStageReport[];
  inventory: InventoryReport[];
};

function numberValue(value: unknown) {
  return Number(value ?? 0);
}

export async function getReportOverview(
  supabase: SupabaseClient,
  companyId: string,
  fromDate: string,
  toDate: string
): Promise<ReportOverview> {
  const { data, error } = await supabase.rpc("get_report_overview", {
    p_company_id: companyId,
    p_from_date: fromDate,
    p_to_date: toDate
  });
  if (error) throw error;
  const row = data?.[0] ?? {};
  return {
    sales_total: numberValue(row.sales_total),
    collections_total: numberValue(row.collections_total),
    outstanding_total: numberValue(row.outstanding_total),
    orders_count: numberValue(row.orders_count),
    average_ticket: numberValue(row.average_ticket),
    active_clients: numberValue(row.active_clients),
    cash_income: numberValue(row.cash_income),
    cash_expense: numberValue(row.cash_expense),
    cash_net: numberValue(row.cash_net),
    completed_jobs: numberValue(row.completed_jobs),
    average_production_hours: numberValue(row.average_production_hours),
    inventory_value: numberValue(row.inventory_value),
    low_stock_count: numberValue(row.low_stock_count)
  };
}

export async function getReportSeries(
  supabase: SupabaseClient,
  companyId: string,
  fromDate: string,
  toDate: string
): Promise<ReportSeriesPoint[]> {
  const { data, error } = await supabase.rpc("get_report_series", {
    p_company_id: companyId,
    p_from_date: fromDate,
    p_to_date: toDate
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    period_date: String(row.period_date),
    sales: numberValue(row.sales),
    collections: numberValue(row.collections),
    cash_income: numberValue(row.cash_income),
    cash_expense: numberValue(row.cash_expense),
    orders_count: numberValue(row.orders_count)
  }));
}

export async function getReportTopClients(
  supabase: SupabaseClient,
  companyId: string,
  fromDate: string,
  toDate: string
): Promise<TopClientReport[]> {
  const { data, error } = await supabase.rpc("get_report_top_clients", {
    p_company_id: companyId,
    p_from_date: fromDate,
    p_to_date: toDate,
    p_limit: 10
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    client_id: String(row.client_id),
    client_name: String(row.client_name ?? "Cliente"),
    company_name: row.company_name == null ? null : String(row.company_name),
    orders_count: numberValue(row.orders_count),
    sales_total: numberValue(row.sales_total),
    paid_total: numberValue(row.paid_total),
    outstanding_total: numberValue(row.outstanding_total)
  }));
}

export async function getReportOrderStatuses(
  supabase: SupabaseClient,
  companyId: string,
  fromDate: string,
  toDate: string
): Promise<OrderStatusReport[]> {
  const { data, error } = await supabase.rpc("get_report_order_statuses", {
    p_company_id: companyId,
    p_from_date: fromDate,
    p_to_date: toDate
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    status: String(row.status ?? "unknown"),
    orders_count: numberValue(row.orders_count),
    sales_total: numberValue(row.sales_total)
  }));
}

export async function getReportPaymentMethods(
  supabase: SupabaseClient,
  companyId: string,
  fromDate: string,
  toDate: string
): Promise<PaymentMethodReport[]> {
  const { data, error } = await supabase.rpc("get_report_payment_methods", {
    p_company_id: companyId,
    p_from_date: fromDate,
    p_to_date: toDate
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    payment_method_id: String(row.payment_method_id),
    code: String(row.code ?? ""),
    name: String(row.name ?? "Método"),
    payments_count: numberValue(row.payments_count),
    amount: numberValue(row.amount),
    share_pct: numberValue(row.share_pct)
  }));
}

export async function getReportProduction(
  supabase: SupabaseClient,
  companyId: string,
  fromDate: string,
  toDate: string
): Promise<ProductionStageReport[]> {
  const { data, error } = await supabase.rpc("get_report_production", {
    p_company_id: companyId,
    p_from_date: fromDate,
    p_to_date: toDate
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    status: String(row.status ?? "pending"),
    jobs_count: numberValue(row.jobs_count),
    overdue_count: numberValue(row.overdue_count),
    completed_count: numberValue(row.completed_count),
    average_hours: numberValue(row.average_hours)
  }));
}

export async function getReportInventory(
  supabase: SupabaseClient,
  companyId: string,
  fromDate: string,
  toDate: string
): Promise<InventoryReport[]> {
  const { data, error } = await supabase.rpc("get_report_inventory", {
    p_company_id: companyId,
    p_from_date: fromDate,
    p_to_date: toDate,
    p_limit: 20
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    material_id: String(row.material_id),
    code: row.code == null ? null : String(row.code),
    name: String(row.name ?? "Material"),
    category: row.category == null ? null : String(row.category),
    unit: String(row.unit ?? ""),
    current_stock: numberValue(row.current_stock),
    minimum_stock: numberValue(row.minimum_stock),
    unit_cost: numberValue(row.unit_cost),
    inventory_value: numberValue(row.inventory_value),
    consumed_quantity: numberValue(row.consumed_quantity),
    consumed_value: numberValue(row.consumed_value),
    low_stock: Boolean(row.low_stock)
  }));
}

export async function getReportBundle(
  supabase: SupabaseClient,
  companyId: string,
  fromDate: string,
  toDate: string
): Promise<ReportBundle> {
  const [
    overview,
    series,
    topClients,
    orderStatuses,
    paymentMethods,
    production,
    inventory
  ] = await Promise.all([
    getReportOverview(supabase, companyId, fromDate, toDate),
    getReportSeries(supabase, companyId, fromDate, toDate),
    getReportTopClients(supabase, companyId, fromDate, toDate),
    getReportOrderStatuses(supabase, companyId, fromDate, toDate),
    getReportPaymentMethods(supabase, companyId, fromDate, toDate),
    getReportProduction(supabase, companyId, fromDate, toDate),
    getReportInventory(supabase, companyId, fromDate, toDate)
  ]);

  return {
    overview,
    series,
    topClients,
    orderStatuses,
    paymentMethods,
    production,
    inventory
  };
}
