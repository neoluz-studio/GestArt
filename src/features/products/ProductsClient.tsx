"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CompactMetric } from "@/components/Metric";
import { Icon } from "@/components/Icon";
import { ModuleGate } from "@/components/ModuleGate";
import { Topbar } from "@/components/Topbar";
import { useTenant } from "@/contexts/TenantContext";
import { demoMode } from "@/lib/runtime";
import {
  errorMessage,
  makeDateTime,
  makeMoney,
  makeQuantity,
  parseNumber
} from "@/lib/pos-format";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  adjustProductStock,
  createProduct,
  listProductMovements,
  listProducts,
  setProductActive,
  updateProduct,
  type Product,
  type ProductInput,
  type ProductStockMovement
} from "@/services/products";

const UNITS = ["unidad", "docena", "kg", "g", "litro", "ml", "metro", "m²", "pack"];

const DEMO_PRODUCTS: Product[] = [
  { id: "d1", code: "PAN-001", name: "Pan francés", category: "Panificados", unit: "kg", sale_price: 2800, cost: 1100, stock: 24, min_stock: 8, track_stock: true, is_active: true, updated_at: new Date().toISOString() },
  { id: "d2", code: "TOR-010", name: "Tortas decoradas", category: "Pastelería", unit: "unidad", sale_price: 18500, cost: 7200, stock: 3, min_stock: 5, track_stock: true, is_active: true, updated_at: new Date().toISOString() },
  { id: "d3", code: "SRV-001", name: "Diseño de logo", category: "Servicios", unit: "unidad", sale_price: 45000, cost: 0, stock: 0, min_stock: 0, track_stock: false, is_active: true, updated_at: new Date().toISOString() }
];

type FormState = {
  code: string;
  name: string;
  category: string;
  unit: string;
  sale_price: string;
  cost: string;
  min_stock: string;
  initial_stock: string;
  track_stock: boolean;
};

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  category: "",
  unit: "unidad",
  sale_price: "",
  cost: "",
  min_stock: "0",
  initial_stock: "0",
  track_stock: true
};

function stockState(product: Product): "none" | "empty" | "low" | "ok" {
  if (!product.track_stock) return "none";
  if (product.stock <= 0) return "empty";
  if (product.stock <= product.min_stock) return "low";
  return "ok";
}

export function ProductsClient() {
  const { currentCompany, settings } = useTenant();
  const locale = settings?.locale || "es-AR";
  const money = useMemo(
    () => makeMoney(locale, settings?.currency || "ARS"),
    [locale, settings?.currency]
  );
  const qty = useMemo(() => makeQuantity(locale), [locale]);
  const dateTime = useMemo(() => makeDateTime(locale), [locale]);

  const [products, setProducts] = useState<Product[]>(demoMode ? DEMO_PRODUCTS : []);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [stockType, setStockType] = useState<"in" | "out" | "adjustment">("in");
  const [stockQty, setStockQty] = useState("");
  const [stockReason, setStockReason] = useState("");
  const [movements, setMovements] = useState<ProductStockMovement[]>([]);

  const load = useCallback(async () => {
    if (demoMode || !supabaseBrowser || !currentCompany) return;
    setLoading(true);
    setError("");
    try {
      setProducts(
        await listProducts(supabaseBrowser, currentCompany.id, {
          includeArchived: showArchived
        })
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [currentCompany, showArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(
    () =>
      Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort() as string[],
    [products]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!showArchived && !p.is_active) return false;
      if (category && p.category !== category) return false;
      if (stockFilter) {
        const state = stockState(p);
        if (stockFilter === "low" && state !== "low" && state !== "empty") return false;
        if (stockFilter === "ok" && state !== "ok" && state !== "none") return false;
      }
      if (!term) return true;
      return [p.name, p.code, p.category].some((v) => (v ?? "").toLowerCase().includes(term));
    });
  }, [products, search, category, stockFilter, showArchived]);

  const metrics = useMemo(() => {
    const active = products.filter((p) => p.is_active);
    const lowStock = active.filter((p) => ["low", "empty"].includes(stockState(p))).length;
    const inventoryValue = active
      .filter((p) => p.track_stock)
      .reduce((sum, p) => sum + p.stock * p.cost, 0);
    const withPrice = active.filter((p) => p.sale_price > 0);
    const avgMargin = withPrice.length
      ? withPrice.reduce((sum, p) => sum + ((p.sale_price - p.cost) / p.sale_price) * 100, 0) /
        withPrice.length
      : 0;
    return { count: active.length, lowStock, inventoryValue, avgMargin };
  }, [products]);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError("");
    setFormOpen(true);
  }

  function openEdit(product: Product) {
    setEditing(product);
    setForm({
      code: product.code ?? "",
      name: product.name,
      category: product.category ?? "",
      unit: product.unit,
      sale_price: String(product.sale_price),
      cost: String(product.cost),
      min_stock: String(product.min_stock),
      initial_stock: "0",
      track_stock: product.track_stock
    });
    setError("");
    setFormOpen(true);
  }

  async function saveProduct(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const salePrice = parseNumber(form.sale_price);
    const cost = parseNumber(form.cost);
    const minStock = parseNumber(form.min_stock);
    const initialStock = parseNumber(form.initial_stock);

    if (!form.name.trim()) return setError("Ingresá el nombre del producto.");
    if (salePrice <= 0) return setError("El precio de venta debe ser mayor a cero.");
    if (cost < 0 || minStock < 0 || initialStock < 0) {
      return setError("Los valores no pueden ser negativos.");
    }

    const input: ProductInput = {
      code: form.code,
      name: form.name,
      category: form.category,
      unit: form.unit,
      sale_price: salePrice,
      cost,
      min_stock: minStock,
      track_stock: form.track_stock,
      initial_stock: initialStock
    };

    if (demoMode) {
      const now = new Date().toISOString();
      if (editing) {
        setProducts((rows) =>
          rows.map((p) =>
            p.id === editing.id
              ? { ...p, ...input, code: input.code?.trim() || null, category: input.category?.trim() || null, updated_at: now }
              : p
          )
        );
      } else {
        setProducts((rows) => [
          {
            id: `demo-${Date.now()}`,
            code: input.code?.trim() || null,
            name: input.name.trim(),
            category: input.category?.trim() || null,
            unit: input.unit,
            sale_price: salePrice,
            cost,
            stock: form.track_stock ? initialStock : 0,
            min_stock: minStock,
            track_stock: form.track_stock,
            is_active: true,
            updated_at: now
          },
          ...rows
        ]);
      }
      setFormOpen(false);
      setSuccess("Modo demo: el cambio no se guarda en la base de datos.");
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;
    setSaving(true);
    try {
      if (editing) await updateProduct(supabaseBrowser, currentCompany.id, editing.id, input);
      else await createProduct(supabaseBrowser, currentCompany.id, input);
      setFormOpen(false);
      setSuccess(editing ? "Producto actualizado." : "Producto creado.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(product: Product) {
    setError("");
    setSuccess("");
    if (demoMode) {
      setProducts((rows) =>
        rows.map((p) => (p.id === product.id ? { ...p, is_active: !p.is_active } : p))
      );
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;
    try {
      await setProductActive(supabaseBrowser, currentCompany.id, product.id, !product.is_active);
      setSuccess(product.is_active ? "Producto archivado." : "Producto restaurado.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function openStock(product: Product) {
    setStockProduct(product);
    setStockType("in");
    setStockQty("");
    setStockReason("");
    setMovements([]);
    setError("");
    if (demoMode || !supabaseBrowser || !currentCompany) return;
    try {
      setMovements(await listProductMovements(supabaseBrowser, currentCompany.id, product.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function saveStock(event: FormEvent) {
    event.preventDefault();
    if (!stockProduct) return;
    setError("");

    const quantity = parseNumber(stockQty);
    if (stockType !== "adjustment" && quantity <= 0) return setError("Indicá una cantidad mayor a cero.");
    if (quantity < 0) return setError("La cantidad no puede ser negativa.");
    if (stockReason.trim().length < 3) return setError("Indicá el motivo del movimiento.");

    if (demoMode) {
      setProducts((rows) =>
        rows.map((p) => {
          if (p.id !== stockProduct.id) return p;
          const next =
            stockType === "in" ? p.stock + quantity : stockType === "out" ? p.stock - quantity : quantity;
          return { ...p, stock: Math.max(next, 0) };
        })
      );
      setStockProduct(null);
      setSuccess("Modo demo: el cambio no se guarda en la base de datos.");
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;
    setSaving(true);
    try {
      await adjustProductStock(
        supabaseBrowser,
        currentCompany.id,
        stockProduct.id,
        stockType,
        quantity,
        stockReason
      );
      setStockProduct(null);
      setSuccess("Stock actualizado.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const marginOf = (p: Product) =>
    p.sale_price > 0 ? ((p.sale_price - p.cost) / p.sale_price) * 100 : 0;

  return (
    <ModuleGate code="products" label="Productos">
      <Topbar eyebrow="Comercio" title="Productos" />

      <div className="page-content page-stack pos-page">
        <section className="module-intro">
          <div className="module-copy">
            <span className="module-kicker">CATÁLOGO Y STOCK</span>
            <h2>
              Tus productos, <span>con precio y stock al día.</span>
            </h2>
            <p>
              Cargá lo que vendés, con su costo y su precio. Cada venta descuenta el stock y
              GestArt calcula tu margen automáticamente.
            </p>
          </div>
          <div className="module-actions">
            <button className="button button-dark" type="button" onClick={openNew}>
              <Icon name="plus" size={14} /> Nuevo producto
            </button>
          </div>
        </section>

        {(error || success) && !formOpen && !stockProduct && (
          <div className={`form-message ${error ? "error" : "success"}`}>{error || success}</div>
        )}

        <section className="compact-metrics">
          <CompactMetric icon="boxes" tone="purple" label="Productos activos" value={String(metrics.count)} />
          <CompactMetric icon="alert" tone="red" label="Stock bajo o agotado" value={String(metrics.lowStock)} />
          <CompactMetric icon="money" tone="green" label="Valor del stock (costo)" value={money(metrics.inventoryValue)} />
          <CompactMetric icon="reports" tone="blue" label="Margen promedio" value={`${metrics.avgMargin.toFixed(0)}%`} />
        </section>

        <section className="filter-bar">
          <label className="filter-search">
            <Icon name="search" size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, código o categoría..."
            />
          </label>
          <select className="filter-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas las categorías</option>
            {categories.map((item) => (
              <option value={item} key={item}>{item}</option>
            ))}
          </select>
          <select className="filter-select" value={stockFilter} onChange={(e) => setStockFilter(e.target.value)}>
            <option value="">Todo el stock</option>
            <option value="low">Stock bajo o agotado</option>
            <option value="ok">Con stock</option>
          </select>
          <label className="pos-check">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Ver archivados
          </label>
        </section>

        <section className="content-card">
          {loading ? (
            <p className="muted-small pos-pad">Cargando productos...</p>
          ) : filtered.length === 0 ? (
            <div className="clients-empty">
              <span><Icon name="boxes" size={24} /></span>
              <strong>No hay productos para mostrar</strong>
              <p>Creá tu primer producto para empezar a vender.</p>
              <button className="button button-dark" type="button" onClick={openNew}>
                <Icon name="plus" size={14} /> Crear producto
              </button>
            </div>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Categoría</th>
                    <th>Precio</th>
                    <th>Costo</th>
                    <th>Margen</th>
                    <th>Stock</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const state = stockState(p);
                    return (
                      <tr key={p.id} className={!p.is_active ? "pos-row-inactive" : ""}>
                        <td>
                          <strong>{p.name}</strong>
                          <small className="pos-sub">{p.code || "Sin código"} · {p.unit}</small>
                        </td>
                        <td>{p.category || "—"}</td>
                        <td className="money"><strong>{money(p.sale_price)}</strong></td>
                        <td className="money">{money(p.cost)}</td>
                        <td>{marginOf(p).toFixed(0)}%</td>
                        <td>{p.track_stock ? `${qty(p.stock)} ${p.unit}` : "—"}</td>
                        <td>
                          {!p.is_active ? (
                            <span className="status-pill status-gray">Archivado</span>
                          ) : state === "empty" ? (
                            <span className="status-pill status-red">Agotado</span>
                          ) : state === "low" ? (
                            <span className="status-pill status-red">Stock bajo</span>
                          ) : state === "none" ? (
                            <span className="status-pill status-gray">Sin control</span>
                          ) : (
                            <span className="status-pill status-green">Disponible</span>
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            {p.track_stock && p.is_active && (
                              <button className="button modal-secondary" type="button" onClick={() => void openStock(p)}>
                                Stock
                              </button>
                            )}
                            <button className="button modal-secondary" type="button" onClick={() => openEdit(p)}>
                              Editar
                            </button>
                            <button className="button modal-secondary" type="button" onClick={() => void toggleArchive(p)}>
                              {p.is_active ? "Archivar" : "Restaurar"}
                            </button>
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

        {formOpen && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(e) => {
              if (e.currentTarget === e.target) setFormOpen(false);
            }}
          >
            <form className="modal-card" onSubmit={saveProduct}>
              <div className="modal-head">
                <div>
                  <span>PRODUCTOS</span>
                  <h3>{editing ? "Editar producto" : "Nuevo producto"}</h3>
                </div>
                <button type="button" className="modal-close" onClick={() => setFormOpen(false)}>×</button>
              </div>

              {error && <div className="form-message error">{error}</div>}

              <div className="client-form-grid">
                <label className="form-field full-field">
                  <span>Nombre</span>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
                </label>
                <label className="form-field">
                  <span>Código (opcional)</span>
                  <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                </label>
                <label className="form-field">
                  <span>Categoría</span>
                  <input
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    list="product-categories"
                  />
                  <datalist id="product-categories">
                    {categories.map((item) => <option value={item} key={item} />)}
                  </datalist>
                </label>
                <label className="form-field">
                  <span>Precio de venta</span>
                  <input inputMode="decimal" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: e.target.value })} />
                </label>
                <label className="form-field">
                  <span>Costo</span>
                  <input inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
                </label>
                <label className="form-field">
                  <span>Unidad</span>
                  <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                    {UNITS.map((u) => <option value={u} key={u}>{u}</option>)}
                  </select>
                </label>
                <label className="form-field pos-check-field">
                  <span>Control de stock</span>
                  <span className="pos-check">
                    <input
                      type="checkbox"
                      checked={form.track_stock}
                      onChange={(e) => setForm({ ...form, track_stock: e.target.checked })}
                    />
                    Descontar stock al vender
                  </span>
                </label>
                {form.track_stock && (
                  <>
                    <label className="form-field">
                      <span>Stock mínimo (alerta)</span>
                      <input inputMode="decimal" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} />
                    </label>
                    {!editing && (
                      <label className="form-field">
                        <span>Stock inicial</span>
                        <input inputMode="decimal" value={form.initial_stock} onChange={(e) => setForm({ ...form, initial_stock: e.target.value })} />
                      </label>
                    )}
                  </>
                )}
              </div>

              <div className="modal-actions">
                <button type="button" className="button modal-secondary" onClick={() => setFormOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="button button-dark" disabled={saving}>
                  {saving ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        )}

        {stockProduct && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(e) => {
              if (e.currentTarget === e.target) setStockProduct(null);
            }}
          >
            <form className="modal-card" onSubmit={saveStock}>
              <div className="modal-head">
                <div>
                  <span>STOCK</span>
                  <h3>{stockProduct.name}</h3>
                </div>
                <button type="button" className="modal-close" onClick={() => setStockProduct(null)}>×</button>
              </div>

              <p className="muted-small">
                Stock actual: <strong>{qty(stockProduct.stock)} {stockProduct.unit}</strong>
              </p>

              {error && <div className="form-message error">{error}</div>}

              <div className="client-form-grid">
                <label className="form-field">
                  <span>Movimiento</span>
                  <select value={stockType} onChange={(e) => setStockType(e.target.value as typeof stockType)}>
                    <option value="in">Entrada (compra / producción)</option>
                    <option value="out">Salida (merma / consumo)</option>
                    <option value="adjustment">Ajuste (fijar cantidad real)</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>{stockType === "adjustment" ? "Cantidad real" : "Cantidad"}</span>
                  <input inputMode="decimal" value={stockQty} onChange={(e) => setStockQty(e.target.value)} autoFocus />
                </label>
                <label className="form-field full-field">
                  <span>Motivo</span>
                  <input value={stockReason} onChange={(e) => setStockReason(e.target.value)} placeholder="Compra, conteo, rotura..." />
                </label>
              </div>

              {movements.length > 0 && (
                <div className="drawer-section">
                  <strong>Últimos movimientos</strong>
                  <div className="pos-movement-list">
                    {movements.slice(0, 8).map((m) => (
                      <div className="pos-movement-row" key={m.id}>
                        <span>{dateTime(m.created_at)}</span>
                        <span>{m.reason}</span>
                        <strong className={m.quantity > 0 ? "pos-positive" : "pos-negative"}>
                          {m.quantity > 0 ? "+" : ""}{qty(m.quantity)}
                        </strong>
                        <span>→ {qty(m.balance_after)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="modal-actions">
                <button type="button" className="button modal-secondary" onClick={() => setStockProduct(null)}>
                  Cancelar
                </button>
                <button type="submit" className="button button-dark" disabled={saving}>
                  {saving ? "Guardando..." : "Registrar"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </ModuleGate>
  );
}
