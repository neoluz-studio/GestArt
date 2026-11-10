"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CompactMetric } from "@/components/Metric";
import { Icon } from "@/components/Icon";
import { useTenant } from "@/contexts/TenantContext";
import { demoMode } from "@/lib/runtime";
import { errorMessage, makeMoney, makeQuantity, parseNumber } from "@/lib/pos-format";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  createProduct,
  demoProduct,
  listProducts,
  resolveComposition,
  setProductComponents,
  type Product
} from "@/services/products";

type DraftComponent = { key: string; component_id: string; quantity: string };

type Draft = {
  mode: "new" | "existing";
  /** producto que se está armando (existente o a crear) */
  productId: string;
  name: string;
  price: string;
  category: string;
  unit: string;
  components: DraftComponent[];
  editing: boolean;
};

const UNITS = ["unidad", "porción", "vaso", "trago", "plato", "pack"];
const newKey = () => Math.random().toString(36).slice(2);

function emptyDraft(): Draft {
  return {
    mode: "new",
    productId: "",
    name: "",
    price: "",
    category: "",
    unit: "unidad",
    components: [{ key: newKey(), component_id: "", quantity: "" }],
    editing: false
  };
}

// ---- Demo: un mini bar ----
function demoCatalog(): Product[] {
  const base = [
    demoProduct({ id: "b1", name: "Cerveza barril", unit: "litro", cost: 2500, stock: 50, is_for_sale: false }),
    demoProduct({ id: "b2", name: "Fernet (botella)", unit: "unidad", cost: 12000, stock: 10, is_for_sale: false }),
    demoProduct({ id: "b3", name: "Gaseosa", unit: "unidad", cost: 800, stock: 20, is_for_sale: false }),
    demoProduct({ id: "b4", name: "Vaso de cerveza", unit: "vaso", sale_price: 3000, track_stock: false, is_composite: true }),
    demoProduct({ id: "b5", name: "Fernet con 5 gaseosas", unit: "unidad", sale_price: 30000, track_stock: false, is_composite: true })
  ];
  return resolveComposition(base, [
    { product_id: "b4", component_id: "b1", quantity: 0.4 },
    { product_id: "b5", component_id: "b2", quantity: 1 },
    { product_id: "b5", component_id: "b3", quantity: 5 }
  ]);
}

export function CompositePanel() {
  const { currentCompany, settings } = useTenant();
  const locale = settings?.locale || "es-AR";
  const money = useMemo(() => makeMoney(locale, settings?.currency || "ARS"), [locale, settings?.currency]);
  const qty = useMemo(() => makeQuantity(locale), [locale]);

  const [products, setProducts] = useState<Product[]>(demoMode ? demoCatalog() : []);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (demoMode || !supabaseBrowser || !currentCompany) return;
    setLoading(true);
    setError("");
    try {
      setProducts(await listProducts(supabaseBrowser, currentCompany.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [currentCompany]);

  useEffect(() => {
    void load();
  }, [load]);

  const composites = useMemo(() => products.filter((p) => p.is_composite), [products]);

  /** Productos que ya se usan como componente (no pueden volverse compuestos). */
  const usedAsComponent = useMemo(
    () => new Set(composites.flatMap((p) => p.components.map((c) => c.component_id))),
    [composites]
  );

  const marginOf = (price: number, cost: number) => (price > 0 ? ((price - cost) / price) * 100 : 0);

  // Candidatos a componente: cualquier producto simple y activo, salvo el que se está armando.
  const componentOptions = useMemo(
    () => products.filter((p) => !p.is_composite && p.id !== draft?.productId),
    [products, draft?.productId]
  );

  // Productos existentes que se pueden convertir en compuestos.
  const convertible = useMemo(
    () => products.filter((p) => !p.is_composite && !usedAsComponent.has(p.id) && p.is_for_sale),
    [products, usedAsComponent]
  );

  const draftCalc = useMemo(() => {
    if (!draft) return null;
    const byId = new Map(products.map((p) => [p.id, p]));
    let cost = 0;
    for (const line of draft.components) {
      const comp = byId.get(line.component_id);
      if (comp) cost += comp.cost * parseNumber(line.quantity);
    }
    const existing = draft.mode === "existing" ? byId.get(draft.productId) : undefined;
    const price = draft.mode === "existing" ? existing?.sale_price ?? 0 : parseNumber(draft.price);
    return { cost, price, profit: price - cost, margin: marginOf(price, cost) };
  }, [draft, products]);

  function openNew() {
    setDraft(emptyDraft());
    setError("");
    setSuccess("");
  }

  function openEdit(product: Product) {
    setDraft({
      mode: "existing",
      productId: product.id,
      name: product.name,
      price: String(product.sale_price),
      category: product.category ?? "",
      unit: product.unit,
      editing: true,
      components: product.components.map((c) => ({
        key: newKey(),
        component_id: c.component_id,
        quantity: String(c.quantity)
      }))
    });
    setError("");
    setSuccess("");
  }

  function updateLine(key: string, patch: Partial<DraftComponent>) {
    setDraft((d) =>
      d ? { ...d, components: d.components.map((c) => (c.key === key ? { ...c, ...patch } : c)) } : d
    );
  }

  async function save() {
    if (!draft) return;
    setError("");
    setSuccess("");

    const lines = draft.components
      .filter((c) => c.component_id)
      .map((c) => ({
        component_id: c.component_id,
        quantity: Math.round(parseNumber(c.quantity) * 1000) / 1000
      }));

    if (draft.mode === "new") {
      if (!draft.name.trim()) return setError("Ingresá el nombre del producto (por ejemplo: Vaso de cerveza).");
      if (parseNumber(draft.price) <= 0) return setError("Ingresá el precio de venta.");
    } else if (!draft.productId) {
      return setError("Elegí el producto que querés componer.");
    }
    if (lines.length === 0) return setError("Agregá al menos un componente.");
    if (lines.some((l) => l.quantity <= 0)) {
      return setError("Cada componente necesita una cantidad mayor a cero (hasta 3 decimales).");
    }
    if (new Set(lines.map((l) => l.component_id)).size !== lines.length) {
      return setError("Hay un componente repetido.");
    }

    if (demoMode) {
      const id = draft.mode === "new" ? `demo-${Date.now()}` : draft.productId;
      setProducts((rows) => {
        const base =
          draft.mode === "new"
            ? [
                ...rows,
                demoProduct({
                  id,
                  name: draft.name.trim(),
                  sale_price: parseNumber(draft.price),
                  category: draft.category || null,
                  unit: draft.unit,
                  track_stock: false,
                  is_composite: true
                })
              ]
            : rows.map((p) => (p.id === id ? { ...p, is_composite: true } : p));
        const links = [
          ...base
            .filter((p) => p.is_composite && p.id !== id)
            .flatMap((p) =>
              p.components.map((c) => ({ product_id: p.id, component_id: c.component_id, quantity: c.quantity }))
            ),
          ...lines.map((l) => ({ product_id: id, component_id: l.component_id, quantity: l.quantity }))
        ];
        return resolveComposition(base, links);
      });
      setDraft(null);
      setSuccess("Modo demo: no se guarda en la base de datos.");
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;
    setSaving(true);
    let productId = draft.productId;
    try {
      if (draft.mode === "new") {
        productId = await createProduct(supabaseBrowser, currentCompany.id, {
          name: draft.name,
          category: draft.category,
          unit: draft.unit,
          sale_price: parseNumber(draft.price),
          cost: 0,
          min_stock: 0,
          track_stock: false,
          is_for_sale: true
        });
      }
      await setProductComponents(supabaseBrowser, currentCompany.id, productId, lines);
      setDraft(null);
      setSuccess("Producto compuesto guardado. Ya podés venderlo desde Ventas.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function removeComposition(product: Product) {
    if (!window.confirm(`¿Quitar la composición de «${product.name}»? El producto no se elimina.`)) return;
    setError("");
    setSuccess("");
    if (demoMode) {
      setProducts((rows) => rows.map((p) => (p.id === product.id ? { ...p, is_composite: false, components: [] } : p)));
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;
    try {
      await setProductComponents(supabaseBrowser, currentCompany.id, product.id, []);
      setSuccess("Composición quitada.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const lowMargin = composites.filter((p) => marginOf(p.sale_price, p.cost) < 30).length;
  const noStock = composites.filter((p) => p.available !== null && p.available <= 0).length;

  return (
    <>
      <section className="module-intro">
        <div className="module-copy">
          <span className="module-kicker">PRODUCTOS COMPUESTOS</span>
          <h2>
            Vendés uno, <span>y se descuentan sus componentes.</span>
          </h2>
          <p>
            Armá un producto con lo que lleva: un vaso de cerveza descuenta 0,4 litros del barril; una
            botella con gaseosas descuenta la botella y las cinco gaseosas. El costo y la ganancia se
            calculan solos. Los insumos se cargan primero en Productos (tildando que no se venden).
          </p>
        </div>
        <div className="module-actions">
          <button className="button button-dark" type="button" onClick={openNew}>
            <Icon name="plus" size={14} /> Nuevo producto compuesto
          </button>
        </div>
      </section>

      {(error || success) && !draft && (
        <div className={`form-message ${error ? "error" : "success"}`}>{error || success}</div>
      )}

      <section className="compact-metrics">
        <CompactMetric icon="boxes" tone="purple" label="Productos compuestos" value={String(composites.length)} />
        <CompactMetric icon="alert" tone="red" label="Sin insumos para vender" value={String(noStock)} />
        <CompactMetric icon="reports" tone="blue" label="Margen menor al 30%" value={String(lowMargin)} />
      </section>

      {!draft && (
        <section className="content-card">
          {loading ? (
            <p className="muted-small pos-pad">Cargando productos...</p>
          ) : composites.length === 0 ? (
            <div className="clients-empty">
              <span><Icon name="boxes" size={24} /></span>
              <strong>Todavía no hay productos compuestos</strong>
              <p>
                Primero cargá los insumos en Productos (por ejemplo el barril de cerveza en litros) y después
                armá acá lo que vendés con ellos.
              </p>
              <button className="button button-dark" type="button" onClick={openNew}>
                <Icon name="plus" size={14} /> Crear el primero
              </button>
            </div>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Lleva</th>
                    <th>Costo</th>
                    <th>Precio</th>
                    <th>Margen</th>
                    <th>Podés vender</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {composites.map((p) => {
                    const margin = marginOf(p.sale_price, p.cost);
                    return (
                      <tr key={p.id}>
                        <td><strong>{p.name}</strong></td>
                        <td>
                          <small className="pos-sub">
                            {p.components.map((c) => `${qty(c.quantity)} ${c.unit} de ${c.name}`).join(" + ")}
                          </small>
                        </td>
                        <td className="money">{money(p.cost)}</td>
                        <td className="money"><strong>{money(p.sale_price)}</strong></td>
                        <td>
                          <span className={`status-pill ${margin < 30 ? "status-red" : "status-green"}`}>
                            {margin.toFixed(0)}%
                          </span>
                        </td>
                        <td>
                          {p.available === null ? (
                            "—"
                          ) : (
                            <span className={`status-pill ${p.available <= 0 ? "status-red" : "status-green"}`}>
                              {qty(p.available)}
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button className="button modal-secondary" type="button" onClick={() => openEdit(p)}>Editar</button>
                            <button className="button modal-secondary" type="button" onClick={() => void removeComposition(p)}>Quitar</button>
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
      )}

      {draft && draftCalc && (
        <section className="content-card pos-recipe-editor">
          <div className="modal-head">
            <div>
              <span>{draft.editing ? "EDITAR COMPOSICIÓN" : "NUEVO PRODUCTO COMPUESTO"}</span>
              <h3>{draft.name || "Sin nombre"}</h3>
            </div>
            <button type="button" className="modal-close" onClick={() => setDraft(null)}>×</button>
          </div>

          {error && <div className="form-message error">{error}</div>}

          {!draft.editing && (
            <div className="pos-tabs" role="tablist" style={{ width: "fit-content" }}>
              <button type="button" className={draft.mode === "new" ? "active" : ""} onClick={() => setDraft({ ...draft, mode: "new", productId: "" })}>
                Crear producto nuevo
              </button>
              <button type="button" className={draft.mode === "existing" ? "active" : ""} onClick={() => setDraft({ ...draft, mode: "existing" })}>
                Usar uno que ya cargué
              </button>
            </div>
          )}

          {draft.mode === "new" ? (
            <div className="client-form-grid">
              <label className="form-field full-field">
                <span>Nombre</span>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Vaso de cerveza, Shot de Fernet..." autoFocus />
              </label>
              <label className="form-field">
                <span>Precio de venta</span>
                <input inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
              </label>
              <label className="form-field">
                <span>Unidad</span>
                <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>
                  {UNITS.map((u) => <option value={u} key={u}>{u}</option>)}
                </select>
              </label>
              <label className="form-field">
                <span>Categoría (opcional)</span>
                <input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
              </label>
            </div>
          ) : (
            !draft.editing && (
              <div className="client-form-grid">
                <label className="form-field full-field">
                  <span>Producto</span>
                  <select value={draft.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value })}>
                    <option value="">Elegí un producto...</option>
                    {convertible.map((p) => (
                      <option value={p.id} key={p.id}>{p.name} ({money(p.sale_price)})</option>
                    ))}
                  </select>
                </label>
              </div>
            )
          )}

          <h4 className="pos-h4">Qué lleva</h4>
          <div className="data-table-wrap">
            <table className="data-table pos-ingredients">
              <thead>
                <tr>
                  <th>Componente (de tu stock)</th>
                  <th>Cantidad que se descuenta</th>
                  <th>Costo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.components.map((line) => {
                  const comp = products.find((p) => p.id === line.component_id);
                  return (
                    <tr key={line.key}>
                      <td>
                        <select value={line.component_id} onChange={(e) => updateLine(line.key, { component_id: e.target.value })}>
                          <option value="">Elegí un producto...</option>
                          {componentOptions.map((p) => (
                            <option value={p.id} key={p.id}>
                              {p.name}{p.track_stock ? ` — stock ${qty(p.stock)} ${p.unit}` : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div className="pos-pair">
                          <input inputMode="decimal" value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} placeholder="0,4" />
                          <span className="pos-sub" style={{ alignSelf: "center" }}>{comp?.unit ?? "—"}</span>
                        </div>
                      </td>
                      <td className="money"><strong>{money((comp?.cost ?? 0) * parseNumber(line.quantity))}</strong></td>
                      <td>
                        <button
                          type="button"
                          className="modal-close"
                          aria-label="Quitar componente"
                          onClick={() => setDraft({ ...draft, components: draft.components.filter((c) => c.key !== line.key) })}
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
          <p className="muted-small">
            La cantidad va en la unidad del componente (si el barril está en litros, un vaso de 400 cc es 0,4).
            Se admiten hasta 3 decimales.
          </p>

          <button
            type="button"
            className="button modal-secondary"
            onClick={() => setDraft({ ...draft, components: [...draft.components, { key: newKey(), component_id: "", quantity: "" }] })}
          >
            <Icon name="plus" size={14} /> Agregar componente
          </button>

          <div className="pos-recipe-totals">
            <div><span>Costo</span><strong>{money(draftCalc.cost)}</strong></div>
            <div><span>Precio de venta</span><strong>{money(draftCalc.price)}</strong></div>
            <div><span>Ganancia</span><strong className={draftCalc.profit < 0 ? "pos-negative" : "pos-positive"}>{money(draftCalc.profit)}</strong></div>
            <div><span>Margen</span><strong className={draftCalc.margin < 30 ? "pos-negative" : "pos-positive"}>{draftCalc.margin.toFixed(1)}%</strong></div>
          </div>

          <div className="modal-actions">
            <button type="button" className="button modal-secondary" onClick={() => setDraft(null)}>Cancelar</button>
            <button type="button" className="button button-dark" disabled={saving} onClick={() => void save()}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
