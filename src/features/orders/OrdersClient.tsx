"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CompactMetric } from "@/components/Metric";
import { Icon } from "@/components/Icon";
import { Topbar } from "@/components/Topbar";
import { useTenant } from "@/contexts/TenantContext";
import { clients as demoClients, money as demoMoney, orders as demoOrders } from "@/lib/demo-data";
import { demoMode } from "@/lib/runtime";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { listClients, type ClientSummary } from "@/services/clients";
import { buildCompanyDocumentProfile, loadDocumentClient, loadDocumentPaymentMethods, logDocumentAction, type DocumentClient } from "@/services/documents";
import { downloadOrderPdf, printOrderDocument } from "@/lib/documents/generator";
import {
  cancelOrder,
  changeOrderStatus,
  createOrder,
  listOrders,
  listPaymentMethods,
  loadOrderDetail,
  registerMixedPayment,
  updateOrder,
  type OrderDetail,
  type OrderInput,
  type OrderPriority,
  type OrderStatus,
  type OrderSummary,
  type PaymentLineInput,
  type PaymentMethod
} from "@/services/orders";

const STATUS_OPTIONS: Array<{ value: OrderStatus; label: string }> = [
  { value: "budget", label: "Presupuesto" },
  { value: "pending_payment", label: "Pendiente de pago" },
  { value: "confirmed", label: "Confirmado" },
  { value: "design", label: "Diseño" },
  { value: "waiting_approval", label: "Esperando aprobación" },
  { value: "approved", label: "Aprobado" },
  { value: "pending_production", label: "Pendiente de producción" },
  { value: "in_production", label: "En producción" },
  { value: "ready", label: "Listo" },
  { value: "pending_delivery", label: "Pendiente de entrega" },
  { value: "delivered", label: "Entregado" },
  { value: "cancelled", label: "Cancelado" }
];

const PRIORITY_OPTIONS: Array<{ value: OrderPriority; label: string }> = [
  { value: "urgent", label: "Urgente" },
  { value: "high", label: "Alta" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Baja" }
];

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_ORDER: OrderInput = {
  client_id: "",
  order_date: today(),
  delivery_date: "",
  priority: "normal",
  status: "confirmed",
  discount: 0,
  notes: "",
  items: [{ description: "", quantity: 1, unit_price: 0 }]
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Ocurrió un error inesperado.";
}

function statusLabel(value: string) {
  return STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function priorityLabel(value: string) {
  return PRIORITY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function statusClass(value: string) {
  if (["ready", "delivered", "approved"].includes(value)) return "status-green";
  if (["pending_payment", "pending_delivery", "waiting_approval"].includes(value)) return "status-orange";
  if (["in_production", "pending_production"].includes(value)) return "status-purple";
  if (["design", "budget"].includes(value)) return "status-blue";
  if (value === "cancelled") return "status-red";
  return "status-gray";
}

function priorityClass(value: string) {
  if (value === "urgent") return "status-red";
  if (value === "high") return "status-orange";
  if (value === "low") return "status-green";
  return "status-gray";
}

function toDemoOrders(): OrderSummary[] {
  return demoOrders.map((order, index) => ({
    id: `demo-order-${index}`,
    order_number: Number(order.number),
    client_id: demoClients[index % demoClients.length]?.id ?? "demo-client",
    client_name: order.client,
    client_company: null,
    client_phone: null,
    order_date: "2026-08-29",
    delivery_date: order.due.split("/").reverse().join("-"),
    priority: order.priority === "Urgente" ? "urgent" : order.priority === "Alta" ? "high" : "normal",
    status: order.status === "En producción" ? "in_production" : order.status === "Pendiente de entrega" ? "pending_delivery" : order.status === "Diseño" ? "design" : order.status === "Listo" ? "ready" : "confirmed",
    subtotal: order.total,
    discount: 0,
    total: order.total,
    paid: order.paid,
    balance: order.total - order.paid,
    item_count: 1,
    first_item: order.detail,
    notes: null,
    created_at: new Date().toISOString()
  }));
}

export function OrdersClient() {
  const { currentCompany, settings } = useTenant();
  const [orders, setOrders] = useState<OrderSummary[]>(demoMode ? toDemoOrders() : []);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OrderDetail | null>(null);
  const [form, setForm] = useState<OrderInput>(EMPTY_ORDER);
  const [depositAmount, setDepositAmount] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentLines, setPaymentLines] = useState<PaymentLineInput[]>([]);
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [documentBusy, setDocumentBusy] = useState<"pdf" | "print" | null>(null);

  const currency = settings?.currency || "ARS";
  const locale = settings?.locale || "es-AR";
  const money = (value: number) =>
    demoMode
      ? demoMoney(value)
      : new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
          maximumFractionDigits: 0
        }).format(value);

  async function load() {
    if (demoMode) {
      const term = search.toLowerCase().trim();
      let rows = toDemoOrders();
      if (term) rows = rows.filter((order) => [order.client_name, order.first_item, String(order.order_number)].some((value) => value?.toLowerCase().includes(term)));
      if (statusFilter) rows = rows.filter((order) => order.status === statusFilter);
      if (priorityFilter) rows = rows.filter((order) => order.priority === priorityFilter);
      setOrders(rows);
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;

    setLoading(true);
    setError("");
    try {
      setOrders(
        await listOrders(supabaseBrowser, currentCompany.id, {
          search,
          status: statusFilter,
          priority: priorityFilter
        })
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadLookups() {
    if (demoMode || !supabaseBrowser || !currentCompany) return;
    try {
      const [clientRows, methodRows] = await Promise.all([
        listClients(supabaseBrowser, currentCompany.id, ""),
        listPaymentMethods(supabaseBrowser, currentCompany.id)
      ]);
      setClients(clientRows.filter((client) => client.is_active));
      setMethods(methodRows);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    void loadLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 260);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id, search, statusFilter, priorityFilter]);

  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") {
      openNew();
      window.history.replaceState({}, "", "/pedidos");
    }
  }, []);

  const metrics = useMemo(() => ({
    active: orders.filter((order) => !["delivered", "cancelled"].includes(order.status)).length,
    production: orders.filter((order) => order.status === "in_production").length,
    ready: orders.filter((order) => ["ready", "pending_delivery"].includes(order.status)).length,
    receivable: orders.reduce((sum, order) => sum + order.balance, 0)
  }), [orders]);

  const formSubtotal = useMemo(
    () => form.items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.unit_price) || 0), 0),
    [form.items]
  );
  const formTotal = Math.max(formSubtotal - Math.max(0, Number(form.discount) || 0), 0);
  const paymentTotal = paymentLines.reduce((sum, line) => sum + Math.max(0, Number(line.amount) || 0), 0);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_ORDER, order_date: today(), items: [{ description: "", quantity: 1, unit_price: 0 }] });
    setDepositAmount(0);
    setFormOpen(true);
    setError("");
    setSuccess("");
  }

  async function openEdit(summary: OrderSummary) {
    if (demoMode) {
      setError("La edición completa se prueba con Supabase real.");
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;
    setDetailLoading(true);
    setError("");
    try {
      const next = await loadOrderDetail(supabaseBrowser, currentCompany.id, summary.id);
      setEditing(next);
      setForm({
        client_id: next.order.client_id,
        order_date: next.order.order_date,
        delivery_date: next.order.delivery_date ?? "",
        priority: next.order.priority as OrderPriority,
        status: next.order.status as OrderStatus,
        discount: next.order.discount,
        notes: next.order.notes ?? "",
        items: next.items.map((item) => ({
          id: item.id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price
        }))
      });
      setFormOpen(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  }

  function updateItem(index: number, patch: Partial<OrderInput["items"][number]>) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
    }));
  }

  function addItem() {
    setForm((current) => ({
      ...current,
      items: [...current.items, { description: "", quantity: 1, unit_price: 0 }]
    }));
  }

  function removeItem(index: number) {
    setForm((current) => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  async function submitOrder(event: FormEvent) {
    event.preventDefault();
    if (!form.client_id) return setError("Seleccioná un cliente.");
    if (!form.items.length || form.items.some((item) => !item.description.trim())) return setError("Todos los ítems deben tener una descripción.");
    if (form.items.some((item) => Number(item.quantity) <= 0 || Number(item.unit_price) < 0)) return setError("Las cantidades deben ser mayores a cero y los precios no pueden ser negativos.");
    if (Number(form.discount) < 0 || Number(form.discount) > formSubtotal) return setError("El descuento no puede ser negativo ni superar el subtotal.");

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      if (demoMode) {
        setSuccess(editing ? "Pedido actualizado en modo demo." : "Pedido creado en modo demo.");
      } else {
        if (!supabaseBrowser || !currentCompany) throw new Error("No hay una empresa activa.");
        if (editing) {
          await updateOrder(supabaseBrowser, currentCompany.id, editing.order.id, form);
          setSuccess("Pedido actualizado correctamente.");
        } else {
          const newOrderId = await createOrder(supabaseBrowser, currentCompany.id, form);
          setSuccess("Pedido creado correctamente.");

          // Si cargaron una seña / anticipo al crear el pedido, abrimos
          // directamente el formulario de pago con ese monto precargado
          // para no obligar a salir y volver a entrar al pedido.
          if (depositAmount > 0) {
            try {
              const created = await loadOrderDetail(supabaseBrowser, currentCompany.id, newOrderId);
              setDetail(created);
              setPaymentLines([
                {
                  payment_method_id: methods[0]?.id ?? "",
                  amount: Math.min(depositAmount, created.order.balance),
                  reference: ""
                }
              ]);
              setPaymentNotes("Seña inicial del pedido");
              setPaymentOpen(true);
            } catch (depositErr) {
              setError(errorMessage(depositErr));
            }
          }
        }
        await load();
      }
      setFormOpen(false);
      setEditing(null);
      setDepositAmount(0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(summary: OrderSummary) {
    if (demoMode) {
      setDetail({
        order: { ...summary, created_by: null, updated_by: null },
        items: [{ id: "demo", description: summary.first_item ?? "Trabajo", quantity: 1, unit_price: summary.total, total: summary.total, sort_order: 0 }],
        payments: []
      });
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;
    setDetailLoading(true);
    setError("");
    try {
      setDetail(await loadOrderDetail(supabaseBrowser, currentCompany.id, summary.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  }

  function startPayment() {
    if (!detail || detail.order.balance <= 0) return;
    setPaymentLines([{ payment_method_id: methods[0]?.id ?? "", amount: detail.order.balance, reference: "" }]);
    setPaymentNotes("");
    setPaymentOpen(true);
  }

  async function submitPayment(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    if (paymentTotal <= 0) return setError("Ingresá un monto mayor a cero.");
    if (paymentTotal > detail.order.balance + 0.001) return setError("El pago supera el saldo pendiente.");

    setPaymentSaving(true);
    setError("");
    try {
      if (demoMode) {
        setSuccess("Pago registrado en modo demo.");
        setPaymentOpen(false);
      } else {
        if (!supabaseBrowser || !currentCompany) throw new Error("No hay una empresa activa.");
        await registerMixedPayment(supabaseBrowser, currentCompany.id, detail.order.id, paymentLines, paymentNotes);
        const refreshed = await loadOrderDetail(supabaseBrowser, currentCompany.id, detail.order.id);
        setDetail(refreshed);
        setSuccess("Pago registrado. Caja, saldo e historial fueron actualizados.");
        setPaymentOpen(false);
        await load();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPaymentSaving(false);
    }
  }

  async function updateStatus(status: OrderStatus) {
    if (!detail) return;
    setStatusSaving(true);
    setError("");
    try {
      if (demoMode) {
        setDetail({ ...detail, order: { ...detail.order, status } });
      } else {
        if (!supabaseBrowser || !currentCompany) throw new Error("No hay una empresa activa.");
        await changeOrderStatus(supabaseBrowser, currentCompany.id, detail.order.id, status);
        setDetail(await loadOrderDetail(supabaseBrowser, currentCompany.id, detail.order.id));
        await load();
      }
      setSuccess("Estado actualizado.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStatusSaving(false);
    }
  }

  async function exportOrder(action: "pdf" | "print") {
    if (!detail || !currentCompany) return;

    setDocumentBusy(action);
    setError("");
    try {
      const profile = buildCompanyDocumentProfile(currentCompany, settings);
      profile.payment_methods = demoMode
        ? ["Efectivo", "Transferencia", "Mercado Pago"]
        : supabaseBrowser
          ? await loadDocumentPaymentMethods(supabaseBrowser, currentCompany.id)
          : [];
      let client: DocumentClient;

      if (demoMode) {
        const demo = demoClients.find((item) => item.id === detail.order.client_id);
        client = {
          id: detail.order.client_id,
          name: detail.order.client_name,
          company_name: detail.order.client_company || demo?.company || null,
          tax_id: null,
          phone: detail.order.client_phone || demo?.phone || null,
          email: demo?.email || null,
          address: null
        };
      } else {
        if (!supabaseBrowser) return;
        client = await loadDocumentClient(
          supabaseBrowser,
          currentCompany.id,
          detail.order.client_id
        );
      }

      if (action === "pdf") {
        await downloadOrderPdf(profile, detail, client);
      } else {
        printOrderDocument(profile, detail, client);
      }

      if (!demoMode && supabaseBrowser) {
        await logDocumentAction(
          supabaseBrowser,
          currentCompany.id,
          "order",
          detail.order.id,
          action
        );
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDocumentBusy(null);
    }
  }

  async function cancel(summary: OrderSummary) {
    if (!window.confirm(`¿Cancelar el pedido #${String(summary.order_number).padStart(5, "0")}?`)) return;
    setError("");
    try {
      if (demoMode) {
        setOrders((rows) => rows.map((order) => order.id === summary.id ? { ...order, status: "cancelled" } : order));
      } else {
        if (!supabaseBrowser || !currentCompany) throw new Error("No hay una empresa activa.");
        await cancelOrder(supabaseBrowser, currentCompany.id, summary.id);
        await load();
      }
      setSuccess("Pedido cancelado.");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <Topbar eyebrow="Operación" title="Pedidos" />
      <div className="page-content pedidos-page">
        <section className="orders-hero">
          <div className="orders-hero-copy">
            <span className="hero-mini-tag">GESTIÓN DE PEDIDOS</span>
            <h2>Controlá todos tus <span>pedidos</span> desde un solo lugar.</h2>
            <p>Ítems, estados, entregas, pagos parciales y pagos mixtos conectados con caja e historial.</p>
          </div>
          <div className="orders-hero-action">
            <button className="hero-new-order" type="button" onClick={openNew}><Icon name="plus" size={15}/> NUEVO PEDIDO</button>
          </div>
        </section>

        <section className="compact-metrics">
          <CompactMetric icon="orders" tone="purple" label="Pedidos activos" value={String(metrics.active)}/>
          <CompactMetric icon="production" tone="orange" label="En producción" value={String(metrics.production)}/>
          <CompactMetric icon="check" tone="green" label="Listos / entrega" value={String(metrics.ready)}/>
          <CompactMetric icon="money" tone="red" label="Pendiente de cobro" value={money(metrics.receivable)}/>
        </section>

        {error ? <div className="form-message error">{error}</div> : null}
        {success ? <div className="form-message success">{success}</div> : null}

        <section className="filter-bar">
          <label className="filter-search"><Icon name="search" size={14}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar pedido, cliente o teléfono..."/></label>
          <select className="filter-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos los estados</option>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <select className="filter-select" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="">Todas las prioridades</option>{PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <button className="button modal-secondary" type="button" onClick={() => void load()}>Actualizar</button>
        </section>

        <section className="gestart-card order-list-card">
          <div className="gestart-card-body">
            <div className="gestart-card-title"><div><h3>Pedidos</h3><p>{demoMode ? "Datos de demostración." : "Datos reales de la empresa activa."}</p></div><span className="results-counter">{orders.length} resultados</span></div>
            {loading ? <OrderRowsSkeleton/> : orders.length === 0 ? <div className="orders-empty"><span><Icon name="orders" size={24}/></span><strong>No encontramos pedidos</strong><p>Creá el primer pedido o ajustá los filtros.</p><button className="button button-dark" type="button" onClick={openNew}>Nuevo pedido</button></div> : <div className="data-table-wrap"><table className="data-table orders-real-table"><thead><tr><th>Pedido</th><th>Cliente / trabajo</th><th>Prioridad</th><th>Estado</th><th>Entrega</th><th>Pagado</th><th>Saldo</th><th>Total</th><th/></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><button className="order-open" type="button" onClick={() => void openDetail(order)}><strong>#{String(order.order_number).padStart(5,"0")}</strong><small>{order.order_date}</small></button></td><td><strong>{order.client_name}</strong><br/><span className="cell-sub">{order.first_item || `${order.item_count} ítem(s)`}</span></td><td><span className={`status-pill ${priorityClass(order.priority)}`}>{priorityLabel(order.priority)}</span></td><td><span className={`status-pill ${statusClass(order.status)}`}>{statusLabel(order.status)}</span></td><td>{order.delivery_date || "—"}</td><td className="money">{money(order.paid)}</td><td className={`money ${order.balance > 0 ? "balance-due" : ""}`}>{money(order.balance)}</td><td className="money"><strong>{money(order.total)}</strong></td><td><div className="row-actions"><button type="button" onClick={() => void openDetail(order)}>Ver</button><button type="button" onClick={() => void openEdit(order)}>Editar</button>{order.status !== "cancelled" && order.status !== "delivered" ? <button className="danger-link" type="button" onClick={() => void cancel(order)}>Cancelar</button> : null}</div></td></tr>)}</tbody></table></div>}
          </div>
        </section>
      </div>

      {formOpen ? <OrderFormModal form={form} setForm={setForm} clients={clients} editing={editing} subtotal={formSubtotal} total={formTotal} money={money} saving={saving} depositAmount={depositAmount} setDepositAmount={setDepositAmount} close={() => { setFormOpen(false); setEditing(null); setDepositAmount(0); }} submit={submitOrder} updateItem={updateItem} addItem={addItem} removeItem={removeItem}/> : null}
      {detailLoading ? <div className="detail-loading">Cargando pedido...</div> : null}
      {detail ? <OrderDrawer detail={detail} money={money} close={() => setDetail(null)} edit={() => { const summary = detail.order; setDetail(null); void openEdit(summary); }} startPayment={startPayment} updateStatus={updateStatus} statusSaving={statusSaving} documentBusy={documentBusy} exportDocument={exportOrder}/> : null}
      {paymentOpen && detail ? <PaymentModal detail={detail} methods={methods} lines={paymentLines} setLines={setPaymentLines} notes={paymentNotes} setNotes={setPaymentNotes} money={money} total={paymentTotal} saving={paymentSaving} close={() => setPaymentOpen(false)} submit={submitPayment}/> : null}
    </>
  );
}

function OrderFormModal({ form, setForm, clients, editing, subtotal, total, money, saving, depositAmount, setDepositAmount, close, submit, updateItem, addItem, removeItem }: {
  form: OrderInput;
  setForm: React.Dispatch<React.SetStateAction<OrderInput>>;
  clients: ClientSummary[];
  editing: OrderDetail | null;
  subtotal: number;
  total: number;
  money: (value: number) => string;
  saving: boolean;
  depositAmount: number;
  setDepositAmount: React.Dispatch<React.SetStateAction<number>>;
  close: () => void;
  submit: (event: FormEvent) => void;
  updateItem: (index: number, patch: Partial<OrderInput["items"][number]>) => void;
  addItem: () => void;
  removeItem: (index: number) => void;
}) {
  return <div className="modal-backdrop" onMouseDown={close}><form className="modal-card order-form-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}><div className="modal-head"><div><span>{editing ? "EDITAR PEDIDO" : "NUEVO PEDIDO"}</span><h3>{editing ? `Pedido #${String(editing.order.order_number).padStart(5,"0")}` : "Crear pedido"}</h3></div><button className="modal-close" type="button" onClick={close}>×</button></div><div className="order-form-grid"><div className="field full"><label>Cliente *</label><select value={form.client_id} onChange={(event) => setForm((current) => ({ ...current, client_id: event.target.value }))}><option value="">Seleccionar cliente...</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.company_name ? ` · ${client.company_name}` : ""}</option>)}</select></div><div className="field"><label>Fecha</label><input type="date" value={form.order_date} onChange={(event) => setForm((current) => ({ ...current, order_date: event.target.value }))}/></div><div className="field"><label>Fecha de entrega</label><input type="date" value={form.delivery_date ?? ""} onChange={(event) => setForm((current) => ({ ...current, delivery_date: event.target.value }))}/></div><div className="field"><label>Prioridad</label><select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as OrderPriority }))}>{PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><div className="field"><label>Estado</label><select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as OrderStatus }))}>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div></div><section className="order-items-editor"><div className="order-items-head"><div><strong>Productos / ítems</strong><span>Un pedido puede contener varios trabajos o servicios.</span></div><button className="button modal-secondary" type="button" onClick={addItem}><Icon name="plus" size={13}/> Agregar ítem</button></div><div className="order-items-list">{form.items.map((item, index) => <div className="order-item-row" key={index}><div className="field item-description"><label>Descripción</label><input value={item.description} onChange={(event) => updateItem(index, { description: event.target.value })} placeholder="Ej: 500 tarjetas personales"/></div><div className="field"><label>Cantidad</label><input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => updateItem(index, { quantity: Number(event.target.value) })}/></div><div className="field"><label>Precio unitario</label><input type="number" min="0" step="0.01" value={item.unit_price} onChange={(event) => updateItem(index, { unit_price: Number(event.target.value) })}/></div><div className="item-total"><span>Total</span><strong>{money(Number(item.quantity || 0) * Number(item.unit_price || 0))}</strong></div><button className="item-remove" type="button" disabled={form.items.length === 1} onClick={() => removeItem(index)}>×</button></div>)}</div></section><div className="order-form-footer"><div className="field order-notes"><label>Observaciones</label><textarea value={form.notes ?? ""} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Detalles internos del pedido..."/></div><div className="order-totals"><div><span>Subtotal</span><strong>{money(subtotal)}</strong></div><label><span>Descuento</span><input type="number" min="0" step="0.01" value={form.discount} onChange={(event) => setForm((current) => ({ ...current, discount: Number(event.target.value) }))}/></label><div className="grand-total"><span>Total</span><strong>{money(total)}</strong></div></div></div>{!editing ? <div className="order-deposit-box"><div className="order-deposit-copy"><Icon name="money" size={16}/><div><strong>Seña o anticipo (opcional)</strong><span>Si el cliente adelanta un pago al confirmar el pedido, cargalo acá y te vamos a abrir el registro de pago automáticamente al guardar.</span></div></div><div className="order-deposit-input"><label><span>Monto</span><input type="number" min="0" max={total} step="0.01" value={depositAmount || ""} onChange={(event) => setDepositAmount(Math.max(0, Math.min(Number(event.target.value) || 0, total)))} placeholder="0"/></label>{total > 0 ? <div className="order-deposit-quick"><button type="button" onClick={() => setDepositAmount(Math.round(total * 0.5 * 100) / 100)}>50%</button><button type="button" onClick={() => setDepositAmount(total)}>100%</button><button type="button" onClick={() => setDepositAmount(0)}>Sin seña</button></div> : null}</div></div> : null}<div className="modal-actions"><button className="button modal-secondary" type="button" onClick={close}>Cancelar</button><button className="button button-dark" type="submit" disabled={saving}>{saving ? "Guardando..." : editing ? "Guardar cambios" : depositAmount > 0 ? "Crear pedido y registrar seña" : "Crear pedido"}</button></div></form></div>;
}

function OrderDrawer({ detail, money, close, edit, startPayment, updateStatus, statusSaving, documentBusy, exportDocument }: { detail: OrderDetail; money: (value: number) => string; close: () => void; edit: () => void; startPayment: () => void; updateStatus: (status: OrderStatus) => void; statusSaving: boolean; documentBusy: "pdf" | "print" | null; exportDocument: (action: "pdf" | "print") => Promise<void> }) {
  const order = detail.order;
  const isFullyPaid = order.total > 0 && order.balance <= 0.009;
  // Los pagos vienen del más nuevo al más viejo; los recorremos del más
  // viejo al más nuevo para calcular cuánto del total representa cada uno
  // en el momento en que se hizo (seña, pagos parciales, pago final).
  const paymentsChrono = [...detail.payments].reverse();
  let runningPaid = 0;
  const paymentBadges = new Map<string, { label: string; percent: number }>();
  paymentsChrono.forEach((payment, index) => {
    runningPaid += payment.amount;
    const percentOfTotal = order.total > 0 ? Math.round((payment.amount / order.total) * 100) : 0;
    const completesOrder = order.total > 0 && runningPaid >= order.total - 0.009;
    const label = index === 0
      ? "Seña inicial"
      : completesOrder
        ? "Pago final"
        : `Pago ${index + 1}`;
    paymentBadges.set(payment.id, { label, percent: percentOfTotal });
  });
  return <div className="drawer-backdrop" onMouseDown={close}><aside className="order-drawer" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="drawer-kicker">PEDIDO</span><h3>#{String(order.order_number).padStart(5,"0")}</h3><p>{order.client_name} · {order.first_item || `${order.item_count} ítem(s)`}</p></div><button className="modal-close" type="button" onClick={close}>×</button></div>{isFullyPaid ? <div className="order-paid-banner"><Icon name="check" size={15}/><span>Pedido pagado en su totalidad</span></div> : null}<div className="order-drawer-actions"><button className="button document-primary-action" type="button" disabled={documentBusy !== null} onClick={() => void exportDocument("pdf")}><Icon name="download" size={14}/> {documentBusy === "pdf" ? "Generando..." : "Descargar PDF"}</button><button className="button modal-secondary" type="button" disabled={documentBusy !== null} onClick={() => void exportDocument("print")}><Icon name="printer" size={14}/> {documentBusy === "print" ? "Abriendo..." : "Imprimir"}</button><button className="button button-dark" type="button" onClick={edit}>Editar pedido</button><button className={`button payment-action ${isFullyPaid ? "payment-action-done" : ""}`} type="button" onClick={startPayment} disabled={order.balance <= 0}><Icon name={isFullyPaid ? "check" : "money"} size={14}/> {order.balance > 0 ? "Registrar pago" : "Pedido pagado"}</button></div><div className="order-detail-metrics"><div><span>Total</span><strong>{money(order.total)}</strong></div><div><span>Pagado</span><strong>{money(order.paid)}</strong></div><div><span>Saldo</span><strong className={isFullyPaid ? "balance-paid" : order.balance > 0 ? "balance-due" : ""}>{isFullyPaid ? "Saldado" : money(order.balance)}</strong></div><div><span>Entrega</span><strong>{order.delivery_date || "—"}</strong></div></div><section className="drawer-section"><h4>Estado y prioridad</h4><div className="order-status-controls"><label className="field"><span>Estado</span><select value={order.status} disabled={statusSaving || order.status === "cancelled"} onChange={(event) => void updateStatus(event.target.value as OrderStatus)}>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><div><span>Prioridad</span><b className={`status-pill ${priorityClass(order.priority)}`}>{priorityLabel(order.priority)}</b></div></div></section><section className="drawer-section"><div className="drawer-section-head"><h4>Ítems del pedido</h4><span>{detail.items.length}</span></div><div className="drawer-list order-item-detail-list">{detail.items.map((item) => <div key={item.id}><span><strong>{item.description}</strong><small>{item.quantity} × {money(item.unit_price)}</small></span><b>{money(item.total)}</b></div>)}</div>{order.discount > 0 ? <div className="drawer-discount"><span>Descuento aplicado</span><strong>- {money(order.discount)}</strong></div> : null}</section><section className="drawer-section"><div className="drawer-section-head"><h4>Historial de pagos</h4><span>{detail.payments.length}</span></div>{detail.payments.length === 0 ? <p className="drawer-empty">Todavía no se registraron pagos.</p> : <div className="drawer-list payment-history-list">{detail.payments.map((payment) => { const badge = paymentBadges.get(payment.id); return <div key={payment.id}><span><strong>{payment.method}</strong><small>{new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(payment.created_at))}{payment.reference ? ` · ${payment.reference}` : ""}</small>{badge ? <span className={`payment-badge ${badge.label === "Pago final" ? "payment-badge-final" : badge.label === "Seña inicial" ? "payment-badge-deposit" : ""}`}>{badge.label} · {badge.percent}% del total</span> : null}</span><b>{money(payment.amount)}</b></div>; })}</div>}</section>{order.notes ? <section className="drawer-section"><h4>Observaciones</h4><p className="client-notes">{order.notes}</p></section> : null}</aside></div>;
}

function PaymentModal({ detail, methods, lines, setLines, notes, setNotes, money, total, saving, close, submit }: { detail: OrderDetail; methods: PaymentMethod[]; lines: PaymentLineInput[]; setLines: React.Dispatch<React.SetStateAction<PaymentLineInput[]>>; notes: string; setNotes: (value: string) => void; money: (value: number) => string; total: number; saving: boolean; close: () => void; submit: (event: FormEvent) => void }) {
  const balanceAfter = detail.order.balance - total;
  function patchLine(index: number, patch: Partial<PaymentLineInput>) { setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line)); }
  function addLine() { setLines((current) => [...current, { payment_method_id: methods[0]?.id ?? "", amount: 0, reference: "" }]); }
  function removeLine(index: number) { setLines((current) => current.filter((_, lineIndex) => lineIndex !== index)); }
  return <div className="modal-backdrop payment-backdrop" onMouseDown={close}><form className="modal-card payment-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}><div className="modal-head"><div><span>REGISTRAR PAGO</span><h3>Pedido #{String(detail.order.order_number).padStart(5,"0")}</h3></div><button className="modal-close" type="button" onClick={close}>×</button></div><div className="payment-summary"><div><span>Total pedido</span><strong>{money(detail.order.total)}</strong></div><div><span>Ya pagado</span><strong>{money(detail.order.paid)}</strong></div><div className="payment-balance"><span>Saldo pendiente</span><strong>{money(detail.order.balance)}</strong></div></div><section className="payment-lines"><div className="order-items-head"><div><strong>Medios de pago</strong><span>Podés combinar efectivo, transferencia, Mercado Pago, tarjetas u otros.</span></div><button className="button modal-secondary" type="button" onClick={addLine}><Icon name="plus" size={13}/> Otro medio</button></div>{methods.length === 0 ? <div className="form-message error">No hay medios de pago activos. Configuralos antes de registrar un pago.</div> : null}{lines.map((line, index) => <div className="payment-line" key={index}><div className="field"><label>Método</label><select value={line.payment_method_id} onChange={(event) => patchLine(index, { payment_method_id: event.target.value })}><option value="">Seleccionar...</option>{methods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</select></div><div className="field"><label>Monto</label><input type="number" min="0.01" step="0.01" value={line.amount} onChange={(event) => patchLine(index, { amount: Number(event.target.value) })}/></div><div className="field"><label>Referencia</label><input value={line.reference ?? ""} onChange={(event) => patchLine(index, { reference: event.target.value })} placeholder="Opcional"/></div><button className="item-remove" type="button" disabled={lines.length === 1} onClick={() => removeLine(index)}>×</button></div>)}</section><div className="payment-footer"><div className="field"><label>Observaciones del pago</label><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Opcional"/></div><div className="payment-calculation"><div><span>Pago actual</span><strong>{money(total)}</strong></div><div className={balanceAfter < -0.001 ? "payment-over" : ""}><span>Saldo después</span><strong>{money(Math.max(balanceAfter, 0))}</strong></div></div></div><div className="modal-actions"><button className="button modal-secondary" type="button" onClick={close}>Cancelar</button><button className="button button-dark" type="submit" disabled={saving || methods.length === 0 || total <= 0 || balanceAfter < -0.001}>{saving ? "Registrando..." : "Confirmar pago"}</button></div></form></div>;
}

function OrderRowsSkeleton() {
  return <div className="order-skeleton">{Array.from({ length: 6 }, (_, index) => <div key={index}><span/><span/><span/><span/><span/></div>)}</div>;
}
