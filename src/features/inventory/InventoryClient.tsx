"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CompactMetric } from "@/components/Metric";
import { Icon } from "@/components/Icon";
import { Topbar } from "@/components/Topbar";
import { useTenant } from "@/contexts/TenantContext";
import { materials as demoMaterials, money as demoMoney } from "@/lib/demo-data";
import { demoMode } from "@/lib/runtime";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { listPaymentMethods, type PaymentMethod } from "@/services/cash";
import {
  archiveMaterial,
  createMaterial,
  createSupplier,
  getInventoryOverview,
  listInventoryOrders,
  listMaterialMovements,
  listMaterials,
  listSuppliers,
  recordStockMovement,
  restoreMaterial,
  updateMaterial,
  type InventoryOverview,
  type MaterialInput,
  type MaterialSummary,
  type OrderLookup,
  type StockMovement,
  type StockMovementInput,
  type SupplierLookup
} from "@/services/inventory";

const EMPTY_OVERVIEW: InventoryOverview = {
  material_count: 0,
  low_stock_count: 0,
  inventory_value: 0,
  movements_today: 0
};

const EMPTY_MATERIAL: MaterialInput = {
  code: "",
  name: "",
  category: "",
  unit: "unidad",
  minimum_stock: 0,
  unit_cost: 0,
  location: "",
  notes: "",
  supplier_id: null
};

const EMPTY_MOVEMENT: StockMovementInput = {
  movement_type: "in",
  quantity: 1,
  reason: "Compra",
  unit_cost: null,
  order_id: null,
  supplier_id: null,
  notes: "",
  register_cash_expense: false,
  payment_method_id: null
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Error inesperado.");
  }
  return "Ocurrió un error inesperado.";
}

function demoRows(): MaterialSummary[] {
  return demoMaterials.map((material, index) => ({
    id: `demo-material-${index}`,
    code: material.code,
    name: material.name,
    category: material.category,
    unit: material.unit,
    current_stock: material.stock,
    minimum_stock: material.minimum,
    unit_cost: material.cost,
    inventory_value: material.stock * material.cost,
    location: index % 2 === 0 ? "Depósito A" : "Estante principal",
    notes: null,
    supplier_id: null,
    supplier_name: material.supplier,
    is_active: true,
    stock_status: material.stock <= material.minimum ? "low" : "ok",
    updated_at: new Date().toISOString()
  }));
}

function fmtQuantity(value: number) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(value);
}

function movementLabel(value: string) {
  if (value === "in") return "Entrada";
  if (value === "out") return "Salida";
  return "Ajuste";
}

function movementTone(value: string, quantity: number) {
  if (value === "in" || quantity > 0) return "status-green";
  if (value === "out" || quantity < 0) return "status-red";
  return "status-gray";
}

export function InventoryClient() {
  const { currentCompany, settings } = useTenant();

  const [materials, setMaterials] = useState<MaterialSummary[]>(demoMode ? demoRows() : []);
  const [overview, setOverview] = useState<InventoryOverview>(demoMode ? {
    material_count: demoRows().length,
    low_stock_count: demoRows().filter((item) => item.stock_status === "low").length,
    inventory_value: demoRows().reduce((sum, item) => sum + item.inventory_value, 0),
    movements_today: 3
  } : EMPTY_OVERVIEW);
  const [suppliers, setSuppliers] = useState<SupplierLookup[]>([]);
  const [orders, setOrders] = useState<OrderLookup[]>([]);
  const [cashMethods, setCashMethods] = useState<PaymentMethod[]>([]);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [materialOpen, setMaterialOpen] = useState(false);
  const [editing, setEditing] = useState<MaterialSummary | null>(null);
  const [materialForm, setMaterialForm] = useState<MaterialInput>(EMPTY_MATERIAL);
  const [savingMaterial, setSavingMaterial] = useState(false);
  const [quickSupplier, setQuickSupplier] = useState("");

  const [selected, setSelected] = useState<MaterialSummary | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);

  const [movementOpen, setMovementOpen] = useState(false);
  const [movementForm, setMovementForm] = useState<StockMovementInput>(EMPTY_MOVEMENT);
  const [savingMovement, setSavingMovement] = useState(false);

  const locale = settings?.locale || "es-AR";
  const currency = settings?.currency || "ARS";
  const money = (value: number) =>
    demoMode
      ? demoMoney(value)
      : new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
          maximumFractionDigits: 0
        }).format(value);

  const categories = useMemo(
    () => Array.from(new Set(materials.map((item) => item.category).filter(Boolean))).sort() as string[],
    [materials]
  );

  async function load() {
    if (demoMode) {
      let rows = demoRows();
      const term = search.trim().toLowerCase();
      if (term) {
        rows = rows.filter((item) =>
          [item.name, item.code, item.category, item.supplier_name, item.location]
            .some((value) => String(value ?? "").toLowerCase().includes(term))
        );
      }
      if (category) rows = rows.filter((item) => item.category === category);
      if (stockFilter === "low") rows = rows.filter((item) => item.stock_status === "low");
      if (stockFilter === "ok") rows = rows.filter((item) => item.stock_status === "ok");
      if (stockFilter === "inactive") rows = rows.filter((item) => !item.is_active);
      setMaterials(rows);
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;
    setLoading(true);
    setError("");
    try {
      const [rows, summary] = await Promise.all([
        listMaterials(supabaseBrowser, currentCompany.id, {
          search,
          category,
          stock: stockFilter
        }),
        getInventoryOverview(supabaseBrowser, currentCompany.id)
      ]);
      setMaterials(rows);
      setOverview(summary);

      if (selected) {
        const refreshed = rows.find((item) => item.id === selected.id);
        if (refreshed) setSelected(refreshed);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadLookups() {
    if (demoMode || !supabaseBrowser || !currentCompany) return;
    try {
      const [supplierRows, orderRows, paymentRows] = await Promise.all([
        listSuppliers(supabaseBrowser, currentCompany.id),
        listInventoryOrders(supabaseBrowser, currentCompany.id),
        listPaymentMethods(supabaseBrowser, currentCompany.id).catch(() => [])
      ]);
      setSuppliers(supplierRows);
      setOrders(orderRows);
      setCashMethods(paymentRows);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    void loadLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 240);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id, search, category, stockFilter]);

  function openNewMaterial() {
    setEditing(null);
    setMaterialForm(EMPTY_MATERIAL);
    setQuickSupplier("");
    setMaterialOpen(true);
    setError("");
  }

  function openEditMaterial(material: MaterialSummary) {
    setEditing(material);
    setMaterialForm({
      code: material.code ?? "",
      name: material.name,
      category: material.category ?? "",
      unit: material.unit,
      minimum_stock: material.minimum_stock,
      unit_cost: material.unit_cost,
      location: material.location ?? "",
      notes: material.notes ?? "",
      supplier_id: material.supplier_id
    });
    setQuickSupplier("");
    setMaterialOpen(true);
    setError("");
  }

  async function saveMaterial(event: FormEvent) {
    event.preventDefault();
    if (!materialForm.name.trim()) {
      setError("El material necesita un nombre.");
      return;
    }
    if (!materialForm.unit.trim()) {
      setError("Indicá la unidad de medida.");
      return;
    }
    if (materialForm.minimum_stock < 0 || materialForm.unit_cost < 0) {
      setError("Stock mínimo y costo no pueden ser negativos.");
      return;
    }

    if (demoMode) {
      setMaterialOpen(false);
      setSuccess(editing ? "Material actualizado en modo demo." : "Material creado en modo demo.");
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;

    setSavingMaterial(true);
    setError("");
    try {
      let supplierId = materialForm.supplier_id || null;

      if (!supplierId && quickSupplier.trim()) {
        const created = await createSupplier(supabaseBrowser, currentCompany.id, quickSupplier);
        supplierId = created.id;
        setSuppliers((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      }

      const payload = { ...materialForm, supplier_id: supplierId };
      if (editing) {
        await updateMaterial(supabaseBrowser, currentCompany.id, editing.id, payload);
        setSuccess("Material actualizado.");
      } else {
        await createMaterial(supabaseBrowser, currentCompany.id, payload);
        setSuccess("Material creado. Cargá el stock inicial con una entrada.");
      }
      setMaterialOpen(false);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingMaterial(false);
    }
  }

  async function openDetail(material: MaterialSummary) {
    setSelected(material);
    setMovements([]);
    if (demoMode) {
      setMovements([
        {
          id: "demo-mov-1",
          movement_type: "in",
          quantity: 50,
          reason: "Compra",
          unit_cost: material.unit_cost,
          balance_after: material.current_stock + 10,
          notes: null,
          order_id: null,
          order_number: null,
          supplier_id: null,
          supplier_name: material.supplier_name,
          created_by: null,
          created_by_name: "Administrador",
          created_at: new Date().toISOString()
        },
        {
          id: "demo-mov-2",
          movement_type: "out",
          quantity: -10,
          reason: "Producción",
          unit_cost: material.unit_cost,
          balance_after: material.current_stock,
          notes: "Consumo de pedido",
          order_id: "demo-order",
          order_number: 251,
          supplier_id: null,
          supplier_name: null,
          created_by: null,
          created_by_name: "Producción",
          created_at: new Date(Date.now() - 86400000).toISOString()
        }
      ]);
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;
    setMovementsLoading(true);
    try {
      setMovements(await listMaterialMovements(supabaseBrowser, currentCompany.id, material.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setMovementsLoading(false);
    }
  }

  function openMovement(material: MaterialSummary, type: StockMovementInput["movement_type"] = "in") {
    setSelected(material);
    setMovementForm({
      ...EMPTY_MOVEMENT,
      movement_type: type,
      reason: type === "in" ? "Compra" : type === "out" ? "Producción" : "Ajuste manual",
      unit_cost: type === "in" ? material.unit_cost : null,
      supplier_id: type === "in" ? material.supplier_id : null,
      register_cash_expense: false,
      payment_method_id: cashMethods[0]?.id ?? null
    });
    setMovementOpen(true);
    setError("");
  }

  async function saveMovement(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (!movementForm.reason.trim()) {
      setError("Indicá el motivo del movimiento.");
      return;
    }
    if (movementForm.quantity === 0) {
      setError("La cantidad no puede ser cero.");
      return;
    }
    if (movementForm.movement_type !== "adjustment" && movementForm.quantity < 0) {
      setError("Para entrada o salida ingresá una cantidad positiva.");
      return;
    }
    if (movementForm.movement_type === "out" && movementForm.quantity > selected.current_stock) {
      // La base puede permitir negativo según configuración; mostramos aviso pero dejamos
      // que PostgreSQL decida según company_settings.allow_negative_stock.
    }
    if (
      movementForm.movement_type === "in" &&
      movementForm.register_cash_expense &&
      !movementForm.payment_method_id
    ) {
      setError("Elegí el medio de pago para registrar el egreso en caja.");
      return;
    }

    if (demoMode) {
      setMovementOpen(false);
      setSuccess("Movimiento registrado en modo demo.");
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;

    setSavingMovement(true);
    setError("");
    try {
      await recordStockMovement(
        supabaseBrowser,
        currentCompany.id,
        selected.id,
        movementForm
      );
      setMovementOpen(false);
      setSuccess("Movimiento de stock registrado.");
      await load();
      const refreshed = await listMaterialMovements(supabaseBrowser, currentCompany.id, selected.id);
      setMovements(refreshed);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingMovement(false);
    }
  }

  async function toggleArchive(material: MaterialSummary) {
    if (demoMode) {
      setSuccess(material.is_active ? "Material archivado en modo demo." : "Material restaurado en modo demo.");
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;
    try {
      if (material.is_active) {
        await archiveMaterial(supabaseBrowser, currentCompany.id, material.id);
        setSuccess("Material archivado. Su historial se conserva.");
      } else {
        await restoreMaterial(supabaseBrowser, currentCompany.id, material.id);
        setSuccess("Material restaurado.");
      }
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const activeRows = materials.filter((item) => item.is_active);

  return (
    <>
      <Topbar eyebrow="Inventario" title="Materiales" />

      <div className="page-content page-stack inventory-page-real">
        <section className="module-intro inventory-intro">
          <div className="module-copy">
            <span className="module-kicker">INVENTARIO EN TIEMPO REAL</span>
            <h2>
              Cada insumo, <span>bajo control.</span>
            </h2>
            <p>
              Registrá entradas, consumos y ajustes con trazabilidad por pedido. GestArt calcula stock, valor y alertas automáticamente.
            </p>
          </div>
          <div className="module-actions">
            <button className="button button-dark" type="button" onClick={openNewMaterial}>
              <Icon name="plus" size={14} /> Nuevo material
            </button>
          </div>
        </section>

        {(error || success) && (
          <div className={`form-message ${error ? "error" : "success"}`}>
            {error || success}
          </div>
        )}

        <section className="compact-metrics">
          <CompactMetric icon="materials" tone="purple" label="Materiales activos" value={String(overview.material_count)} />
          <CompactMetric icon="alert" tone="red" label="Stock bajo" value={String(overview.low_stock_count)} />
          <CompactMetric icon="money" tone="green" label="Valor inventario" value={money(overview.inventory_value)} />
          <CompactMetric icon="history" tone="blue" label="Movimientos hoy" value={String(overview.movements_today)} />
        </section>

        <section className="filter-bar inventory-filters">
          <label className="filter-search">
            <Icon name="search" size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar código, material, categoría o proveedor..."
            />
          </label>

          <select className="filter-select" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">Todas las categorías</option>
            {categories.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>

          <select className="filter-select" value={stockFilter} onChange={(event) => setStockFilter(event.target.value)}>
            <option value="">Todo el stock</option>
            <option value="low">Stock bajo</option>
            <option value="ok">Disponible</option>
            <option value="inactive">Archivados</option>
          </select>

          {(search || category || stockFilter) && (
            <button
              className="button modal-secondary"
              type="button"
              onClick={() => { setSearch(""); setCategory(""); setStockFilter(""); }}
            >
              Limpiar
            </button>
          )}
        </section>

        <section className="content-card inventory-table-card">
          {loading ? (
            <div className="inventory-loading">
              {[0,1,2,3,4].map((item) => <div key={item}><span/><span/><span/><span/><span/></div>)}
            </div>
          ) : materials.length === 0 ? (
            <div className="clients-empty">
              <span><Icon name="materials" size={24} /></span>
              <strong>No hay materiales para mostrar</strong>
              <p>Creá el primer insumo y registrá su stock inicial con una entrada.</p>
              <button className="button button-dark" type="button" onClick={openNewMaterial}>
                <Icon name="plus" size={14} /> Crear material
              </button>
            </div>
          ) : (
            <div className="data-table-wrap inventory-table-wrap">
              <table className="data-table inventory-table">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Categoría</th>
                    <th>Stock</th>
                    <th>Mínimo</th>
                    <th>Costo</th>
                    <th>Valor</th>
                    <th>Proveedor</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {materials.map((material) => (
                    <tr key={material.id} className={!material.is_active ? "inventory-row-inactive" : ""}>
                      <td>
                        <button className="client-link" type="button" onClick={() => void openDetail(material)}>
                          <span className="inventory-material-icon"><Icon name="materials" size={16} /></span>
                          <span>
                            <strong>{material.name}</strong>
                            <small>{material.code || "Sin código"} · {material.location || "Sin ubicación"}</small>
                          </span>
                        </button>
                      </td>
                      <td>{material.category || "—"}</td>
                      <td>
                        <strong className={material.stock_status === "low" ? "inventory-stock-low" : ""}>
                          {fmtQuantity(material.current_stock)} {material.unit}
                        </strong>
                      </td>
                      <td>{fmtQuantity(material.minimum_stock)} {material.unit}</td>
                      <td className="money">{money(material.unit_cost)}</td>
                      <td className="money"><strong>{money(material.inventory_value)}</strong></td>
                      <td>{material.supplier_name || "—"}</td>
                      <td>
                        {!material.is_active ? (
                          <span className="status-pill status-gray">Archivado</span>
                        ) : material.stock_status === "low" ? (
                          <span className="status-pill status-red">Stock bajo</span>
                        ) : (
                          <span className="status-pill status-green">Disponible</span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions inventory-row-actions">
                          {material.is_active && (
                            <>
                              <button type="button" title="Entrada" onClick={() => openMovement(material, "in")}>+ Stock</button>
                              <button type="button" title="Salida" onClick={() => openMovement(material, "out")}>- Stock</button>
                            </>
                          )}
                          <button type="button" onClick={() => void openDetail(material)}>Ver</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {materialOpen && (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.currentTarget === event.target) setMaterialOpen(false);
          }}>
            <form className="modal-card inventory-form-modal" onSubmit={saveMaterial}>
              <div className="modal-head">
                <div>
                  <span>INVENTARIO</span>
                  <h3>{editing ? "Editar material" : "Nuevo material"}</h3>
                </div>
                <button type="button" className="modal-close" onClick={() => setMaterialOpen(false)}>×</button>
              </div>

              <div className="client-form-grid">
                <label className="form-field">
                  <span>Nombre *</span>
                  <input value={materialForm.name} onChange={(e) => setMaterialForm({ ...materialForm, name: e.target.value })} placeholder="Papel ilustración 300g" />
                </label>
                <label className="form-field">
                  <span>Código</span>
                  <input value={materialForm.code || ""} onChange={(e) => setMaterialForm({ ...materialForm, code: e.target.value })} placeholder="PAP-300" />
                </label>
                <label className="form-field">
                  <span>Categoría</span>
                  <input value={materialForm.category || ""} onChange={(e) => setMaterialForm({ ...materialForm, category: e.target.value })} placeholder="Papeles" />
                </label>
                <label className="form-field">
                  <span>Unidad *</span>
                  <input value={materialForm.unit} onChange={(e) => setMaterialForm({ ...materialForm, unit: e.target.value })} placeholder="hojas, m², litros..." />
                </label>
                <label className="form-field">
                  <span>Stock mínimo</span>
                  <input type="number" min="0" step="0.001" value={materialForm.minimum_stock} onChange={(e) => setMaterialForm({ ...materialForm, minimum_stock: Number(e.target.value) })} />
                </label>
                <label className="form-field">
                  <span>Costo unitario</span>
                  <input type="number" min="0" step="0.01" value={materialForm.unit_cost} onChange={(e) => setMaterialForm({ ...materialForm, unit_cost: Number(e.target.value) })} />
                </label>
                <label className="form-field">
                  <span>Proveedor</span>
                  <select value={materialForm.supplier_id || ""} onChange={(e) => setMaterialForm({ ...materialForm, supplier_id: e.target.value || null })}>
                    <option value="">Sin proveedor</option>
                    {suppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}
                  </select>
                </label>
                <label className="form-field">
                  <span>Proveedor nuevo rápido</span>
                  <input value={quickSupplier} onChange={(e) => setQuickSupplier(e.target.value)} placeholder="Solo si no existe" disabled={Boolean(materialForm.supplier_id)} />
                </label>
                <label className="form-field">
                  <span>Ubicación</span>
                  <input value={materialForm.location || ""} onChange={(e) => setMaterialForm({ ...materialForm, location: e.target.value })} placeholder="Depósito A · Estante 3" />
                </label>
                <label className="form-field full-field">
                  <span>Observaciones</span>
                  <textarea rows={3} value={materialForm.notes || ""} onChange={(e) => setMaterialForm({ ...materialForm, notes: e.target.value })} />
                </label>
              </div>

              <div className="modal-actions">
                <button className="button modal-secondary" type="button" onClick={() => setMaterialOpen(false)}>Cancelar</button>
                <button className="button button-dark" type="submit" disabled={savingMaterial}>
                  {savingMaterial ? "Guardando..." : editing ? "Guardar cambios" : "Crear material"}
                </button>
              </div>
            </form>
          </div>
        )}

        {selected && (
          <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelected(null);
          }}>
            <aside className="client-drawer inventory-drawer">
              <div className="drawer-head">
                <div className="drawer-client">
                  <span className="client-avatar large"><Icon name="materials" size={20} /></span>
                  <div>
                    <span>MATERIAL</span>
                    <h3>{selected.name}</h3>
                    <p>{selected.code || "Sin código"} · {selected.category || "Sin categoría"}</p>
                  </div>
                </div>
                <button type="button" className="modal-close" onClick={() => setSelected(null)}>×</button>
              </div>

              <div className="drawer-actions inventory-drawer-actions">
                {selected.is_active && (
                  <>
                    <button className="button button-dark" type="button" onClick={() => openMovement(selected, "in")}>+ Entrada</button>
                    <button className="button modal-secondary" type="button" onClick={() => openMovement(selected, "out")}>- Salida</button>
                    <button className="button modal-secondary" type="button" onClick={() => openMovement(selected, "adjustment")}>Ajuste</button>
                  </>
                )}
                <button className="button modal-secondary" type="button" onClick={() => openEditMaterial(selected)}>Editar</button>
              </div>

              <div className="client-detail-metrics inventory-detail-metrics">
                <div><span>Stock actual</span><strong className={selected.stock_status === "low" ? "balance-due" : ""}>{fmtQuantity(selected.current_stock)} {selected.unit}</strong></div>
                <div><span>Stock mínimo</span><strong>{fmtQuantity(selected.minimum_stock)} {selected.unit}</strong></div>
                <div><span>Costo unitario</span><strong>{money(selected.unit_cost)}</strong></div>
                <div><span>Valor</span><strong>{money(selected.inventory_value)}</strong></div>
              </div>

              {selected.stock_status === "low" && selected.is_active && (
                <div className="inventory-low-alert">
                  <Icon name="alert" size={18} />
                  <div>
                    <strong>Stock bajo</strong>
                    <span>El material está en o por debajo del mínimo configurado.</span>
                  </div>
                </div>
              )}

              <section className="drawer-section">
                <h4>Información</h4>
                <div className="contact-grid">
                  <div><span>Proveedor</span><strong>{selected.supplier_name || "—"}</strong></div>
                  <div><span>Ubicación</span><strong>{selected.location || "—"}</strong></div>
                  <div><span>Estado</span><strong>{selected.is_active ? "Activo" : "Archivado"}</strong></div>
                  <div><span>Unidad</span><strong>{selected.unit}</strong></div>
                  <div className="full"><span>Observaciones</span><strong>{selected.notes || "Sin observaciones"}</strong></div>
                </div>
              </section>

              <section className="drawer-section">
                <div className="drawer-section-head">
                  <h4>Historial de stock</h4>
                  <span>{movements.length}</span>
                </div>

                {movementsLoading ? (
                  <p className="muted-small">Cargando movimientos...</p>
                ) : movements.length === 0 ? (
                  <p className="muted-small">Todavía no hay movimientos registrados.</p>
                ) : (
                  <div className="inventory-movement-list">
                    {movements.map((movement) => (
                      <div className="inventory-movement-row" key={movement.id}>
                        <div className={`inventory-movement-sign ${movementTone(movement.movement_type, movement.quantity)}`}>
                          {movement.quantity > 0 ? "+" : ""}{fmtQuantity(movement.quantity)}
                        </div>
                        <div className="inventory-movement-main">
                          <strong>{movementLabel(movement.movement_type)} · {movement.reason}</strong>
                          <span>
                            {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(movement.created_at))}
                            {movement.order_number ? ` · Pedido #${String(movement.order_number).padStart(5, "0")}` : ""}
                            {movement.supplier_name ? ` · ${movement.supplier_name}` : ""}
                          </span>
                          {movement.notes && <small>{movement.notes}</small>}
                        </div>
                        <div className="inventory-movement-balance">
                          <span>Saldo</span>
                          <strong>{movement.balance_after == null ? "—" : fmtQuantity(movement.balance_after)}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="drawer-section inventory-archive-section">
                <button
                  className={`button ${selected.is_active ? "inventory-archive-button" : "button-dark"}`}
                  type="button"
                  onClick={() => void toggleArchive(selected)}
                >
                  {selected.is_active ? "Archivar material" : "Restaurar material"}
                </button>
                <p>El historial nunca se elimina: archivar solo oculta el material de la operación normal.</p>
              </section>
            </aside>
          </div>
        )}

        {movementOpen && selected && (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.currentTarget === event.target) setMovementOpen(false);
          }}>
            <form className="modal-card inventory-movement-modal" onSubmit={saveMovement}>
              <div className="modal-head">
                <div>
                  <span>MOVIMIENTO DE STOCK</span>
                  <h3>{selected.name}</h3>
                </div>
                <button type="button" className="modal-close" onClick={() => setMovementOpen(false)}>×</button>
              </div>

              <div className="inventory-current-stock">
                <span>Stock actual</span>
                <strong>{fmtQuantity(selected.current_stock)} {selected.unit}</strong>
              </div>

              <div className="client-form-grid">
                <label className="form-field">
                  <span>Tipo *</span>
                  <select
                    value={movementForm.movement_type}
                    onChange={(e) => {
                      const type = e.target.value as StockMovementInput["movement_type"];
                      setMovementForm({
                        ...movementForm,
                        movement_type: type,
                        reason: type === "in" ? "Compra" : type === "out" ? "Producción" : "Ajuste manual",
                        order_id: type === "out" ? movementForm.order_id : null,
                        supplier_id: type === "in" ? (movementForm.supplier_id || selected.supplier_id) : null,
                        unit_cost: type === "in" ? selected.unit_cost : null
                      });
                    }}
                  >
                    <option value="in">Entrada</option>
                    <option value="out">Salida</option>
                    <option value="adjustment">Ajuste</option>
                  </select>
                </label>

                <label className="form-field">
                  <span>Cantidad *</span>
                  <input
                    type="number"
                    step="0.001"
                    value={movementForm.quantity}
                    onChange={(e) => setMovementForm({ ...movementForm, quantity: Number(e.target.value) })}
                  />
                  {movementForm.movement_type === "adjustment" && <small>En ajuste podés usar cantidad positiva o negativa.</small>}
                </label>

                <label className="form-field full-field">
                  <span>Motivo *</span>
                  <input value={movementForm.reason} onChange={(e) => setMovementForm({ ...movementForm, reason: e.target.value })} placeholder="Compra, producción, corrección..." />
                </label>

                {movementForm.movement_type === "in" && (
                  <>
                    <label className="form-field">
                      <span>Costo unitario</span>
                      <input type="number" min="0" step="0.01" value={movementForm.unit_cost ?? ""} onChange={(e) => setMovementForm({ ...movementForm, unit_cost: e.target.value === "" ? null : Number(e.target.value) })} />
                    </label>
                    <label className="form-field">
                      <span>Proveedor</span>
                      <select value={movementForm.supplier_id || ""} onChange={(e) => setMovementForm({ ...movementForm, supplier_id: e.target.value || null })}>
                        <option value="">Sin proveedor</option>
                        {suppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}
                      </select>
                    </label>
                  </>
                )}

                {movementForm.movement_type === "out" && (
                  <label className="form-field full-field">
                    <span>Vincular a pedido</span>
                    <select value={movementForm.order_id || ""} onChange={(e) => setMovementForm({ ...movementForm, order_id: e.target.value || null })}>
                      <option value="">Salida sin pedido</option>
                      {orders.map((order) => (
                        <option value={order.id} key={order.id}>
                          #{String(order.order_number).padStart(5, "0")} · {order.client_name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {movementForm.movement_type === "in" && cashMethods.length > 0 && (
                  <>
                    <label className="inventory-cash-check full-field">
                      <input
                        type="checkbox"
                        checked={Boolean(movementForm.register_cash_expense)}
                        onChange={(e) => setMovementForm({
                          ...movementForm,
                          register_cash_expense: e.target.checked,
                          payment_method_id: e.target.checked
                            ? (movementForm.payment_method_id || cashMethods[0]?.id || null)
                            : null
                        })}
                      />
                      <span>
                        <strong>Registrar también el egreso en Caja</strong>
                        <small>La compra impactará stock + caja + historial en una misma operación.</small>
                      </span>
                    </label>

                    {movementForm.register_cash_expense && (
                      <label className="form-field full-field">
                        <span>Medio de pago del egreso *</span>
                        <select
                          value={movementForm.payment_method_id || ""}
                          onChange={(e) => setMovementForm({ ...movementForm, payment_method_id: e.target.value || null })}
                        >
                          <option value="">Seleccionar</option>
                          {cashMethods.map((method) => <option value={method.id} key={method.id}>{method.name}</option>)}
                        </select>
                      </label>
                    )}
                  </>
                )}

                <label className="form-field full-field">
                  <span>Observaciones</span>
                  <textarea rows={3} value={movementForm.notes || ""} onChange={(e) => setMovementForm({ ...movementForm, notes: e.target.value })} />
                </label>
              </div>

              <div className="inventory-stock-preview">
                <span>Stock resultante estimado</span>
                <strong>
                  {fmtQuantity(
                    selected.current_stock +
                    (movementForm.movement_type === "in"
                      ? Math.abs(movementForm.quantity)
                      : movementForm.movement_type === "out"
                        ? -Math.abs(movementForm.quantity)
                        : movementForm.quantity)
                  )} {selected.unit}
                </strong>
              </div>

              <div className="modal-actions">
                <button className="button modal-secondary" type="button" onClick={() => setMovementOpen(false)}>Cancelar</button>
                <button className="button button-dark" type="submit" disabled={savingMovement}>
                  {savingMovement ? "Registrando..." : "Registrar movimiento"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </>
  );
}
