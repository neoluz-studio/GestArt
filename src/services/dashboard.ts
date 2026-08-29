import type { SupabaseClient } from "@supabase/supabase-js";

export type DashboardOverview = {
  active_orders: number;
  in_production: number;
  ready_orders: number;
  income_today: number;
  receivable: number;
  low_stock: number;
  client_count: number;
  open_quotes: number;
};

export type RecentOrder = {
  id: string;
  order_number: number;
  status: string;
  total: number;
  delivery_date: string | null;
  created_at: string;
  clients: { name: string } | null;
};

export type RecentActivity = {
  id: number;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  description: string | null;
  created_at: string;
};

export type DailySale = { date: string; total: number; count: number };

export type DashboardData = {
  overview: DashboardOverview;
  recentOrders: RecentOrder[];
  activity: RecentActivity[];
  dailySales: DailySale[];
};

const EMPTY: DashboardOverview = {
  active_orders: 0,
  in_production: 0,
  ready_orders: 0,
  income_today: 0,
  receivable: 0,
  low_stock: 0,
  client_count: 0,
  open_quotes: 0
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function getDashboardData(
  supabase: SupabaseClient,
  companyId: string
): Promise<DashboardData> {
  const from = new Date();
  from.setDate(from.getDate() - 6);
  const fromDate = isoDate(from);

  const [overviewResult, ordersResult, activityResult, salesResult] =
    await Promise.all([
      supabase.rpc("get_dashboard_overview", { p_company_id: companyId }),
      supabase
        .from("orders")
        .select("id,order_number,status,total,delivery_date,created_at,clients(name)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("activity_logs")
        .select("id,action,entity_type,entity_id,description,created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(7),
      supabase
        .from("orders")
        .select("order_date,total,status")
        .eq("company_id", companyId)
        .gte("order_date", fromDate)
        .order("order_date", { ascending: true })
    ]);

  if (overviewResult.error) throw overviewResult.error;
  if (ordersResult.error) throw ordersResult.error;
  if (activityResult.error) throw activityResult.error;
  if (salesResult.error) throw salesResult.error;

  const rawOverview = overviewResult.data?.[0] ?? EMPTY;
  const overview: DashboardOverview = {
    active_orders: Number(rawOverview.active_orders ?? 0),
    in_production: Number(rawOverview.in_production ?? 0),
    ready_orders: Number(rawOverview.ready_orders ?? 0),
    income_today: Number(rawOverview.income_today ?? 0),
    receivable: Number(rawOverview.receivable ?? 0),
    low_stock: Number(rawOverview.low_stock ?? 0),
    client_count: Number(rawOverview.client_count ?? 0),
    open_quotes: Number(rawOverview.open_quotes ?? 0)
  };

  const buckets = new Map<string, DailySale>();
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(from);
    date.setDate(from.getDate() + i);
    const key = isoDate(date);
    buckets.set(key, { date: key, total: 0, count: 0 });
  }

  for (const row of salesResult.data ?? []) {
    const status = String(row.status ?? "").toLowerCase();
    if (["cancelled", "canceled", "cancelado"].includes(status)) continue;
    const bucket = buckets.get(row.order_date);
    if (!bucket) continue;
    bucket.total += Number(row.total ?? 0);
    bucket.count += 1;
  }

  return {
    overview,
    recentOrders: (ordersResult.data ?? []).map((row) => ({
      ...row,
      total: Number(row.total ?? 0),
      clients: Array.isArray(row.clients) ? row.clients[0] ?? null : row.clients
    })) as RecentOrder[],
    activity: (activityResult.data ?? []) as RecentActivity[],
    dailySales: Array.from(buckets.values())
  };
}

export async function saveDashboardOptions(
  supabase: SupabaseClient,
  companyId: string,
  options: Record<string, boolean>
) {
  const { error } = await supabase
    .from("company_settings")
    .update({ dashboard_options: options })
    .eq("company_id", companyId);
  if (error) throw error;
}
