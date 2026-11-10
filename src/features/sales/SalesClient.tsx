"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  parseNumber,
  toLocalISODate
} from "@/lib/pos-format";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { listPaymentMethods, type PaymentMethod } from "@/services/cash";
import { availableOf, demoProduct, listProducts, type Product } from "@/services/products";
import {
  cancelSale,
  cartDiscountAmount,
  createSale,
  lineAmounts,
  listSales,
  type DiscountType,
  type SaleRecord
} from "@/services/sales";

type CartLine = {
  product: Product;
  quantity: number;
  discountType: DiscountType;
  discountValue: string;
};

const DEMO_PRODUCTS: Product[] = [
  demoProduct({ id: "d1", code: "PAN-001", name: "Pan francés", category: "Panificados", unit: "kg", sale_price: 2800, cost: 1100, stock: 24, min_stock: 8 }),
  demoProduct({ id: "d2", code: "TOR-010", name: "Tortas decoradas", category: "Pastelería", unit: "unidad", sale_price: 18500, cost: 7200, stock: 3, min_stock: 5 }),
  demoProduct({ id: "d3", code: "SRV-001", name: "Diseño de logo", category: "Servicios", unit: "unidad", sale_price: 45000, cost: 0, track_stock: false })
];
const DEMO_METHODS: PaymentMethod[] = [
  { id: "m1", code: "cash", name: "Efectivo" },
  { id: "m2", code: "transfer", name: "Transferencia" }
];

type Tab = "pos" | "history";

export function SalesClient() {
  const { currentCompany, settings } = useTenant();
  const locale = settings?.locale || "es-AR";
  const money = useMemo(
    () => makeMoney(locale, settings?.currency || "ARS"),
    [locale, settings?.currency]
  );
  const qtyFmt = useMemo(() => makeQuantity(locale), [locale]);
  const dateTime = useMemo(() => makeDateTime(locale), [locale]);

  const [tab, setTab] = useState<Tab>("pos");
  const [products, setProducts] = useState<Product[]>(demoMode ? DEMO_PRODUCTS : []);
  const [methods, setMethods] = useState<PaymentMethod[]>(demoMode ? DEMO_METHODS : []);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Punto de venta
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartDiscType, setCartDiscType] = useState<DiscountType>("percent");
  const [cartDiscValue, setCartDiscValue] = useState("");
  const [methodId, setMethodId] = useState("");
  const [notes, setNotes] = useState("");
  const [charging, setCharging] = useState(false);

  // Historial
  const today = toLocalISODate();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [selected, setSelected] = useState<SaleRecord | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const loadCatalog = useCallback(async () => {
    if (demoMode || !supabaseBrowser || !currentCompany) return;
    setLoading(true);
    setError("");
    try {
      const [productRows, methodRows] = await Promise.all([
        listProducts(supabaseBrowser, currentCompany.id),
        listPaymentMethods(supabaseBrowser, currentCompany.id)
      ]);
      setProducts(productRows);
      setMethods(methodRows);
      setMethodId((current) => current || methodRows[0]?.id || "");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [currentCompany]);

  const loadSales = useCallback(async () => {
    if (demoMode || !supabaseBrowser || !currentCompany) return;
    if (!from || !to || from > to) return;
    setSalesLoading(true);
    try {
      setSales(await listSales(supabaseBrowser, currentCompany.id, { from, to }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSalesLoading(false);
    }
  }, [currentCompany, from, to]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (tab === "history") void loadSales();
  }, [tab, loadSales]);

  useEffect(() => {
    if (demoMode && !methodId) setMethodId(DEMO_METHODS[0].id);
  }, [methodId]);

  // ---- Carrito ----
  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products
      .filter((p) => p.is_active && p.is_for_sale)
      .filter((p) =>
        !term ? true : [p.name, p.code, p.category].some((v) => (v ?? "").toLowerCase().includes(term))
      )
      .slice(0, 60);
  }, [products, search]);

  function addToCart(product: Product) {
    setError("");
    setSuccess("");
    setCart((lines) => {
      const existing = lines.find((l) => l.product.id === product.id);
      const current = existing?.quantity ?? 0;
      const avail = availableOf(product);
      if (avail !== null && current + 1 > avail) {
        setError(`No hay más stock de ${product.name}.`);
        return lines;
      }
      if (existing) {
        return lines.map((l) =>
          l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [...lines, { product, quantity: 1, discountType: "percent", discountValue: "" }];
    });
  }

  function setQuantity(productId: string, value: number) {
    setCart((lines) =>
      lines
        .map((l) => {
          if (l.product.id !== productId) return l;
          const max = availableOf(l.product) ?? Infinity;
          return { ...l, quantity: Math.min(Math.max(value, 0), max) };
        })
        .filter((l) => l.quantity > 0)
    );
  }

  function updateLine(productId: string, patch: Partial<CartLine>) {
    setCart((lines) => lines.map((l) => (l.product.id === productId ? { ...l, ...patch } : l)));
  }

  const totals = useMemo(() => {
    let subtotal = 0;
    let itemDiscount = 0;
    let cost = 0;
    for (const line of cart) {
      const amounts = lineAmounts(
        line.product.sale_price,
        line.quantity,
        line.discountType,
        parseNumber(line.discountValue)
      );
      subtotal += amounts.subtotal;
      itemDiscount += amounts.discount;
      cost += line.product.cost * line.quantity;
    }
    const afterItems = subtotal - itemDiscount;
    const cartDiscount = cartDiscountAmount(afterItems, cartDiscType, parseNumber(cartDiscValue));
    const total = afterItems - cartDiscount;
    return { subtotal, itemDiscount, cartDiscount, total, profit: total - cost };
  }, [cart, cartDiscType, cartDiscValue]);

  async function charge() {
    setError("");
    setSuccess("");
    if (cart.length === 0) return setError("Agregá al menos un producto.");
    if (!methodId) return setError("Elegí el método de pago.");

    if (demoMode) {
      const number = sales.length + 1;
      setSales((rows) => [
        {
          id: `demo-${Date.now()}`,
          sale_number: number,
          sold_at: new Date().toISOString(),
          status: "completed",
          payment_method_name: methods.find((m) => m.id === methodId)?.name ?? null,
          subtotal: totals.subtotal,
          discount_total: totals.itemDiscount + totals.cartDiscount,
          total: totals.total,
          cost_total: totals.total - totals.profit,
          profit: totals.profit,
          notes: notes || null,
          cancel_reason: null,
          items: cart.map((l, i) => ({
            id: `${i}`,
            name: l.product.name,
            quantity: l.quantity,
            unit_price: l.product.sale_price,
            discount: 0,
            total: l.product.sale_price * l.quantity
          }))
        },
        ...rows
      ]);
      setCart([]);
      setCartDiscValue("");
      setNotes("");
      setSuccess(`Modo demo: venta #${number} simulada (no se guarda).`);
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;
    setCharging(true);
    try {
      await createSale(supabaseBrowser, currentCompany.id, {
        items: cart.map((l) => ({
          product_id: l.product.id,
          quantity: l.quantity,
          discount_type: l.discountType,
          discount_value: parseNumber(l.discountValue)
        })),
        paymentMethodId: methodId,
        cartDiscountType: cartDiscType,
        cartDiscountValue: parseNumber(cartDiscValue),
        notes
      });
      setSuccess(`Venta registrada por ${money(totals.total)}.`);
      setCart([]);
      setCartDiscValue("");
      setNotes("");
      await loadCatalog(); // refresca stock
    } catch (err) {
      setError(errorMessage(err));
      await loadCatalog();
    } finally {
      setCharging(false);
    }
  }

  // ---- Historial ----
  const completed = useMemo(() => sales.filter((s) => s.status === "completed"), [sales]);
  const summary = useMemo(
    () => ({
      count: completed.length,
      total: completed.reduce((sum, s) => sum + s.total, 0),
      profit: completed.reduce((sum, s) => sum + s.profit, 0),
      average: completed.length
        ? completed.reduce((sum, s) => sum + s.total, 0) / completed.length
        : 0
    }),
    [completed]
  );

  async function doCancel() {
    if (!selected) return;
    setError("");
    if (cancelReason.trim().length < 5) return setError("Indicá el motivo de la anulación.");
    if (demoMode) {
      setSales((rows) =>
        rows.map((s) => (s.id === selected.id ? { ...s, status: "cancelled", cancel_reason: cancelReason } : s))
      );
      setSelected(null);
      setCancelReason("");
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;
    try {
      await cancelSale(supabaseBrowser, currentCompany.id, selected.id, cancelReason);
      setSelected(null);
      setCancelReason("");
      setSuccess("Venta anulada. Se devolvió el stock y se revirtió la caja.");
      await Promise.all([loadSales(), loadCatalog()]);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function quickRange(days: number) {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setFrom(toLocalISODate(start));
    setTo(toLocalISODate(end));
  }

  const scheduleLabel =
    settings?.cash_auto_close_enabled
      ? `Caja ${String(settings.cash_open_time ?? "09:00").slice(0, 5)} a ${String(settings.cash_close_time ?? "00:00").slice(0, 5)} · cierre automático`
      : null;

  return (
    <ModuleGate code="sales" label="Ventas">
      <Topbar eyebrow="Comercio" title="Ventas" />

      <div className="page-content page-stack pos-page">
        <section className="module-intro">
          <div className="module-copy">
            <span className="module-kicker">PUNTO DE VENTA</span>
            <h2>
              Vendé rápido, <span>y la caja se actualiza sola.</span>
            </h2>
            <p>
              Cada venta descuenta stock, calcula tu ganancia y registra el ingreso en la caja.
              {scheduleLabel ? ` ${scheduleLabel}.` : ""}
            </p>
          </div>
          <div className="module-actions">
            <div className="pos-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "pos"} className={tab === "pos" ? "active" : ""} onClick={() => setTab("pos")}>
                Vender
              </button>
              <button type="button" role="tab" aria-selected={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
                Historial
              </button>
            </div>
          </div>
        </section>

        {(error || success) && !selected && (
          <div className={`form-message ${error ? "error" : "success"}`}>{error || success}</div>
        )}

        {tab === "pos" && (
          <section className="pos-layout">
            <div className="content-card pos-products">
              <label className="filter-search">
                <Icon name="search" size={14} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar producto por nombre o código..."
                />
              </label>

              {loading ? (
                <p className="muted-small pos-pad">Cargando productos...</p>
              ) : visibleProducts.length === 0 ? (
                <div className="clients-empty">
                  <strong>No hay productos para vender</strong>
                  <p>Cargalos primero en el módulo Productos.</p>
                </div>
              ) : (
                <div className="pos-grid">
                  {visibleProducts.map((p) => {
                    const avail = availableOf(p);
                    const out = avail !== null && avail <= 0;
                    return (
                      <button
                        type="button"
                        key={p.id}
                        className={`pos-product ${out ? "disabled" : ""}`}
                        disabled={out}
                        onClick={() => addToCart(p)}
                      >
                        <strong>{p.name}</strong>
                        <span className="pos-price">{money(p.sale_price)}</span>
                        <small>
                          {out
                            ? "SIN STOCK"
                            : p.is_composite
                              ? avail === null ? p.unit : `Podés vender: ${qtyFmt(avail)}`
                              : p.track_stock
                                ? `Stock: ${qtyFmt(p.stock)} ${p.unit}`
                                : p.unit}
                        </small>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <aside className="content-card pos-cart">
              <h3>Venta actual</h3>

              {cart.length === 0 ? (
                <p className="muted-small pos-pad">Tocá un producto para agregarlo.</p>
              ) : (
                <div className="pos-lines">
                  {cart.map((line) => {
                    const amounts = lineAmounts(
                      line.product.sale_price,
                      line.quantity,
                      line.discountType,
                      parseNumber(line.discountValue)
                    );
                    return (
                      <div className="pos-line" key={line.product.id}>
                        <div className="pos-line-head">
                          <strong>{line.product.name}</strong>
                          <button type="button" className="modal-close" aria-label="Quitar" onClick={() => setQuantity(line.product.id, 0)}>×</button>
                        </div>
                        <div className="pos-line-body">
                          <div className="pos-qty">
                            <button type="button" onClick={() => setQuantity(line.product.id, line.quantity - 1)}>−</button>
                            <input
                              inputMode="decimal"
                              value={line.quantity}
                              onChange={(e) => setQuantity(line.product.id, parseNumber(e.target.value))}
                              aria-label="Cantidad"
                            />
                            <button type="button" onClick={() => setQuantity(line.product.id, line.quantity + 1)}>+</button>
                          </div>
                          <div className="pos-disc">
                            <input
                              inputMode="decimal"
                              placeholder="Desc."
                              value={line.discountValue}
                              onChange={(e) => updateLine(line.product.id, { discountValue: e.target.value })}
                              aria-label="Descuento del producto"
                            />
                            <select
                              value={line.discountType}
                              onChange={(e) => updateLine(line.product.id, { discountType: e.target.value as DiscountType })}
                              aria-label="Tipo de descuento"
                            >
                              <option value="percent">%</option>
                              <option value="amount">$</option>
                            </select>
                          </div>
                          <strong className="pos-line-total">{money(amounts.total)}</strong>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="pos-summary">
                <div className="pos-disc pos-cart-disc">
                  <span>Descuento general</span>
                  <input
                    inputMode="decimal"
                    placeholder="0"
                    value={cartDiscValue}
                    onChange={(e) => setCartDiscValue(e.target.value)}
                    aria-label="Descuento general"
                  />
                  <select value={cartDiscType} onChange={(e) => setCartDiscType(e.target.value as DiscountType)} aria-label="Tipo de descuento general">
                    <option value="percent">%</option>
                    <option value="amount">$</option>
                  </select>
                </div>

                <div className="pos-sum-row"><span>Subtotal</span><strong>{money(totals.subtotal)}</strong></div>
                <div className="pos-sum-row"><span>Descuentos</span><strong>-{money(totals.itemDiscount + totals.cartDiscount)}</strong></div>
                <div className="pos-sum-row pos-total"><span>Total</span><strong>{money(totals.total)}</strong></div>

                <label className="form-field">
                  <span>Método de pago</span>
                  <select value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                    {methods.map((m) => <option value={m.id} key={m.id}>{m.name}</option>)}
                  </select>
                </label>
                <label className="form-field">
                  <span>Nota (opcional)</span>
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>

                <button
                  type="button"
                  className="button button-dark pos-charge"
                  disabled={charging || cart.length === 0}
                  onClick={() => void charge()}
                >
                  {charging ? "Registrando..." : `Cobrar ${money(totals.total)}`}
                </button>
              </div>
            </aside>
          </section>
        )}

        {tab === "history" && (
          <>
            <section className="compact-metrics">
              <CompactMetric icon="orders" tone="purple" label="Ventas" value={String(summary.count)} />
              <CompactMetric icon="money" tone="green" label="Total vendido" value={money(summary.total)} />
              <CompactMetric icon="reports" tone="blue" label="Ganancia" value={money(summary.profit)} />
              <CompactMetric icon="credit" tone="red" label="Ticket promedio" value={money(summary.average)} />
            </section>

            <section className="filter-bar pos-date-filters">
              <label className="pos-date">
                <span>Desde</span>
                <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="pos-date">
                <span>Hasta</span>
                <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
              </label>
              <button className="button modal-secondary" type="button" onClick={() => quickRange(0)}>Hoy</button>
              <button className="button modal-secondary" type="button" onClick={() => quickRange(1)}>Ayer y hoy</button>
              <button className="button modal-secondary" type="button" onClick={() => quickRange(6)}>7 días</button>
              <button className="button modal-secondary" type="button" onClick={() => quickRange(29)}>30 días</button>
            </section>

            <section className="content-card">
              {salesLoading ? (
                <p className="muted-small pos-pad">Cargando ventas...</p>
              ) : sales.length === 0 ? (
                <div className="clients-empty">
                  <strong>No hay ventas en ese período</strong>
                  <p>Probá con otro rango de fechas.</p>
                </div>
              ) : (
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>N°</th>
                        <th>Fecha</th>
                        <th>Pago</th>
                        <th>Descuento</th>
                        <th>Total</th>
                        <th>Ganancia</th>
                        <th>Estado</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {sales.map((s) => (
                        <tr key={s.id} className={s.status === "cancelled" ? "pos-row-inactive" : ""}>
                          <td><strong>#{s.sale_number}</strong></td>
                          <td>{dateTime(s.sold_at)}</td>
                          <td>{s.payment_method_name || "—"}</td>
                          <td className="money">{s.discount_total > 0 ? `-${money(s.discount_total)}` : "—"}</td>
                          <td className="money"><strong>{money(s.total)}</strong></td>
                          <td className="money">{money(s.profit)}</td>
                          <td>
                            {s.status === "cancelled" ? (
                              <span className="status-pill status-gray">Anulada</span>
                            ) : (
                              <span className="status-pill status-green">Cobrada</span>
                            )}
                          </td>
                          <td>
                            <button className="button modal-secondary" type="button" onClick={() => { setSelected(s); setCancelReason(""); setError(""); }}>
                              Ver detalle
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {selected && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(e) => {
              if (e.currentTarget === e.target) setSelected(null);
            }}
          >
            <div className="modal-card">
              <div className="modal-head">
                <div>
                  <span>VENTA #{selected.sale_number}</span>
                  <h3>{dateTime(selected.sold_at)}</h3>
                </div>
                <button type="button" className="modal-close" onClick={() => setSelected(null)}>×</button>
              </div>

              {error && <div className="form-message error">{error}</div>}

              <div className="pos-detail">
                {selected.items.map((item) => (
                  <div className="pos-sum-row" key={item.id}>
                    <span>{qtyFmt(item.quantity)} × {item.name}</span>
                    <strong>{money(item.total)}</strong>
                  </div>
                ))}
                <div className="pos-sum-row"><span>Subtotal</span><strong>{money(selected.subtotal)}</strong></div>
                <div className="pos-sum-row"><span>Descuentos</span><strong>-{money(selected.discount_total)}</strong></div>
                <div className="pos-sum-row pos-total"><span>Total ({selected.payment_method_name || "—"})</span><strong>{money(selected.total)}</strong></div>
                {selected.notes && <p className="muted-small">Nota: {selected.notes}</p>}
                {selected.status === "cancelled" && (
                  <p className="muted-small">Anulada: {selected.cancel_reason}</p>
                )}
              </div>

              {selected.status === "completed" && (
                <div className="client-form-grid">
                  <label className="form-field full-field">
                    <span>Anular esta venta (devuelve el stock y revierte la caja)</span>
                    <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Motivo de la anulación" />
                  </label>
                </div>
              )}

              <div className="modal-actions">
                <button type="button" className="button modal-secondary" onClick={() => setSelected(null)}>Cerrar</button>
                {selected.status === "completed" && (
                  <button type="button" className="button button-dark" onClick={() => void doCancel()}>
                    Anular venta
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </ModuleGate>
  );
}
