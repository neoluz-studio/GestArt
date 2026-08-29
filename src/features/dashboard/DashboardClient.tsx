"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { Topbar } from "@/components/Topbar";
import { useTenant } from "@/contexts/TenantContext";
import { demoMode } from "@/lib/runtime";
import { cashMovements, money, orders } from "@/lib/demo-data";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  getDashboardData,
  saveDashboardOptions,
  type DashboardData
} from "@/services/dashboard";

const DEFAULT_WIDGETS = {
  metrics: true,
  sales: true,
  recentOrders: true,
  quickActions: true,
  activity: true
};

function formatMoney(value: number, currency = "ARS", locale = "es-AR") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(value);
}

function formatShortDate(value: string | null) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" }).format(
    new Date(`${value}T12:00:00`)
  );
}

function statusTone(status: string) {
  const s = status.toLowerCase();
  if (s.includes("produ")) return "status-purple";
  if (s.includes("entrega") || s.includes("delivery")) return "status-orange";
  if (s.includes("listo") || s.includes("ready") || s.includes("entregado")) return "status-green";
  return "status-blue";
}

export function DashboardClient() {
  const { currentCompany, settings, reload: reloadTenant } = useTenant();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState("");
  const [customizing, setCustomizing] = useState(false);
  const [savingWidgets, setSavingWidgets] = useState(false);
  const [widgets, setWidgets] = useState(DEFAULT_WIDGETS);

  useEffect(() => {
    const configured = settings?.dashboard_options;
    setWidgets({ ...DEFAULT_WIDGETS, ...(configured ?? {}) });
  }, [settings?.dashboard_options]);

  async function load() {
    if (demoMode || !supabaseBrowser || !currentCompany) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      setData(await getDashboardData(supabaseBrowser, currentCompany.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id]);

  const currency = settings?.currency || "ARS";
  const locale = settings?.locale || "es-AR";

  const overview = useMemo(() => {
    if (!demoMode && data) return data.overview;
    return {
      active_orders: 20,
      in_production: 7,
      ready_orders: 4,
      income_today: 285000,
      receivable: 233000,
      low_stock: 2,
      client_count: 128,
      open_quotes: 6
    };
  }, [data]);

  const recentOrders = demoMode
    ? orders.slice(0, 5).map((order, index) => ({
        id: String(index),
        order_number: Number(order.number),
        status: order.status,
        total: order.total,
        delivery_date: "2026-08-29",
        created_at: new Date().toISOString(),
        clients: { name: order.client }
      }))
    : data?.recentOrders ?? [];

  const activity = demoMode
    ? cashMovements.slice(0, 4).map((item, index) => ({
        id: index,
        action: item.type,
        entity_type: "cash",
        entity_id: null,
        description: `${item.concept} · ${item.method}`,
        created_at: new Date().toISOString()
      }))
    : data?.activity ?? [];

  const dailySales = demoMode
    ? [145000, 260000, 175000, 330000, 225000, 390000, 285000].map((total, index) => {
        const date = new Date();
        date.setDate(date.getDate() - 6 + index);
        return { date: date.toISOString().slice(0, 10), total, count: 1 };
      })
    : data?.dailySales ?? [];

  const maxSale = Math.max(1, ...dailySales.map((item) => item.total));
  const completion = overview.active_orders + overview.ready_orders > 0
    ? Math.round((overview.ready_orders / (overview.active_orders + overview.ready_orders)) * 100)
    : 0;

  async function persistWidgets() {
    if (demoMode || !supabaseBrowser || !currentCompany) {
      setCustomizing(false);
      return;
    }
    setSavingWidgets(true);
    try {
      await saveDashboardOptions(supabaseBrowser, currentCompany.id, widgets);
      await reloadTenant();
      setCustomizing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la configuración.");
    } finally {
      setSavingWidgets(false);
    }
  }

  return (
    <>
      <Topbar />
      <div className="page-content">
        <section className="hero-panel">
          <div className="hero-content">
            <div className="hero-text">
              <span className="hero-tag">GestArt · {currentCompany?.name ?? "EMPRESA DEMO"}</span>
              <h2>
                Todo lo importante de tu negocio, <span>en un solo lugar.</span>
              </h2>
              <p>
                Datos reales de pedidos, cobros, producción, clientes e inventario,
                siempre filtrados por la empresa activa.
              </p>
              <div className="hero-actions">
                <Link href="/pedidos" className="button button-light">
                  Ver pedidos <Icon name="arrow" size={14} />
                </Link>
                <button className="button button-ghost" type="button" onClick={() => setCustomizing(true)}>
                  Personalizar dashboard
                </button>
              </div>
            </div>

            <div className="hero-visual">
              <div className="progress-ring">
                <svg viewBox="0 0 120 120">
                  <circle className="ring-background" cx="60" cy="60" r="48" />
                  <circle
                    className="ring-progress"
                    cx="60"
                    cy="60"
                    r="48"
                    style={{ strokeDashoffset: 301.59 - (301.59 * completion) / 100 }}
                  />
                </svg>
                <div className="ring-content">
                  <strong>{completion}%</strong>
                  <span>listos</span>
                </div>
              </div>
              <div className="hero-visual-copy">
                <strong>{overview.ready_orders} pedidos listos</strong>
                <span>{overview.active_orders} pedidos todavía activos</span>
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <div className="form-message error dashboard-message">
            {error} <button type="button" onClick={() => void load()}>Reintentar</button>
          </div>
        ) : null}

        {loading ? <DashboardSkeleton /> : null}

        {!loading && widgets.metrics ? (
          <section className="metrics-grid">
            <MetricCard icon="orders" tone="purple" label="Pedidos activos" value={String(overview.active_orders)} note="Pendientes de completar o entregar." />
            <MetricCard icon="production" tone="orange" label="En producción" value={String(overview.in_production)} note="Trabajos actualmente en proceso." />
            <MetricCard icon="money" tone="green" label="Ingresos del día" value={formatMoney(overview.income_today, currency, locale)} note={`Pendiente de cobro: ${formatMoney(overview.receivable, currency, locale)}`} />
            <MetricCard icon="materials" tone="blue" label="Stock bajo" value={String(overview.low_stock)} note={`${overview.client_count} clientes activos · ${overview.open_quotes} presupuestos abiertos`} />
          </section>
        ) : null}

        <section className="dashboard-grid-gestart">
          <div className="page-stack">
            {widgets.sales ? (
              <article className="gestart-card">
                <div className="gestart-card-body">
                  <div className="gestart-card-title">
                    <div>
                      <h3>Ventas de los últimos 7 días</h3>
                      <p>Facturación de pedidos no cancelados.</p>
                    </div>
                    <span className="dashboard-live">Datos reales</span>
                  </div>
                  <div className="sales-chart" aria-label="Ventas de los últimos siete días">
                    {dailySales.map((item) => (
                      <div className="sales-bar-item" key={item.date}>
                        <div className="sales-bar-track">
                          <div
                            className="sales-bar"
                            style={{ height: `${Math.max(5, (item.total / maxSale) * 100)}%` }}
                            title={formatMoney(item.total, currency, locale)}
                          />
                        </div>
                        <strong>{new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(`${item.date}T12:00:00`)).replace(".", "")}</strong>
                        <span>{item.count} ped.</span>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ) : null}

            {widgets.recentOrders ? (
              <article className="gestart-card">
                <div className="gestart-card-body">
                  <div className="gestart-card-title">
                    <div>
                      <h3>Pedidos recientes</h3>
                      <p>Últimos movimientos operativos de esta empresa.</p>
                    </div>
                    <Link href="/pedidos" className="button button-dark">Ver todos</Link>
                  </div>
                  {recentOrders.length === 0 ? (
                    <EmptyBlock title="Todavía no hay pedidos" text="Cuando registres pedidos, van a aparecer acá automáticamente." />
                  ) : (
                    <div className="data-table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr><th>Pedido</th><th>Cliente</th><th>Estado</th><th>Entrega</th><th>Total</th></tr>
                        </thead>
                        <tbody>
                          {recentOrders.map((order) => (
                            <tr key={order.id}>
                              <td><strong>#{String(order.order_number).padStart(5, "0")}</strong></td>
                              <td>{order.clients?.name ?? "Cliente"}</td>
                              <td><span className={`status-pill ${statusTone(order.status)}`}>{order.status}</span></td>
                              <td>{formatShortDate(order.delivery_date)}</td>
                              <td className="money">{formatMoney(order.total, currency, locale)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </article>
            ) : null}
          </div>

          <div className="page-stack">
            {widgets.quickActions ? (
              <article className="gestart-card">
                <div className="gestart-card-body">
                  <div className="gestart-card-title"><div><h3>Acciones rápidas</h3><p>Menos clics para tareas frecuentes.</p></div></div>
                  <div className="quick-grid">
                    <Link className="quick-tile" href="/pedidos"><span className="quick-tile-icon"><Icon name="plus" size={15}/></span>Nuevo pedido</Link>
                    <Link className="quick-tile" href="/presupuestos"><span className="quick-tile-icon"><Icon name="quote" size={15}/></span>Presupuesto</Link>
                    <Link className="quick-tile" href="/clientes?new=1"><span className="quick-tile-icon"><Icon name="users" size={15}/></span>Nuevo cliente</Link>
                    <Link className="quick-tile" href="/caja"><span className="quick-tile-icon"><Icon name="cash" size={15}/></span>Movimiento caja</Link>
                  </div>
                </div>
              </article>
            ) : null}

            {widgets.activity ? (
              <article className="gestart-card">
                <div className="gestart-card-body">
                  <div className="gestart-card-title"><div><h3>Actividad reciente</h3><p>Auditoría de las últimas acciones.</p></div></div>
                  {activity.length === 0 ? (
                    <EmptyBlock title="Sin actividad todavía" text="GestArt irá registrando las acciones importantes." />
                  ) : (
                    <div className="activity-list">
                      {activity.slice(0, 6).map((item) => (
                        <div className="activity-row" key={item.id}>
                          <span className="activity-icon"><Icon name="history" size={15}/></span>
                          <div className="activity-copy">
                            <strong>{item.description || item.action}</strong>
                            <span>{new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.created_at))}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ) : null}
          </div>
        </section>
      </div>

      {customizing ? (
        <div className="modal-backdrop" onMouseDown={() => setCustomizing(false)}>
          <section className="modal-card dashboard-customizer" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span>CONFIGURACIÓN</span><h3>Widgets del dashboard</h3></div>
              <button className="modal-close" type="button" onClick={() => setCustomizing(false)}>×</button>
            </div>
            <div className="widget-options">
              {Object.entries({ metrics: "Métricas", sales: "Gráfico de ventas", recentOrders: "Pedidos recientes", quickActions: "Acciones rápidas", activity: "Actividad reciente" }).map(([key, label]) => (
                <label className="widget-option" key={key}>
                  <div><strong>{label}</strong><span>Mostrar este bloque en el inicio.</span></div>
                  <input type="checkbox" checked={widgets[key as keyof typeof widgets]} onChange={(event) => setWidgets((current) => ({ ...current, [key]: event.target.checked }))} />
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button className="button modal-secondary" type="button" onClick={() => setCustomizing(false)}>Cancelar</button>
              <button className="button button-dark" type="button" disabled={savingWidgets} onClick={() => void persistWidgets()}>{savingWidgets ? "Guardando..." : "Guardar dashboard"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function MetricCard({ icon, tone, label, value, note }: { icon: "orders" | "production" | "money" | "materials"; tone: string; label: string; value: string; note: string }) {
  return <article className="metric-card"><div className="metric-top"><span className={`metric-icon icon-${tone}`}><Icon name={icon} size={18}/></span><span className="metric-change positive">En vivo</span></div><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong><p className="metric-description">{note}</p></article>;
}

function EmptyBlock({ title, text }: { title: string; text: string }) {
  return <div className="dashboard-empty"><Icon name="database" size={24}/><strong>{title}</strong><span>{text}</span></div>;
}

function DashboardSkeleton() {
  return <div className="dashboard-skeleton"><div/><div/><div/><div/></div>;
}
