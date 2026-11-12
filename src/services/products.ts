import type { SupabaseClient } from "@supabase/supabase-js";

export type ProductComponent = {
  component_id: string;
  name: string;
  unit: string;
  quantity: number;
  unit_cost: number;
  stock: number;
  track_stock: boolean;
  /** 'portion' = la cantidad está expresada en porciones (vasos) de un envase. */
  measure: "unit" | "portion";
  portions_per_unit: number | null;
  portion_name: string | null;
  portions_used: number;
};

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
  /** false = insumo: no aparece en el punto de venta. */
  is_for_sale: boolean;
  /** true = al venderlo se descuentan sus componentes. */
  is_composite: boolean;
  /** Cuántas porciones (vasos, tragos) rinde cada unidad (botella, caja, barril). */
  portions_per_unit: number | null;
  portion_name: string | null;
  /** Porciones ya servidas del envase que está en uso. */
  portions_used: number;
  components: ProductComponent[];
  /** Unidades que se pueden vender con el stock actual (null = sin límite). */
  available: number | null;
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
  is_for_sale: boolean;
  portions_per_unit?: number | null;
  portion_name?: string;
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
    is_for_sale: row.is_for_sale === undefined ? true : Boolean(row.is_for_sale),
    is_composite: Boolean(row.is_composite),
    portions_per_unit: row.portions_per_unit == null ? null : num(row.portions_per_unit),
    portion_name: (row.portion_name as string | null) ?? null,
    portions_used: num(row.portions_used),
    components: [],
    available: null,
    updated_at: String(row.updated_at ?? "")
  };
}

/** Unidades vendibles de un producto ahora mismo (null = sin límite). */
export function availableOf(product: Product): number | null {
  if (product.is_composite) return product.available;
  return product.track_stock ? product.stock : null;
}

/** Calcula costo y disponibilidad de los productos compuestos a partir de sus componentes. */
export function resolveComposition(
  products: Product[],
  links: {
    product_id: string;
    component_id: string;
    quantity: number;
    measure?: "unit" | "portion";
  }[]
): Product[] {
  const byId = new Map(products.map((p) => [p.id, p]));

  return products.map((product) => {
    if (!product.is_composite) return product;

    const components: ProductComponent[] = links
      .filter((link) => link.product_id === product.id)
      .map((link) => {
        const base = byId.get(link.component_id);
        const portions = base?.portions_per_unit ?? null;
        const measure = link.measure === "portion" && portions ? "portion" : "unit";
        const baseCost = base?.cost ?? 0;
        return {
          component_id: link.component_id,
          name: base?.name ?? "Producto eliminado",
          unit: base?.unit ?? "unidad",
          quantity: link.quantity,
          // costo de cada "unidad de cantidad": por porción o por unidad del producto
          unit_cost: measure === "portion" && portions ? baseCost / portions : baseCost,
          stock: base?.stock ?? 0,
          track_stock: base?.track_stock ?? false,
          measure,
          portions_per_unit: portions,
          portion_name: base?.portion_name ?? null,
          portions_used: base?.portions_used ?? 0
        } as ProductComponent;
      });

    const cost = components.reduce((sum, c) => sum + c.unit_cost * c.quantity, 0);
    const limits = components
      .filter((c) => c.track_stock && c.quantity > 0)
      .map((c) => {
        const remaining =
          c.measure === "portion" && c.portions_per_unit
            ? c.stock * c.portions_per_unit - c.portions_used
            : c.stock;
        return Math.max(0, Math.floor((remaining + 1e-9) / c.quantity));
      });

    return {
      ...product,
      components,
      cost: Math.round(cost * 100) / 100,
      available: limits.length ? Math.min(...limits) : null
    };
  });
}

// ---- Unidades y conversiones para armar composiciones ----

export type UnitOption = { value: string; label: string };

const UNIT_FAMILY: Record<string, string[]> = {
  litro: ["litro", "ml", "cl"],
  ml: ["ml", "litro", "cl"],
  kg: ["kg", "g"],
  g: ["g", "kg"]
};

const TO_BASE: Record<string, number> = { litro: 1000, ml: 1, cl: 10, kg: 1000, g: 1 };

/** Unidades en las que se puede cargar la cantidad de un componente. */
export function unitOptions(component: Product): UnitOption[] {
  const family = UNIT_FAMILY[component.unit] ?? [component.unit];
  const options: UnitOption[] = family.map((unit) => ({
    value: unit,
    label: unit === component.unit ? `${unit} (unidad del producto)` : unit
  }));
  if (component.portions_per_unit) {
    const name = component.portion_name || "porción";
    options.push({
      value: "portion",
      label: `${name} (1 ${component.unit} rinde ${component.portions_per_unit})`
    });
  }
  return options;
}

/** Convierte lo que escribió el usuario a la unidad en la que se lleva el stock. */
export function toComponentQuantity(
  value: number,
  fromUnit: string,
  component: Product
): { quantity: number; measure: "unit" | "portion" } {
  if (fromUnit === "portion") return { quantity: value, measure: "portion" };
  if (fromUnit === component.unit) return { quantity: value, measure: "unit" };
  const from = TO_BASE[fromUnit];
  const to = TO_BASE[component.unit];
  if (!from || !to) return { quantity: value, measure: "unit" };
  return { quantity: Math.round(((value * from) / to) * 1000) / 1000, measure: "unit" };
}

/** Texto legible de un componente: «1 vaso de Fernet», «0,75 litro de Cerveza». */
export function describeComponent(c: ProductComponent, formatQty: (n: number) => string): string {
  if (c.measure === "portion") {
    return `${formatQty(c.quantity)} ${c.portion_name || "porción"} de ${c.name}`;
  }
  return `${formatQty(c.quantity)} ${c.unit} de ${c.name}`;
}

export async function listProducts(
  supabase: SupabaseClient,
  companyId: string,
  options: { includeArchived?: boolean } = {}
): Promise<Product[]> {
  // Se traen todos (también archivados) para poder resolver componentes.
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("company_id", companyId)
    .order("name");
  if (error) throw error;

  const all = (data ?? []).map((row) => mapProduct(row as Record<string, unknown>));

  let links: {
    product_id: string;
    component_id: string;
    quantity: number;
    measure?: "unit" | "portion";
  }[] = [];
  if (all.some((p) => p.is_composite)) {
    const { data: linkRows, error: linkError } = await supabase
      .from("product_components")
      .select("product_id,component_id,quantity,measure")
      .eq("company_id", companyId);
    if (linkError) throw linkError;
    links = (linkRows ?? []).map((row) => ({
      product_id: String(row.product_id),
      component_id: String(row.component_id),
      quantity: num(row.quantity),
      measure: row.measure === "portion" ? "portion" : "unit"
    }));
  }

  const resolved = resolveComposition(all, links);
  return options.includeArchived ? resolved : resolved.filter((p) => p.is_active);
}

/** Define los componentes de un producto (lista vacía = deja de ser compuesto). */
export async function setProductComponents(
  supabase: SupabaseClient,
  companyId: string,
  productId: string,
  components: { component_id: string; quantity: number; measure?: "unit" | "portion" }[]
): Promise<void> {
  const { error } = await supabase.rpc("set_product_components", {
    p_company_id: companyId,
    p_product_id: productId,
    p_components: components
  });
  if (error) throw error;
}

export async function createProduct(
  supabase: SupabaseClient,
  companyId: string,
  input: ProductInput
): Promise<string> {
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
      track_stock: input.track_stock,
      is_for_sale: input.is_for_sale,
      portions_per_unit: input.portions_per_unit || null,
      portion_name: input.portion_name?.trim() || null
    })
    .select("id")
    .single();

  if (error) throw friendlyProductError(error);

  const initial = Number(input.initial_stock ?? 0);
  if (input.track_stock && initial > 0 && data?.id) {
    await adjustProductStock(supabase, companyId, data.id, "in", initial, "Stock inicial");
  }
  return String(data.id);
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
      track_stock: input.track_stock,
      is_for_sale: input.is_for_sale,
      portions_per_unit: input.portions_per_unit || null,
      portion_name: input.portion_name?.trim() || null
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

/** Producto de ejemplo para el modo demo. */
export function demoProduct(
  base: Partial<Product> & Pick<Product, "id" | "name">
): Product {
  return {
    sale_price: 0,
    code: null,
    category: null,
    unit: "unidad",
    cost: 0,
    stock: 0,
    min_stock: 0,
    track_stock: true,
    is_active: true,
    is_for_sale: true,
    is_composite: false,
    portions_per_unit: null,
    portion_name: null,
    portions_used: 0,
    components: [],
    available: null,
    updated_at: new Date().toISOString(),
    ...base
  };
}
