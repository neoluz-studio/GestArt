import type { SupabaseClient } from "@supabase/supabase-js";

export type Product = {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  unit: string;
  sale_price: number;
  cost: number;
  stock: number;
  min_stock: number;
  track_stock: boolean;
  is_active: boolean;
  updated_at: string;
};

export type ProductInput = {
  code?: string;
  name: string;
  category?: string;
  unit: string;
  sale_price: number;
  cost: number;
  min_stock: number;
  track_stock: boolean;
  /** Sólo al crear: stock inicial. */
  initial_stock?: number;
};

export type ProductStockMovement = {
  id: string;
  movement_type: "in" | "out" | "adjustment" | "sale" | "return";
  quantity: number;
  balance_after: number;
  reason: string;
  created_at: string;
};

const num = (value: unknown) => Number(value ?? 0);

function mapProduct(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    code: (row.code as string | null) ?? null,
    name: String(row.name),
    category: (row.category as string | null) ?? null,
    unit: String(row.unit ?? "unidad"),
    sale_price: num(row.sale_price),
    cost: num(row.cost),
    stock: num(row.stock),
    min_stock: num(row.min_stock),
    track_stock: Boolean(row.track_stock),
    is_active: Boolean(row.is_active),
    updated_at: String(row.updated_at ?? "")
  };
}

export async function listProducts(
  supabase: SupabaseClient,
  companyId: string,
  options: { includeArchived?: boolean } = {}
): Promise<Product[]> {
  let query = supabase
    .from("products")
    .select("*")
    .eq("company_id", companyId)
    .order("name");

  if (!options.includeArchived) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => mapProduct(row as Record<string, unknown>));
}

export async function createProduct(
  supabase: SupabaseClient,
  companyId: string,
  input: ProductInput
): Promise<void> {
  const { data, error } = await supabase
    .from("products")
    .insert({
      company_id: companyId,
      code: input.code?.trim() || null,
      name: input.name.trim(),
      category: input.category?.trim() || null,
      unit: input.unit,
      sale_price: input.sale_price,
      cost: input.cost,
      min_stock: input.min_stock,
      track_stock: input.track_stock
    })
    .select("id")
    .single();

  if (error) throw friendlyProductError(error);

  const initial = Number(input.initial_stock ?? 0);
  if (input.track_stock && initial > 0 && data?.id) {
    await adjustProductStock(supabase, companyId, data.id, "in", initial, "Stock inicial");
  }
}

export async function updateProduct(
  supabase: SupabaseClient,
  companyId: string,
  productId: string,
  input: ProductInput
): Promise<void> {
  const { error } = await supabase
    .from("products")
    .update({
      code: input.code?.trim() || null,
      name: input.name.trim(),
      category: input.category?.trim() || null,
      unit: input.unit,
      sale_price: input.sale_price,
      cost: input.cost,
      min_stock: input.min_stock,
      track_stock: input.track_stock
    })
    .eq("id", productId)
    .eq("company_id", companyId);

  if (error) throw friendlyProductError(error);
}

export async function setProductActive(
  supabase: SupabaseClient,
  companyId: string,
  productId: string,
  isActive: boolean
): Promise<void> {
  const { error } = await supabase
    .from("products")
    .update({ is_active: isActive })
    .eq("id", productId)
    .eq("company_id", companyId);

  if (error) throw friendlyProductError(error);
}

export async function adjustProductStock(
  supabase: SupabaseClient,
  companyId: string,
  productId: string,
  type: "in" | "out" | "adjustment",
  quantity: number,
  reason: string
): Promise<number> {
  const { data, error } = await supabase.rpc("adjust_product_stock", {
    p_company_id: companyId,
    p_product_id: productId,
    p_movement_type: type,
    p_quantity: quantity,
    p_reason: reason
  });
  if (error) throw error;
  return num(data);
}

export async function listProductMovements(
  supabase: SupabaseClient,
  companyId: string,
  productId: string
): Promise<ProductStockMovement[]> {
  const { data, error } = await supabase
    .from("product_stock_movements")
    .select("id,movement_type,quantity,balance_after,reason,created_at")
    .eq("company_id", companyId)
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: String(row.id),
    movement_type: row.movement_type as ProductStockMovement["movement_type"],
    quantity: num(row.quantity),
    balance_after: num(row.balance_after),
    reason: String(row.reason),
    created_at: String(row.created_at)
  }));
}

function friendlyProductError(error: { message: string; code?: string }) {
  if (error.code === "23505") {
    return new Error("Ya existe un producto con ese nombre o código.");
  }
  return new Error(error.message);
}
