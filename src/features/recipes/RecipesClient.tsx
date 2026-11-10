"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CompactMetric } from "@/components/Metric";
import { Icon } from "@/components/Icon";
import { ModuleGate } from "@/components/ModuleGate";
import { Topbar } from "@/components/Topbar";
import { CompositePanel } from "@/features/recipes/CompositePanel";
import { useTenant } from "@/contexts/TenantContext";
import { demoMode } from "@/lib/runtime";
import { errorMessage, makeMoney, parseNumber } from "@/lib/pos-format";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  RECIPE_UNITS,
  createRecipe,
  deleteRecipe,
  ingredientCost,
  listRecipes,
  recipeTotals,
  unitsCompatible,
  updateRecipe,
  type Ingredient,
  type Recipe,
  type RecipeInput,
  type RecipeUnit
} from "@/services/recipes";

type DraftIngredient = {
  key: string;
  name: string;
  purchase_price: string;
  purchase_quantity: string;
  purchase_unit: RecipeUnit;
  used_quantity: string;
  used_unit: RecipeUnit;
};

type Draft = {
  id: string | null;
  name: string;
  final_quantity: string;
  final_unit: RecipeUnit;
  sale_price: string;
  notes: string;
  ingredients: DraftIngredient[];
};

const newKey = () => Math.random().toString(36).slice(2);

function emptyIngredient(): DraftIngredient {
  return {
    key: newKey(),
    name: "",
    purchase_price: "",
    purchase_quantity: "1",
    purchase_unit: "kg",
    used_quantity: "",
    used_unit: "g"
  };
}

function emptyDraft(): Draft {
  return {
    id: null,
    name: "",
    final_quantity: "1",
    final_unit: "unidad",
    sale_price: "",
    notes: "",
    ingredients: [emptyIngredient()]
  };
}

function toDraft(recipe: Recipe, asCopy = false): Draft {
  return {
    id: asCopy ? null : recipe.id,
    name: asCopy ? `${recipe.name} - copia` : recipe.name,
    final_quantity: String(recipe.final_quantity),
    final_unit: recipe.final_unit,
    sale_price: String(recipe.sale_price),
    notes: recipe.notes ?? "",
    ingredients: recipe.ingredients.map((i) => ({
      key: newKey(),
      name: i.name,
      purchase_price: String(i.purchase_price),
      purchase_quantity: String(i.purchase_quantity),
      purchase_unit: i.purchase_unit,
      used_quantity: String(i.used_quantity),
      used_unit: i.used_unit
    }))
  };
}

function toInput(draft: Draft): RecipeInput {
  return {
    name: draft.name,
    final_quantity: parseNumber(draft.final_quantity),
    final_unit: draft.final_unit,
    sale_price: parseNumber(draft.sale_price),
    notes: draft.notes,
    ingredients: draft.ingredients
      .filter((i) => i.name.trim())
      .map((i) => ({
        name: i.name,
        purchase_price: parseNumber(i.purchase_price),
        purchase_quantity: parseNumber(i.purchase_quantity),
        purchase_unit: i.purchase_unit,
        used_quantity: parseNumber(i.used_quantity),
        used_unit: i.used_unit
      }))
  };
}

const DEMO_RECIPES: Recipe[] = [
  {
    id: "r1",
    name: "Torta de chocolate",
    final_quantity: 12,
    final_unit: "unidad",
    sale_price: 4500,
    notes: null,
    ingredients: [
      { id: "i1", name: "Harina", purchase_price: 1500, purchase_quantity: 1, purchase_unit: "kg", used_quantity: 500, used_unit: "g" },
      { id: "i2", name: "Huevos", purchase_price: 4200, purchase_quantity: 1, purchase_unit: "docena", used_quantity: 6, used_unit: "unidad" },
      { id: "i3", name: "Chocolate", purchase_price: 9000, purchase_quantity: 1, purchase_unit: "kg", used_quantity: 300, used_unit: "g" }
    ]
  }
];

export function RecipesClient() {
  const { currentCompany, settings } = useTenant();
  const money = useMemo(
    () => makeMoney(settings?.locale || "es-AR", settings?.currency || "ARS"),
    [settings?.locale, settings?.currency]
  );

  const [recipes, setRecipes] = useState<Recipe[]>(demoMode ? DEMO_RECIPES : []);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"cost" | "composite">("cost");

  const load = useCallback(async () => {
    if (demoMode || !supabaseBrowser || !currentCompany) return;
    setLoading(true);
    setError("");
    try {
      setRecipes(await listRecipes(supabaseBrowser, currentCompany.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [currentCompany]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return recipes.filter((r) => !term || r.name.toLowerCase().includes(term));
  }, [recipes, search]);

  const draftTotals = useMemo(() => {
    if (!draft) return null;
    const input = toInput(draft);
    return recipeTotals(input);
  }, [draft]);

  const summary = useMemo(() => {
    const margins = recipes.map((r) => recipeTotals(r).margin);
    return {
      count: recipes.length,
      avgMargin: margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0,
      lowMargin: margins.filter((m) => m < 30).length
    };
  }, [recipes]);

  function updateIngredient(key: string, patch: Partial<DraftIngredient>) {
    setDraft((d) =>
      d ? { ...d, ingredients: d.ingredients.map((i) => (i.key === key ? { ...i, ...patch } : i)) } : d
    );
  }

  async function save() {
    if (!draft) return;
    setError("");
    setSuccess("");
    const input = toInput(draft);

    if (!input.name.trim()) return setError("Ingresá el nombre de la receta.");
    if (input.final_quantity <= 0) return setError("La cantidad final debe ser mayor a cero.");
    if (input.ingredients.length === 0) return setError("Agregá al menos un ingrediente.");
    const incompatible = input.ingredients.find(
      (i) => !unitsCompatible(i.purchase_unit, i.used_unit)
    );
    if (incompatible) {
      return setError(
        `En «${incompatible.name}» la unidad de compra y la de uso no son compatibles (no se puede pasar de peso a unidades, por ejemplo).`
      );
    }
    if (input.ingredients.some((i) => i.purchase_quantity <= 0)) {
      return setError("La cantidad comprada de cada ingrediente debe ser mayor a cero.");
    }

    if (demoMode) {
      const recipe: Recipe = {
        id: draft.id ?? `demo-${Date.now()}`,
        name: input.name.trim(),
        final_quantity: input.final_quantity,
        final_unit: input.final_unit,
        sale_price: input.sale_price,
        notes: input.notes?.trim() || null,
        ingredients: input.ingredients.map((i, index): Ingredient => ({ id: `${index}`, ...i }))
      };
      setRecipes((rows) =>
        draft.id ? rows.map((r) => (r.id === draft.id ? recipe : r)) : [recipe, ...rows]
      );
      setDraft(null);
      setSuccess("Modo demo: la receta no se guarda en la base de datos.");
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;
    setSaving(true);
    try {
      if (draft.id) await updateRecipe(supabaseBrowser, currentCompany.id, draft.id, input);
      else await createRecipe(supabaseBrowser, currentCompany.id, input);
      setDraft(null);
      setSuccess("Receta guardada.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(recipe: Recipe) {
    if (!window.confirm(`¿Eliminar la receta «${recipe.name}»?`)) return;
    setError("");
    if (demoMode) {
      setRecipes((rows) => rows.filter((r) => r.id !== recipe.id));
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;
    try {
      await deleteRecipe(supabaseBrowser, currentCompany.id, recipe.id);
      setSuccess("Receta eliminada.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <ModuleGate code="recipes" label="Recetas y costeo">
      <Topbar eyebrow="Comercio" title="Recetas y costeo" />

      <div className="page-content page-stack pos-page">
        <div className="pos-tabs" role="tablist" style={{ width: "fit-content" }}>
          <button type="button" role="tab" aria-selected={tab === "cost"} className={tab === "cost" ? "active" : ""} onClick={() => setTab("cost")}>
            Costeo de recetas
          </button>
          <button type="button" role="tab" aria-selected={tab === "composite"} className={tab === "composite" ? "active" : ""} onClick={() => setTab("composite")}>
            Productos compuestos
          </button>
        </div>

        {tab === "composite" ? (
          <CompositePanel />
        ) : (
          <>
        <section className="module-intro">
          <div className="module-copy">
            <span className="module-kicker">COSTEO</span>
            <h2>
              Sabé cuánto te cuesta, <span>y cuánto ganás.</span>
            </h2>
            <p>
              Cargá los ingredientes o materiales de cada producto y GestArt calcula el costo
              por unidad y tu margen. Sirve para gastronomía, cosmética, gráfica o cualquier
              producto que armes con insumos.
            </p>
          </div>
          <div className="module-actions">
            <button className="button button-dark" type="button" onClick={() => { setDraft(emptyDraft()); setError(""); }}>
              <Icon name="plus" size={14} /> Nueva receta
            </button>
          </div>
        </section>

        {(error || success) && !draft && (
          <div className={`form-message ${error ? "error" : "success"}`}>{error || success}</div>
        )}

        <section className="compact-metrics">
          <CompactMetric icon="database" tone="purple" label="Recetas" value={String(summary.count)} />
          <CompactMetric icon="reports" tone="green" label="Margen promedio" value={`${summary.avgMargin.toFixed(0)}%`} />
          <CompactMetric icon="alert" tone="red" label="Margen menor al 30%" value={String(summary.lowMargin)} />
        </section>

        {!draft && (
          <>
            <section className="filter-bar">
              <label className="filter-search">
                <Icon name="search" size={14} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar receta..." />
              </label>
            </section>

            <section className="content-card">
              {loading ? (
                <p className="muted-small pos-pad">Cargando recetas...</p>
              ) : filtered.length === 0 ? (
                <div className="clients-empty">
                  <span><Icon name="database" size={24} /></span>
                  <strong>Todavía no hay recetas</strong>
                  <p>Creá la primera para conocer el costo real de tus productos.</p>
                </div>
              ) : (
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Receta</th>
                        <th>Rinde</th>
                        <th>Costo total</th>
                        <th>Costo x unidad</th>
                        <th>Precio de venta</th>
                        <th>Margen</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => {
                        const t = recipeTotals(r);
                        return (
                          <tr key={r.id}>
                            <td><strong>{r.name}</strong><small className="pos-sub">{r.ingredients.length} ingredientes</small></td>
                            <td>{r.final_quantity} {r.final_unit}</td>
                            <td className="money">{money(t.totalCost)}</td>
                            <td className="money">{money(t.unitCost)}</td>
                            <td className="money"><strong>{money(r.sale_price)}</strong></td>
                            <td>
                              <span className={`status-pill ${t.margin < 30 ? "status-red" : "status-green"}`}>
                                {t.margin.toFixed(0)}%
                              </span>
                            </td>
                            <td>
                              <div className="row-actions">
                                <button className="button modal-secondary" type="button" onClick={() => { setDraft(toDraft(r)); setError(""); }}>Editar</button>
                                <button className="button modal-secondary" type="button" onClick={() => { setDraft(toDraft(r, true)); setError(""); }}>Duplicar</button>
                                <button className="button modal-secondary" type="button" onClick={() => void remove(r)}>Eliminar</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {draft && draftTotals && (
          <section className="content-card pos-recipe-editor">
            <div className="modal-head">
              <div>
                <span>{draft.id ? "EDITAR RECETA" : "NUEVA RECETA"}</span>
                <h3>{draft.name || "Sin nombre"}</h3>
              </div>
              <button type="button" className="modal-close" onClick={() => setDraft(null)}>×</button>
            </div>

            {error && <div className="form-message error">{error}</div>}

            <div className="client-form-grid">
              <label className="form-field full-field">
                <span>Nombre</span>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
              </label>
              <label className="form-field">
                <span>Cantidad que rinde</span>
                <input inputMode="decimal" value={draft.final_quantity} onChange={(e) => setDraft({ ...draft, final_quantity: e.target.value })} />
              </label>
              <label className="form-field">
                <span>Unidad</span>
                <select value={draft.final_unit} onChange={(e) => setDraft({ ...draft, final_unit: e.target.value as RecipeUnit })}>
                  {RECIPE_UNITS.map((u) => <option value={u} key={u}>{u}</option>)}
                </select>
              </label>
              <label className="form-field">
                <span>Precio de venta (por unidad)</span>
                <input inputMode="decimal" value={draft.sale_price} onChange={(e) => setDraft({ ...draft, sale_price: e.target.value })} />
              </label>
            </div>

            <h4 className="pos-h4">Ingredientes</h4>
            <div className="data-table-wrap">
              <table className="data-table pos-ingredients">
                <thead>
                  <tr>
                    <th>Ingrediente</th>
                    <th>Precio de compra</th>
                    <th>Cantidad comprada</th>
                    <th>Cantidad usada</th>
                    <th>Costo</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {draft.ingredients.map((i) => {
                    const parsed = {
                      name: i.name,
                      purchase_price: parseNumber(i.purchase_price),
                      purchase_quantity: parseNumber(i.purchase_quantity),
                      purchase_unit: i.purchase_unit,
                      used_quantity: parseNumber(i.used_quantity),
                      used_unit: i.used_unit
                    };
                    const incompatible = !unitsCompatible(i.purchase_unit, i.used_unit);
                    return (
                      <tr key={i.key}>
                        <td><input value={i.name} onChange={(e) => updateIngredient(i.key, { name: e.target.value })} placeholder="Harina, tinta, tela..." /></td>
                        <td><input inputMode="decimal" value={i.purchase_price} onChange={(e) => updateIngredient(i.key, { purchase_price: e.target.value })} /></td>
                        <td>
                          <div className="pos-pair">
                            <input inputMode="decimal" value={i.purchase_quantity} onChange={(e) => updateIngredient(i.key, { purchase_quantity: e.target.value })} />
                            <select value={i.purchase_unit} onChange={(e) => updateIngredient(i.key, { purchase_unit: e.target.value as RecipeUnit })}>
                              {RECIPE_UNITS.map((u) => <option value={u} key={u}>{u}</option>)}
                            </select>
                          </div>
                        </td>
                        <td>
                          <div className="pos-pair">
                            <input inputMode="decimal" value={i.used_quantity} onChange={(e) => updateIngredient(i.key, { used_quantity: e.target.value })} />
                            <select value={i.used_unit} onChange={(e) => updateIngredient(i.key, { used_unit: e.target.value as RecipeUnit })}>
                              {RECIPE_UNITS.map((u) => <option value={u} key={u}>{u}</option>)}
                            </select>
                          </div>
                          {incompatible && <small className="pos-warn">Unidades no compatibles</small>}
                        </td>
                        <td className="money"><strong>{money(ingredientCost(parsed))}</strong></td>
                        <td>
                          <button
                            type="button"
                            className="modal-close"
                            aria-label="Quitar ingrediente"
                            onClick={() => setDraft({ ...draft, ingredients: draft.ingredients.filter((x) => x.key !== i.key) })}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              className="button modal-secondary"
              onClick={() => setDraft({ ...draft, ingredients: [...draft.ingredients, emptyIngredient()] })}
            >
              <Icon name="plus" size={14} /> Agregar ingrediente
            </button>

            <div className="pos-recipe-totals">
              <div><span>Costo total</span><strong>{money(draftTotals.totalCost)}</strong></div>
              <div><span>Costo por unidad</span><strong>{money(draftTotals.unitCost)}</strong></div>
              <div><span>Ganancia por unidad</span><strong className={draftTotals.profitPerUnit < 0 ? "pos-negative" : "pos-positive"}>{money(draftTotals.profitPerUnit)}</strong></div>
              <div><span>Margen</span><strong className={draftTotals.margin < 30 ? "pos-negative" : "pos-positive"}>{draftTotals.margin.toFixed(1)}%</strong></div>
            </div>

            <label className="form-field full-field">
              <span>Notas (opcional)</span>
              <input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </label>

            <div className="modal-actions">
              <button type="button" className="button modal-secondary" onClick={() => setDraft(null)}>Cancelar</button>
              <button type="button" className="button button-dark" disabled={saving} onClick={() => void save()}>
                {saving ? "Guardando..." : "Guardar receta"}
              </button>
            </div>
          </section>
        )}
          </>
        )}
      </div>
    </ModuleGate>
  );
}
