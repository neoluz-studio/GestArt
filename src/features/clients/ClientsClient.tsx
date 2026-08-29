"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { Topbar } from "@/components/Topbar";
import { CompactMetric } from "@/components/Metric";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { clients as demoClients, money as demoMoney } from "@/lib/demo-data";
import { demoMode } from "@/lib/runtime";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  createClient,
  deleteClient,
  listClients,
  loadClientDetail,
  updateClient,
  type ClientDetail,
  type ClientInput,
  type ClientSummary
} from "@/services/clients";

const EMPTY_FORM: ClientInput = {
  name: "",
  company_name: "",
  tax_id: "",
  phone: "",
  email: "",
  address: "",
  instagram: "",
  notes: "",
  is_active: true
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String((error as { message: unknown }).message);
  return "Ocurrió un error inesperado.";
}

function toDemoClients(): ClientSummary[] {
  return demoClients.map((client, index) => ({
    id: client.id,
    name: client.name,
    company_name: client.company,
    tax_id: index === 2 ? "30-71234567-8" : null,
    phone: client.phone,
    email: client.email,
    address: null,
    instagram: null,
    notes: null,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    order_count: client.orders,
    quote_count: Math.max(1, Math.floor(client.orders / 2)),
    total_purchased: client.total,
    total_paid: client.total - client.balance,
    balance: client.balance,
    last_order_date: "2026-08-28"
  }));
}

export function ClientsClient() {
  const { user } = useAuth();
  const { currentCompany, settings } = useTenant();
  const [clients, setClients] = useState<ClientSummary[]>(demoMode ? toDemoClients() : []);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClientSummary | null>(null);
  const [form, setForm] = useState<ClientInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const currency = settings?.currency || "ARS";
  const locale = settings?.locale || "es-AR";
  const money = (value: number) => demoMode
    ? demoMoney(value)
    : new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);

  async function load(searchValue = search) {
    if (demoMode) {
      const term = searchValue.trim().toLowerCase();
      const all = toDemoClients();
      setClients(term ? all.filter((client) => [client.name, client.company_name, client.tax_id, client.phone, client.email].some((value) => value?.toLowerCase().includes(term))) : all);
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;

    setLoading(true);
    setError("");
    try {
      setClients(await listClients(supabaseBrowser, currentCompany.id, searchValue));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(search), 280);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") {
      openNew();
      window.history.replaceState({}, "", "/clientes");
    }
  }, []);

  const metrics = useMemo(() => ({
    active: clients.filter((client) => client.is_active).length,
    orders: clients.reduce((sum, client) => sum + client.order_count, 0),
    purchased: clients.reduce((sum, client) => sum + client.total_purchased, 0),
    balance: clients.reduce((sum, client) => sum + client.balance, 0)
  }), [clients]);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
    setError("");
    setSuccess("");
  }

  function openEdit(client: ClientSummary) {
    setEditing(client);
    setForm({
      name: client.name,
      company_name: client.company_name ?? "",
      tax_id: client.tax_id ?? "",
      phone: client.phone ?? "",
      email: client.email ?? "",
      address: client.address ?? "",
      instagram: client.instagram ?? "",
      notes: client.notes ?? "",
      is_active: client.is_active
    });
    setFormOpen(true);
    setError("");
    setSuccess("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      setError("El nombre del cliente es obligatorio.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      if (demoMode) {
        setSuccess(editing ? "Cliente actualizado en modo demo." : "Cliente creado en modo demo.");
      } else {
        if (!supabaseBrowser || !currentCompany || !user) throw new Error("No hay una sesión de empresa activa.");
        if (editing) {
          await updateClient(supabaseBrowser, currentCompany.id, editing.id, user.id, form);
          setSuccess("Cliente actualizado correctamente.");
        } else {
          await createClient(supabaseBrowser, currentCompany.id, user.id, form);
          setSuccess("Cliente creado correctamente.");
        }
        await load(search);
      }
      setFormOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(client: ClientSummary) {
    setDetailLoading(true);
    setError("");
    try {
      if (demoMode) {
        setDetail({ client, orders: [], quotes: [], payments: [] });
      } else {
        if (!supabaseBrowser || !currentCompany) throw new Error("No hay una empresa activa.");
        setDetail(await loadClientDetail(supabaseBrowser, currentCompany.id, client));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  }

  async function remove(client: ClientSummary) {
    if (!window.confirm(`¿Eliminar a ${client.name}? Esta acción no se puede deshacer.`)) return;
    if (demoMode) {
      setClients((current) => current.filter((item) => item.id !== client.id));
      setSuccess("Cliente eliminado en modo demo.");
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;

    setDeletingId(client.id);
    setError("");
    try {
      await deleteClient(supabaseBrowser, currentCompany.id, client.id);
      setSuccess("Cliente eliminado correctamente.");
      await load(search);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  function exportCsv() {
    const header = ["Nombre", "Empresa", "CUIT/DNI", "Teléfono", "Email", "Pedidos", "Total comprado", "Saldo"];
    const rows = clients.map((client) => [client.name, client.company_name ?? "", client.tax_id ?? "", client.phone ?? "", client.email ?? "", client.order_count, client.total_purchased, client.balance]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `clientes-${currentCompany?.slug ?? "gestart"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Topbar eyebrow="CRM" title="Clientes" />
      <div className="page-content page-stack">
        <section className="module-intro clients-intro">
          <div className="module-copy">
            <span className="module-kicker">RELACIONES COMERCIALES</span>
            <h2>Conocé mejor a tus <span>clientes.</span></h2>
            <p>Datos reales, historial comercial, facturación y saldos pendientes de la empresa activa.</p>
          </div>
          <div className="module-actions">
            <button className="button button-dark" type="button" onClick={openNew}><Icon name="plus" size={14}/> Nuevo cliente</button>
          </div>
        </section>

        <section className="compact-metrics">
          <CompactMetric icon="users" tone="purple" label="Clientes activos" value={String(metrics.active)}/>
          <CompactMetric icon="orders" tone="blue" label="Pedidos registrados" value={String(metrics.orders)}/>
          <CompactMetric icon="money" tone="green" label="Total comprado" value={money(metrics.purchased)}/>
          <CompactMetric icon="alert" tone="orange" label="Saldos pendientes" value={money(metrics.balance)}/>
        </section>

        {error ? <div className="form-message error">{error}</div> : null}
        {success ? <div className="form-message success">{success}</div> : null}

        <section className="filter-bar">
          <label className="filter-search"><Icon name="search" size={14}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, empresa, CUIT, teléfono o email..."/></label>
          <button className="button modal-secondary" type="button" onClick={() => void load(search)}>Actualizar</button>
          <button className="button button-dark" type="button" onClick={exportCsv} disabled={clients.length === 0}>Exportar CSV</button>
        </section>

        <section className="gestart-card">
          <div className="gestart-card-body client-table-card">
            <div className="gestart-card-title">
              <div><h3>Base de clientes</h3><p>{loading ? "Cargando..." : `${clients.length} resultado${clients.length === 1 ? "" : "s"}`}</p></div>
            </div>
            {loading ? <ClientRowsSkeleton /> : clients.length === 0 ? (
              <div className="clients-empty"><span><Icon name="users" size={26}/></span><strong>No encontramos clientes</strong><p>{search ? "Probá con otra búsqueda." : "Creá tu primer cliente para comenzar a trabajar con datos reales."}</p><button className="button button-dark" type="button" onClick={openNew}>Crear cliente</button></div>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table clients-table">
                  <thead><tr><th>Cliente</th><th>Contacto</th><th>Pedidos</th><th>Total comprado</th><th>Saldo</th><th>Estado</th><th></th></tr></thead>
                  <tbody>
                    {clients.map((client) => (
                      <tr key={client.id}>
                        <td><button className="client-link" type="button" onClick={() => void openDetail(client)}><span className="client-avatar">{client.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span><strong>{client.name}</strong><small>{client.company_name || client.tax_id || "Cliente particular"}</small></span></button></td>
                        <td><span className="cell-main">{client.phone || "Sin teléfono"}</span><span className="cell-sub">{client.email || "Sin email"}</span></td>
                        <td><strong>{client.order_count}</strong><span className="cell-sub">{client.quote_count} presupuestos</span></td>
                        <td className="money">{money(client.total_purchased)}</td>
                        <td className={`money ${client.balance > 0 ? "balance-due" : ""}`}>{money(client.balance)}</td>
                        <td><span className={`status-pill ${client.is_active ? "status-green" : "status-orange"}`}>{client.is_active ? "Activo" : "Inactivo"}</span></td>
                        <td><div className="row-actions"><button type="button" title="Ver ficha" onClick={() => void openDetail(client)}>Ver</button><button type="button" onClick={() => openEdit(client)}>Editar</button><button className="danger-link" type="button" disabled={deletingId === client.id} onClick={() => void remove(client)}>{deletingId === client.id ? "..." : "Eliminar"}</button></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      {formOpen ? (
        <div className="modal-backdrop" onMouseDown={() => !saving && setFormOpen(false)}>
          <form className="modal-card client-form-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span>{editing ? "EDITAR CLIENTE" : "NUEVO CLIENTE"}</span><h3>{editing ? editing.name : "Agregar cliente"}</h3></div><button className="modal-close" type="button" onClick={() => setFormOpen(false)}>×</button></div>
            <div className="client-form-grid">
              <Field label="Nombre *" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} placeholder="Juan Pérez" />
              <Field label="Empresa" value={form.company_name ?? ""} onChange={(value) => setForm((current) => ({ ...current, company_name: value }))} placeholder="Empresa / comercio" />
              <Field label="CUIT / DNI" value={form.tax_id ?? ""} onChange={(value) => setForm((current) => ({ ...current, tax_id: value }))} placeholder="20-12345678-9" />
              <Field label="Teléfono / WhatsApp" value={form.phone ?? ""} onChange={(value) => setForm((current) => ({ ...current, phone: value }))} placeholder="+54 9 ..." />
              <Field label="Email" type="email" value={form.email ?? ""} onChange={(value) => setForm((current) => ({ ...current, email: value }))} placeholder="cliente@email.com" />
              <Field label="Instagram" value={form.instagram ?? ""} onChange={(value) => setForm((current) => ({ ...current, instagram: value }))} placeholder="@usuario" />
              <div className="field full"><label>Dirección</label><input value={form.address ?? ""} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} placeholder="Dirección completa"/></div>
              <div className="field full"><label>Observaciones</label><textarea value={form.notes ?? ""} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Información útil sobre el cliente..."/></div>
              <label className="client-active-check"><input type="checkbox" checked={form.is_active ?? true} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}/><span><strong>Cliente activo</strong><small>Los clientes inactivos se conservan con todo su historial.</small></span></label>
            </div>
            <div className="modal-actions"><button className="button modal-secondary" type="button" onClick={() => setFormOpen(false)}>Cancelar</button><button className="button button-dark" disabled={saving} type="submit">{saving ? "Guardando..." : editing ? "Guardar cambios" : "Crear cliente"}</button></div>
          </form>
        </div>
      ) : null}

      {detailLoading ? <div className="detail-loading">Cargando ficha...</div> : null}
      {detail ? <ClientDrawer detail={detail} money={money} close={() => setDetail(null)} edit={() => { setDetail(null); openEdit(detail.client); }} /> : null}
    </>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return <div className="field"><label>{label}</label><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}/></div>;
}

function ClientDrawer({ detail, money, close, edit }: { detail: ClientDetail; money: (value: number) => string; close: () => void; edit: () => void }) {
  const client = detail.client;
  return <div className="drawer-backdrop" onMouseDown={close}><aside className="client-drawer" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div className="drawer-client"><span className="client-avatar large">{client.name.split(" ").map((part) => part[0]).join("").slice(0,2).toUpperCase()}</span><div><span>FICHA DEL CLIENTE</span><h3>{client.name}</h3><p>{client.company_name || "Cliente particular"}</p></div></div><button className="modal-close" type="button" onClick={close}>×</button></div><div className="drawer-actions"><button className="button button-dark" type="button" onClick={edit}>Editar cliente</button></div><div className="client-detail-metrics"><div><span>Total comprado</span><strong>{money(client.total_purchased)}</strong></div><div><span>Total pagado</span><strong>{money(client.total_paid)}</strong></div><div><span>Saldo pendiente</span><strong className={client.balance > 0 ? "balance-due" : ""}>{money(client.balance)}</strong></div><div><span>Pedidos</span><strong>{client.order_count}</strong></div></div><section className="drawer-section"><h4>Datos de contacto</h4><div className="contact-grid"><div><span>Teléfono</span><strong>{client.phone || "—"}</strong></div><div><span>Email</span><strong>{client.email || "—"}</strong></div><div><span>CUIT / DNI</span><strong>{client.tax_id || "—"}</strong></div><div><span>Instagram</span><strong>{client.instagram || "—"}</strong></div><div className="full"><span>Dirección</span><strong>{client.address || "—"}</strong></div></div></section><section className="drawer-section"><div className="drawer-section-head"><h4>Pedidos recientes</h4><span>{detail.orders.length}</span></div>{detail.orders.length === 0 ? <p className="drawer-empty">Todavía no tiene pedidos registrados.</p> : <div className="drawer-list">{detail.orders.map((order) => <div key={order.id}><span><strong>#{String(order.order_number).padStart(5,"0")}</strong><small>{order.status} · {order.order_date}</small></span><b>{money(order.total)}</b></div>)}</div>}</section><section className="drawer-section"><div className="drawer-section-head"><h4>Presupuestos recientes</h4><span>{detail.quotes.length}</span></div>{detail.quotes.length === 0 ? <p className="drawer-empty">Todavía no tiene presupuestos registrados.</p> : <div className="drawer-list">{detail.quotes.map((quote) => <div key={quote.id}><span><strong>P-{String(quote.quote_number).padStart(4,"0")}</strong><small>{quote.status} · {quote.issue_date}</small></span><b>{money(quote.total)}</b></div>)}</div>}</section><section className="drawer-section"><div className="drawer-section-head"><h4>Pagos recientes</h4><span>{detail.payments.length}</span></div>{detail.payments.length === 0 ? <p className="drawer-empty">Todavía no tiene pagos registrados.</p> : <div className="drawer-list">{detail.payments.map((payment) => <div key={payment.id}><span><strong>{payment.method || "Pago"}</strong><small>{payment.order_number ? `Pedido #${String(payment.order_number).padStart(5,"0")} · ` : ""}{new Intl.DateTimeFormat("es-AR", {day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(payment.created_at))}</small></span><b>{money(payment.amount)}</b></div>)}</div>}</section>{client.notes ? <section className="drawer-section"><h4>Observaciones</h4><p className="client-notes">{client.notes}</p></section> : null}</aside></div>;
}

function ClientRowsSkeleton() {
  return <div className="client-skeleton">{Array.from({ length: 5 }, (_, index) => <div key={index}><span/><span/><span/><span/></div>)}</div>;
}
