import type { SupabaseClient } from "@supabase/supabase-js";

export type MaterialSummary = {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  unit: string;
  current_stock: number;
  minimum_stock: number;
  unit_cost: number;
  inventory_value: number;
  location: string | null;
  notes: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  is_active: boolean;
  stock_status: "low" | "ok";
  updated_at: string;
};

export type MaterialInput = {
  code?: string;
  name: string;
  category?: string;
  unit: string;
  minimum_stock: number;
  unit_cost: number;
  location?: string;
  notes?: string;
  supplier_id?: string | null;
};

export type StockMovement = {
  id: string;
  movement_type: "in" | "out" | "adjustment";
  quantity: number;
  reason: string;
  unit_cost: number | null;
  balance_after: number | null;
  notes: string | null;
  order_id: string | null;
  order_number: number | null;
  supplier_id: string | null;
  supplier_name: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};

export type StockMovementInput = {
  movement_type: "in" | "out" | "adjustment";
  quantity: number;
  reason: string;
  unit_cost?: number | null;
  order_id?: string | null;
  supplier_id?: string | null;
  notes?: string | null;
  register_cash_expense?: boolean;
  payment_method_id?: string | null;
};

export type SupplierLookup = {
  id: string;
  name: string;
};

export type OrderLookup = {
  id: string;
  order_number: number;
  client_name: string;
  status: string;
};

export type InventoryOverview = {
  material_count: number;
  low_stock_count: number;
  inventory_value: number;
  movements_today: number;
};

export async function getInventoryOverview(
  supabase: SupabaseClient,
  companyId: string
): Promise<InventoryOverview> {
  const { data, error } = await supabase.rpc("get_inventory_overview", {
    p_company_id: companyId
  });
  if (error) throw error;
  const row = data?.[0] ?? {};
  return {
    material_count: Number(row.material_count ?? 0),
    low_stock_count: Number(row.low_stock_count ?? 0),
    inventory_value: Number(row.inventory_value ?? 0),
    movements_today: Number(row.movements_today ?? 0)
  };
}

export async function listMaterials(
  supabase: SupabaseClient,
  companyId: string,
  filters: { search?: string; category?: string; stock?: string } = {}
): Promise<MaterialSummary[]> {
  const { data, error } = await supabase.rpc("get_inventory_materials", {
    p_company_id: companyId,
    p_search: filters.search?.trim() || null,
    p_category: filters.category?.trim() || null,
    p_stock_status: filters.stock?.trim() || null
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    current_stock: Number(row.current_stock ?? 0),
    minimum_stock: Number(row.minimum_stock ?? 0),
    unit_cost: Number(row.unit_cost ?? 0),
    inventory_value: Number(row.inventory_value ?? 0),
    is_active: Boolean(row.is_active)
  })) as MaterialSummary[];
}

export async function listMaterialMovements(
  supabase: SupabaseClient,
  companyId: string,
  materialId: string
): Promise<StockMovement[]> {
  const { data, error } = await supabase.rpc("get_material_movements", {
    p_company_id: companyId,
    p_material_id: materialId
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    quantity: Number(row.quantity ?? 0),
    unit_cost: row.unit_cost == null ? null : Number(row.unit_cost),
    balance_after: row.balance_after == null ? null : Number(row.balance_after),
    order_number: row.order_number == null ? null : Number(row.order_number)
  })) as StockMovement[];
}

export async function createMaterial(
  supabase: SupabaseClient,
  companyId: string,
  input: MaterialInput
) {
  const { data, error } = await supabase
    .from("materials")
    .insert({
      company_id: companyId,
      code: input.code?.trim() || null,
      name: input.name.trim(),
      category: input.category?.trim() || null,
      unit: input.unit.trim(),
      current_stock: 0,
      minimum_stock: input.minimum_stock,
      unit_cost: input.unit_cost,
      supplier_id: input.supplier_id || null,
      location: input.location?.trim() || null,
      notes: input.notes?.trim() || null,
      is_active: true
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function updateMaterial(
  supabase: SupabaseClient,
  companyId: string,
  materialId: string,
  input: MaterialInput
) {
  const { error } = await supabase
    .from("materials")
    .update({
      code: input.code?.trim() || null,
      name: input.name.trim(),
      category: input.category?.trim() || null,
      unit: input.unit.trim(),
      minimum_stock: input.minimum_stock,
      unit_cost: input.unit_cost,
      supplier_id: input.supplier_id || null,
      location: input.location?.trim() || null,
      notes: input.notes?.trim() || null
    })
    .eq("company_id", companyId)
    .eq("id", materialId);
  if (error) throw error;
}

export async function archiveMaterial(
  supabase: SupabaseClient,
  companyId: string,
  materialId: string
) {
  const { error } = await supabase
    .from("materials")
    .update({ is_active: false })
    .eq("company_id", companyId)
    .eq("id", materialId);
  if (error) throw error;
}

export async function restoreMaterial(
  supabase: SupabaseClient,
  companyId: string,
  materialId: string
) {
  const { error } = await supabase
    .from("materials")
    .update({ is_active: true })
    .eq("company_id", companyId)
    .eq("id", materialId);
  if (error) throw error;
}

export async function recordStockMovement(
  supabase: SupabaseClient,
  companyId: string,
  materialId: string,
  input: StockMovementInput
) {
  const rpcName =
    input.movement_type === "in" && input.register_cash_expense
      ? "record_inventory_purchase"
      : "record_stock_movement";

  const payload =
    rpcName === "record_inventory_purchase"
      ? {
          p_company_id: companyId,
          p_material_id: materialId,
          p_quantity: input.quantity,
          p_reason: input.reason.trim(),
          p_unit_cost: input.unit_cost ?? null,
          p_payment_method_id: input.payment_method_id || null,
          p_supplier_id: input.supplier_id || null,
          p_notes: input.notes?.trim() || null
        }
      : {
          p_company_id: companyId,
          p_material_id: materialId,
          p_movement_type: input.movement_type,
          p_quantity: input.quantity,
          p_reason: input.reason.trim(),
          p_unit_cost: input.unit_cost ?? null,
          p_order_id: input.order_id || null,
          p_supplier_id: input.supplier_id || null,
          p_notes: input.notes?.trim() || null
        };

  const { data, error } = await supabase.rpc(rpcName, payload);
  if (error) throw error;
  return data as string;
}

export async function listSuppliers(
  supabase: SupabaseClient,
  companyId: string
): Promise<SupplierLookup[]> {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id,name")
    .eq("company_id", companyId)
    .order("name");
  if (error) throw error;
  return (data ?? []) as SupplierLookup[];
}

export async function createSupplier(
  supabase: SupabaseClient,
  companyId: string,
  name: string
): Promise<SupplierLookup> {
  const { data, error } = await supabase
    .from("suppliers")
    .insert({ company_id: companyId, name: name.trim() })
    .select("id,name")
    .single();
  if (error) throw error;
  return data as SupplierLookup;
}

export async function listInventoryOrders(
  supabase: SupabaseClient,
  companyId: string
): Promise<OrderLookup[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("id,order_number,status,clients(name)")
    .eq("company_id", companyId)
    .not("status", "in", '("cancelled","delivered")')
    .order("order_number", { ascending: false })
    .limit(100);
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => {
    const rawClient = row.clients;
    const client = Array.isArray(rawClient) ? rawClient[0] : rawClient;
    return {
      id: String(row.id),
      order_number: Number(row.order_number ?? 0),
      status: String(row.status ?? ""),
      client_name:
        client && typeof client === "object" && "name" in client
          ? String((client as { name?: unknown }).name ?? "")
          : ""
    };
  });
}
