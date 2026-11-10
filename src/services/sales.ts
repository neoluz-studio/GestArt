import type { SupabaseClient } from "@supabase/supabase-js";

export type DiscountType = "percent" | "amount";

export type SaleLineInput = {
  product_id: string;
  quantity: number;
  discount_type: DiscountType;
  discount_value: number;
};

export type SaleItem = {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
};

export type SaleRecord = {
  id: string;
  sale_number: number;
  sold_at: string;
  status: "completed" | "cancelled";
  payment_method_name: string | null;
  subtotal: number;
  discount_total: number;
  total: number;
  cost_total: number;
  profit: number;
  notes: string | null;
  cancel_reason: string | null;
  items: SaleItem[];
};

const num = (value: unknown) => Number(value ?? 0);

/** Calcula el total de una línea igual que lo hace la base de datos. */
export function lineAmounts(
  unitPrice: number,
  quantity: number,
  discountType: DiscountType,
  discountValue: number
) {
  const subtotal = Math.round(unitPrice * quantity * 100) / 100;
  const value = Math.max(discountValue || 0, 0);
  const discount =
    discountType === "percent"
      ? Math.round(subtotal * Math.min(value, 100)) / 100
      : Math.min(value, subtotal);
  return { subtotal, discount, total: subtotal - discount };
}

export function cartDiscountAmount(
  afterItems: number,
  type: DiscountType,
  value: number
) {
  const safe = Math.max(value || 0, 0);
  return type === "amount"
    ? Math.min(safe, afterItems)
    : Math.round(afterItems * Math.min(safe, 100)) / 100;
}

export async function createSale(
  supabase: SupabaseClient,
  companyId: string,
  input: {
    items: SaleLineInput[];
    paymentMethodId: string;
    cartDiscountType: DiscountType;
    cartDiscountValue: number;
    notes?: string;
  }
): Promise<string> {
  const { data, error } = await supabase.rpc("create_sale", {
    p_company_id: companyId,
    p_items: input.items,
    p_payment_method_id: input.paymentMethodId,
    p_cart_discount_type: input.cartDiscountType,
    p_cart_discount_value: input.cartDiscountValue,
    p_client_id: null,
    p_notes: input.notes?.trim() || null
  });
  if (error) throw error;
  return String(data);
}

export async function cancelSale(
  supabase: SupabaseClient,
  companyId: string,
  saleId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase.rpc("cancel_sale", {
    p_company_id: companyId,
    p_sale_id: saleId,
    p_reason: reason
  });
  if (error) throw error;
}

/**
 * Lista ventas entre dos fechas (YYYY-MM-DD, inclusive).
 * Los límites se interpretan en la zona horaria del navegador.
 */
export async function listSales(
  supabase: SupabaseClient,
  companyId: string,
  range: { from: string; to: string }
): Promise<SaleRecord[]> {
  const start = new Date(`${range.from}T00:00:00`);
  const end = new Date(`${range.to}T00:00:00`);
  end.setDate(end.getDate() + 1);

  const { data, error } = await supabase
    .from("sales")
    .select(
      "id,sale_number,sold_at,status,subtotal,discount_total,total,cost_total,profit,notes,cancel_reason,payment_methods(name),sale_items(id,name,quantity,unit_price,discount,total)"
    )
    .eq("company_id", companyId)
    .gte("sold_at", start.toISOString())
    .lt("sold_at", end.toISOString())
    .order("sold_at", { ascending: false })
    .limit(1000);

  if (error) throw error;

  return (data ?? []).map((row) => {
    const r = row as unknown as Record<string, unknown> & {
      payment_methods: { name: string } | null;
      sale_items: Record<string, unknown>[] | null;
    };
    return {
      id: String(r.id),
      sale_number: num(r.sale_number),
      sold_at: String(r.sold_at),
      status: r.status as SaleRecord["status"],
      payment_method_name: r.payment_methods?.name ?? null,
      subtotal: num(r.subtotal),
      discount_total: num(r.discount_total),
      total: num(r.total),
      cost_total: num(r.cost_total),
      profit: num(r.profit),
      notes: (r.notes as string | null) ?? null,
      cancel_reason: (r.cancel_reason as string | null) ?? null,
      items: (r.sale_items ?? []).map((item) => ({
        id: String(item.id),
        name: String(item.name),
        quantity: num(item.quantity),
        unit_price: num(item.unit_price),
        discount: num(item.discount),
        total: num(item.total)
      }))
    };
  });
}
