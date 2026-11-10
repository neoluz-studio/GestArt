import type { SupabaseClient } from "@supabase/supabase-js";

export const RECIPE_UNITS = ["unidad", "docena", "kg", "g", "litro", "ml"] as const;
export type RecipeUnit = (typeof RECIPE_UNITS)[number];

export type Ingredient = {
  id: string;
  name: string;
  purchase_price: number;
  purchase_quantity: number;
  purchase_unit: RecipeUnit;
  used_quantity: number;
  used_unit: RecipeUnit;
};

export type Recipe = {
  id: string;
  name: string;
  final_quantity: number;
  final_unit: RecipeUnit;
  sale_price: number;
  notes: string | null;
  ingredients: Ingredient[];
};

export type RecipeInput = {
  name: string;
  final_quantity: number;
  final_unit: RecipeUnit;
  sale_price: number;
  notes?: string;
  ingredients: Omit<Ingredient, "id">[];
};

const num = (value: unknown) => Number(value ?? 0);

// ---- Cálculo de costos (misma lógica que el sistema de Fausti) ----

function kind(unit: RecipeUnit): "peso" | "volumen" | "unidad" {
  if (unit === "kg" || unit === "g") return "peso";
  if (unit === "litro" || unit === "ml") return "volumen";
  return "unidad";
}

function normalize(value: number, unit: RecipeUnit): number {
  switch (unit) {
    case "kg":
    case "litro":
      return value * 1000;
    case "docena":
      return value * 12;
    default:
      return value;
  }
}

export function unitsCompatible(a: RecipeUnit, b: RecipeUnit) {
  return a === b || kind(a) === kind(b);
}

export function ingredientCost(item: Omit<Ingredient, "id">): number {
  if (
    item.purchase_price <= 0 ||
    item.purchase_quantity <= 0 ||
    item.used_quantity <= 0 ||
    !unitsCompatible(item.purchase_unit, item.used_unit)
  ) {
    return 0;
  }
  const bought = normalize(item.purchase_quantity, item.purchase_unit);
  const used = normalize(item.used_quantity, item.used_unit);
  if (bought <= 0 || used <= 0) return 0;
  return (item.purchase_price / bought) * used;
}

export function recipeTotals(recipe: {
  final_quantity: number;
  sale_price: number;
  ingredients: Omit<Ingredient, "id">[];
}) {
  const totalCost = recipe.ingredients.reduce((sum, item) => sum + ingredientCost(item), 0);
  const unitCost = recipe.final_quantity > 0 ? totalCost / recipe.final_quantity : 0;
  const profitPerUnit = recipe.sale_price - unitCost;
  const margin = recipe.sale_price > 0 ? (profitPerUnit / recipe.sale_price) * 100 : 0;
  return { totalCost, unitCost, profitPerUnit, margin };
}

// ---- Persistencia ----

export async function listRecipes(
  supabase: SupabaseClient,
  companyId: string
): Promise<Recipe[]> {
  const { data, error } = await supabase
    .from("recipes")
    .select(
      "id,name,final_quantity,final_unit,sale_price,notes,recipe_ingredients(id,name,purchase_price,purchase_quantity,purchase_unit,used_quantity,used_unit,created_at)"
    )
    .eq("company_id", companyId)
    .order("name");

  if (error) throw error;

  return (data ?? []).map((row) => {
    const r = row as unknown as Record<string, unknown> & {
      recipe_ingredients: Record<string, unknown>[] | null;
    };
    const ingredients = [...(r.recipe_ingredients ?? [])].sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at))
    );
    return {
      id: String(r.id),
      name: String(r.name),
      final_quantity: num(r.final_quantity),
      final_unit: r.final_unit as RecipeUnit,
      sale_price: num(r.sale_price),
      notes: (r.notes as string | null) ?? null,
      ingredients: ingredients.map((i) => ({
        id: String(i.id),
        name: String(i.name),
        purchase_price: num(i.purchase_price),
        purchase_quantity: num(i.purchase_quantity),
        purchase_unit: i.purchase_unit as RecipeUnit,
        used_quantity: num(i.used_quantity),
        used_unit: i.used_unit as RecipeUnit
      }))
    };
  });
}

async function writeIngredients(
  supabase: SupabaseClient,
  companyId: string,
  recipeId: string,
  ingredients: RecipeInput["ingredients"]
) {
  if (ingredients.length === 0) return;
  const { error } = await supabase.from("recipe_ingredients").insert(
    ingredients.map((item) => ({
      company_id: companyId,
      recipe_id: recipeId,
      name: item.name.trim(),
      purchase_price: item.purchase_price,
      purchase_quantity: item.purchase_quantity,
      purchase_unit: item.purchase_unit,
      used_quantity: item.used_quantity,
      used_unit: item.used_unit
    }))
  );
  if (error) throw error;
}

export async function createRecipe(
  supabase: SupabaseClient,
  companyId: string,
  input: RecipeInput
): Promise<string> {
  const { data, error } = await supabase
    .from("recipes")
    .insert({
      company_id: companyId,
      name: input.name.trim(),
      final_quantity: input.final_quantity,
      final_unit: input.final_unit,
      sale_price: input.sale_price,
      notes: input.notes?.trim() || null
    })
    .select("id")
    .single();

  if (error) throw error;
  await writeIngredients(supabase, companyId, data.id, input.ingredients);
  return String(data.id);
}

export async function updateRecipe(
  supabase: SupabaseClient,
  companyId: string,
  recipeId: string,
  input: RecipeInput
): Promise<void> {
  const { error } = await supabase
    .from("recipes")
    .update({
      name: input.name.trim(),
      final_quantity: input.final_quantity,
      final_unit: input.final_unit,
      sale_price: input.sale_price,
      notes: input.notes?.trim() || null
    })
    .eq("id", recipeId)
    .eq("company_id", companyId);
  if (error) throw error;

  const { error: deleteError } = await supabase
    .from("recipe_ingredients")
    .delete()
    .eq("recipe_id", recipeId)
    .eq("company_id", companyId);
  if (deleteError) throw deleteError;

  await writeIngredients(supabase, companyId, recipeId, input.ingredients);
}

export async function deleteRecipe(
  supabase: SupabaseClient,
  companyId: string,
  recipeId: string
): Promise<void> {
  const { error } = await supabase
    .from("recipes")
    .delete()
    .eq("id", recipeId)
    .eq("company_id", companyId);
  if (error) throw error;
}
