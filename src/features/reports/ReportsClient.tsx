"use client";

import { useEffect, useMemo, useState } from "react";
import { CompactMetric } from "@/components/Metric";
import { Icon } from "@/components/Icon";
import { Topbar } from "@/components/Topbar";
import { useTenant } from "@/contexts/TenantContext";
import { demoMode } from "@/lib/runtime";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { buildCompanyDocumentProfile, logDocumentAction } from "@/services/documents";
import { downloadReportPdf, printReport } from "@/lib/documents/generator";
import {
  getReportBundle,
  type InventoryReport,
  type OrderStatusReport,
  type PaymentMethodReport,
  type ProductionStageReport,
  type ReportBundle,
  type ReportOverview,
  type ReportSeriesPoint,
  type TopClientReport
} from "@/services/reports";

type Tab = "general" | "sales" | "clients" | "production" | "cash" | "inventory";

const EMPTY_OVERVIEW: ReportOverview = {
  sales_total: 0,
  collections_total: 0,
  outstanding_total: 0,
  orders_count: 0,
  average_ticket: 0,
  active_clients: 0,
  cash_income: 0,
  cash_expense: 0,
  cash_net: 0,
  completed_jobs: 0,
  average_production_hours: 0,
  inventory_value: 0,
  low_stock_count: 0
};

const TABS: Array<{ id: Tab; label: string; icon: Parameters<typeof Icon>[0]["name"] }> = [
  { id: "general", label: "General", icon: "reports" },
  { id: "sales", label: "Ventas", icon: "money" },
  { id: "clients", label: "Clientes", icon: "users" },
  { id: "production", label: "Producción", icon: "production" },
  { id: "cash", label: "Caja", icon: "cash" },
  { id: "inventory", label: "Inventario", icon: "materials" }
];

const STATUS_LABELS: Record<string, string> = {
  budget: "Presupuesto",
  pending_payment: "Pendiente de pago",
  confirmed: "Confirmado",
  design: "Diseño",
  waiting_approval: "Esperando aprobación",
  approved: "Aprobado",
  pending_production: "Pendiente producción",
  in_production: "En producción",
  ready: "Listo",
  pending_delivery: "Pendiente entrega",
  delivered: "Entregado",
  cancelled: "Cancelado",
  pending: "Pendiente",
  production: "Producción",
  finished: "Terminado",
  delivery: "Entrega"
};

function isoDate(date: Date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function startOfMonth(date = new Date()) {
  return isoDate(new Date(date.getFullYear(), date.getMonth(), 1));
}

function startOfYear(date = new Date()) {
  return isoDate(new Date(date.getFullYear(), 0, 1));
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - Math.max(days - 1, 0));
  return isoDate(date);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Error inesperado.");
  }
  return "Ocurrió un error inesperado.";
}

function demoBundle(): ReportBundle {
  const series: ReportSeriesPoint[] = Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (13 - index));
    const wave = [145000, 220000, 180000, 310000, 260000, 410000, 350000][index % 7];
    return {
      period_date: isoDate(date),
      sales: wave + index * 8500,
      collections: Math.round((wave + index * 8500) * 0.78),
      cash_income: Math.round((wave + index * 8500) * 0.82),
      cash_expense: 45000 + (index % 4) * 18000,
      orders_count: 3 + (index % 6)
    };
  });

  const topClients: TopClientReport[] = [
    { client_id:"1",client_name:"Estudio Norte",company_name:"Estudio Norte SRL",orders_count:12,sales_total:920000,paid_total:790000,outstanding_total:130000 },
    { client_id:"2",client_name:"Mercado Central",company_name:null,orders_count:9,sales_total:735000,paid_total:735000,outstanding_total:0 },
    { client_id:"3",client_name:"Constructora Delta",company_name:"Delta SA",orders_count:7,sales_total:610000,paid_total:440000,outstanding_total:170000 },
    { client_id:"4",client_name:"Café Sur",company_name:null,orders_count:8,sales_total:485000,paid_total:420000,outstanding_total:65000 },
    { client_id:"5",client_name:"Eventos Prisma",company_name:null,orders_count:5,sales_total:390000,paid_total:310000,outstanding_total:80000 }
  ];

  const orderStatuses: OrderStatusReport[] = [
    {status:"in_production",orders_count:18,sales_total:1120000},
    {status:"ready",orders_count:11,sales_total:790000},
    {status:"pending_delivery",orders_count:9,sales_total:560000},
    {status:"delivered",orders_count:42,sales_total:2380000},
    {status:"confirmed",orders_count:14,sales_total:810000}
  ];

  const paymentMethods: PaymentMethodReport[] = [
    {payment_method_id:"1",code:"transfer",name:"Transferencia",payments_count:38,amount:2140000,share_pct:44.5},
    {payment_method_id:"2",code:"cash",name:"Efectivo",payments_count:31,amount:1320000,share_pct:27.4},
    {payment_method_id:"3",code:"mercadopago",name:"Mercado Pago",payments_count:22,amount:870000,share_pct:18.1},
    {payment_method_id:"4",code:"credit",name:"Tarjeta de crédito",payments_count:9,amount:480000,share_pct:10}
  ];

  const production: ProductionStageReport[] = [
    {status:"pending",jobs_count:8,overdue_count:1,completed_count:0,average_hours:0},
    {status:"design",jobs_count:6,overdue_count:2,completed_count:0,average_hours:0},
    {status:"waiting_approval",jobs_count:4,overdue_count:1,completed_count:0,average_hours:0},
    {status:"production",jobs_count:12,overdue_count:2,completed_count:0,average_hours:0},
    {status:"finished",jobs_count:7,overdue_count:0,completed_count:23,average_hours:29.4},
    {status:"delivery",jobs_count:5,overdue_count:1,completed_count:0,average_hours:0}
  ];

  const inventory: InventoryReport[] = [
    {material_id:"1",code:"VIN-BL",name:"Vinilo blanco",category:"Vinilos",unit:"m²",current_stock:38,minimum_stock:20,unit_cost:3200,inventory_value:121600,consumed_quantity:62,consumed_value:198400,low_stock:false},
    {material_id:"2",code:"PAP-300",name:"Papel ilustración 300g",category:"Papeles",unit:"hojas",current_stock:9,minimum_stock:10,unit_cost:800,inventory_value:7200,consumed_quantity:141,consumed_value:112800,low_stock:true},
    {material_id:"3",code:"LON-510",name:"Lona front 510g",category:"Lonas",unit:"m²",current_stock:24,minimum_stock:12,unit_cost:4100,inventory_value:98400,consumed_quantity:35,consumed_value:143500,low_stock:false},
    {material_id:"4",code:"TINT-C",name:"Tinta cyan",category:"Tintas",unit:"litros",current_stock:3.2,minimum_stock:4,unit_cost:28500,inventory_value:91200,consumed_quantity:4.8,consumed_value:136800,low_stock:true}
  ];

  const salesTotal = series.reduce((sum, row) => sum + row.sales, 0);
  const collections = series.reduce((sum, row) => sum + row.collections, 0);
  const income = series.reduce((sum, row) => sum + row.cash_income, 0);
  const expense = series.reduce((sum, row) => sum + row.cash_expense, 0);

  return {
    overview: {
      sales_total: salesTotal,
      collections_total: collections,
      outstanding_total: salesTotal - collections,
      orders_count: series.reduce((sum, row) => sum + row.orders_count, 0),
      average_ticket: salesTotal / Math.max(series.reduce((sum, row) => sum + row.orders_count, 0), 1),
      active_clients: 34,
      cash_income: income,
      cash_expense: expense,
      cash_net: income - expense,
      completed_jobs: 23,
      average_production_hours: 29.4,
      inventory_value: inventory.reduce((sum, row) => sum + row.inventory_value, 0),
      low_stock_count: inventory.filter((row) => row.low_stock).length
    },
    series,
    topClients,
    orderStatuses,
    paymentMethods,
    production,
    inventory
  };
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function ReportsClient() {
  const { currentCompany, settings } = useTenant();

  const [tab, setTab] = useState<Tab>("general");
  const [fromDate, setFromDate] = useState(startOfMonth());
  const [toDate, setToDate] = useState(isoDate(new Date()));
  const [preset, setPreset] = useState("month");

  const [data, setData] = useState<ReportBundle>(demoMode ? demoBundle() : {
    overview: EMPTY_OVERVIEW,
    series: [],
    topClients: [],
    orderStatuses: [],
    paymentMethods: [],
    production: [],
    inventory: []
  });

  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState("");
  const [documentBusy, setDocumentBusy] = useState<"pdf" | "print" | null>(null);

  const locale = settings?.locale || "es-AR";
  const currency = settings?.currency || "ARS";

  const money = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0
    }).format(value);

  const number = (value: number, digits = 0) =>
    new Intl.NumberFormat(locale, {
      maximumFractionDigits: digits
    }).format(value);

  const dateLabel = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short"
    }).format(new Date(`${value}T12:00:00`));

  async function load() {
    if (demoMode) {
      setData(demoBundle());
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;

    setLoading(true);
    setError("");
    try {
      setData(
        await getReportBundle(
          supabaseBrowser,
          currentCompany.id,
          fromDate,
          toDate
        )
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id, fromDate, toDate]);

  function applyPreset(value: string) {
    setPreset(value);
    const now = new Date();
    const today = isoDate(now);

    if (value === "7") {
      setFromDate(daysAgo(7));
      setToDate(today);
    } else if (value === "30") {
      setFromDate(daysAgo(30));
      setToDate(today);
    } else if (value === "90") {
      setFromDate(daysAgo(90));
      setToDate(today);
    } else if (value === "year") {
      setFromDate(startOfYear(now));
      setToDate(today);
    } else {
      setFromDate(startOfMonth(now));
      setToDate(today);
    }
  }

  const maxSeries = useMemo(
    () =>
      Math.max(
        1,
        ...data.series.flatMap((row) => [row.sales, row.collections])
      ),
    [data.series]
  );

  const maxClient = useMemo(
    () => Math.max(1, ...data.topClients.map((row) => row.sales_total)),
    [data.topClients]
  );

  const maxStatus = useMemo(
    () => Math.max(1, ...data.orderStatuses.map((row) => row.orders_count)),
    [data.orderStatuses]
  );

  const maxInventoryConsumption = useMemo(
    () => Math.max(1, ...data.inventory.map((row) => row.consumed_value)),
    [data.inventory]
  );

  async function exportDocument(action: "pdf" | "print") {
    if (!currentCompany) return;

    setDocumentBusy(action);
    setError("");
    try {
      const profile = buildCompanyDocumentProfile(currentCompany, settings);
      if (action === "pdf") {
        await downloadReportPdf(profile, data, fromDate, toDate);
      } else {
        printReport(profile, data, fromDate, toDate);
      }

      if (!demoMode && supabaseBrowser) {
        await logDocumentAction(
          supabaseBrowser,
          currentCompany.id,
          "report",
          `${fromDate}:${toDate}`,
          action
        );
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDocumentBusy(null);
    }
  }

  function exportCsv() {
    const rows: string[][] = [];

    rows.push(["GestArt - Reporte"]);
    rows.push(["Empresa", currentCompany?.name || "Empresa"]);
    rows.push(["Desde", fromDate]);
    rows.push(["Hasta", toDate]);
    rows.push([]);

    rows.push(["RESUMEN"]);
    rows.push(["Ventas", String(data.overview.sales_total)]);
    rows.push(["Cobros", String(data.overview.collections_total)]);
    rows.push(["Saldo pendiente", String(data.overview.outstanding_total)]);
    rows.push(["Pedidos", String(data.overview.orders_count)]);
    rows.push(["Ticket promedio", String(data.overview.average_ticket)]);
    rows.push(["Clientes activos", String(data.overview.active_clients)]);
    rows.push(["Ingresos de caja", String(data.overview.cash_income)]);
    rows.push(["Egresos de caja", String(data.overview.cash_expense)]);
    rows.push(["Neto de caja", String(data.overview.cash_net)]);
    rows.push([]);

    rows.push(["EVOLUCION"]);
    rows.push(["Fecha", "Ventas", "Cobros", "Ingresos caja", "Egresos caja", "Pedidos"]);
    for (const row of data.series) {
      rows.push([
        row.period_date,
        String(row.sales),
        String(row.collections),
        String(row.cash_income),
        String(row.cash_expense),
        String(row.orders_count)
      ]);
    }
    rows.push([]);

    rows.push(["CLIENTES"]);
    rows.push(["Cliente", "Empresa", "Pedidos", "Ventas", "Cobrado", "Pendiente"]);
    for (const row of data.topClients) {
      rows.push([
        row.client_name,
        row.company_name || "",
        String(row.orders_count),
        String(row.sales_total),
        String(row.paid_total),
        String(row.outstanding_total)
      ]);
    }
    rows.push([]);

    rows.push(["MEDIOS DE PAGO"]);
    rows.push(["Metodo", "Operaciones", "Monto", "Participacion"]);
    for (const row of data.paymentMethods) {
      rows.push([
        row.name,
        String(row.payments_count),
        String(row.amount),
        String(row.share_pct)
      ]);
    }
    rows.push([]);

    rows.push(["INVENTARIO"]);
    rows.push(["Material", "Codigo", "Stock", "Unidad", "Valor", "Consumo", "Valor consumido", "Stock bajo"]);
    for (const row of data.inventory) {
      rows.push([
        row.name,
        row.code || "",
        String(row.current_stock),
        row.unit,
        String(row.inventory_value),
        String(row.consumed_quantity),
        String(row.consumed_value),
        row.low_stock ? "Si" : "No"
      ]);
    }

    const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `gestart-reporte-${fromDate}-${toDate}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const collectionRate =
    data.overview.sales_total > 0
      ? Math.min(100, (data.overview.collections_total / data.overview.sales_total) * 100)
      : 0;

  return (
    <>
      <Topbar eyebrow="Analítica" title="Reportes" />

      <div className="page-content page-stack reports-page-real">
        <section className="module-intro reports-intro-real">
          <div className="module-copy">
            <span className="module-kicker">INTELIGENCIA DEL NEGOCIO</span>
            <h2>
              Decisiones con <span>datos reales.</span>
            </h2>
            <p>
              Cruzá ventas, cobros, clientes, producción, caja e inventario.
              Todos los indicadores respetan la empresa seleccionada.
            </p>
          </div>

          <div className="module-actions reports-document-actions">
            <button
              className="button document-primary-action"
              type="button"
              onClick={() => void exportDocument("pdf")}
              disabled={loading || documentBusy !== null}
            >
              <Icon name="download" size={14} /> {documentBusy === "pdf" ? "Generando..." : "Descargar PDF"}
            </button>
            <button
              className="button modal-secondary"
              type="button"
              onClick={() => void exportDocument("print")}
              disabled={loading || documentBusy !== null}
            >
              <Icon name="printer" size={14} /> {documentBusy === "print" ? "Abriendo..." : "Imprimir"}
            </button>
            <button
              className="button button-dark"
              type="button"
              onClick={exportCsv}
              disabled={loading}
            >
              <Icon name="database" size={14} /> Exportar CSV
            </button>
          </div>
        </section>

        {error && <div className="form-message error">{error}</div>}

        <section className="reports-period-bar">
          <div className="reports-presets">
            {[
              ["7", "7 días"],
              ["30", "30 días"],
              ["90", "90 días"],
              ["month", "Este mes"],
              ["year", "Este año"]
            ].map(([value, label]) => (
              <button
                type="button"
                className={preset === value ? "active" : ""}
                key={value}
                onClick={() => applyPreset(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="reports-custom-dates">
            <label>
              <span>Desde</span>
              <input
                type="date"
                value={fromDate}
                max={toDate}
                onChange={(event) => {
                  setPreset("custom");
                  setFromDate(event.target.value);
                }}
              />
            </label>
            <label>
              <span>Hasta</span>
              <input
                type="date"
                value={toDate}
                min={fromDate}
                max={isoDate(new Date())}
                onChange={(event) => {
                  setPreset("custom");
                  setToDate(event.target.value);
                }}
              />
            </label>
          </div>
        </section>

        <section className="compact-metrics">
          <CompactMetric icon="money" tone="green" label="Ventas" value={money(data.overview.sales_total)} />
          <CompactMetric icon="cash" tone="blue" label="Cobrado" value={money(data.overview.collections_total)} />
          <CompactMetric icon="alert" tone="orange" label="Pendiente" value={money(data.overview.outstanding_total)} />
          <CompactMetric icon="orders" tone="purple" label="Pedidos" value={number(data.overview.orders_count)} />
        </section>

        <section className="reports-tabs" aria-label="Secciones del reporte">
          {TABS.map((item) => (
            <button
              type="button"
              className={tab === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setTab(item.id)}
            >
              <Icon name={item.icon} size={14} />
              {item.label}
            </button>
          ))}
        </section>

        {loading ? (
          <section className="reports-loading">
            {[0, 1, 2, 3, 4, 5].map((item) => <div key={item} />)}
          </section>
        ) : (
          <>
            {(tab === "general" || tab === "sales") && (
              <section className="reports-grid reports-grid-main">
                <article className="gestart-card reports-chart-card">
                  <div className="gestart-card-body">
                    <div className="gestart-card-title">
                      <div>
                        <h3>Ventas y cobros</h3>
                        <p>Evolución diaria del período seleccionado.</p>
                      </div>
                      <div className="reports-legend">
                        <span><i className="sales" />Ventas</span>
                        <span><i className="collections" />Cobros</span>
                      </div>
                    </div>

                    {data.series.length === 0 ? (
                      <div className="reports-empty-small">No hay movimientos en este período.</div>
                    ) : (
                      <div className="reports-bar-chart">
                        {data.series.map((row) => (
                          <div className="reports-bar-column" key={row.period_date}>
                            <div className="reports-bar-area">
                              <span
                                className="reports-bar sales"
                                title={`Ventas: ${money(row.sales)}`}
                                style={{ height: `${Math.max(2, (row.sales / maxSeries) * 100)}%` }}
                              />
                              <span
                                className="reports-bar collections"
                                title={`Cobros: ${money(row.collections)}`}
                                style={{ height: `${Math.max(2, (row.collections / maxSeries) * 100)}%` }}
                              />
                            </div>
                            <small>{dateLabel(row.period_date)}</small>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </article>

                <article className="gestart-card reports-health-card">
                  <div className="gestart-card-body">
                    <div className="gestart-card-title">
                      <div>
                        <h3>Salud comercial</h3>
                        <p>Indicadores rápidos del período.</p>
                      </div>
                    </div>

                    <div className="reports-health-list">
                      <div>
                        <span>Ticket promedio</span>
                        <strong>{money(data.overview.average_ticket)}</strong>
                      </div>
                      <div>
                        <span>Clientes con actividad</span>
                        <strong>{number(data.overview.active_clients)}</strong>
                      </div>
                      <div>
                        <span>Tasa de cobro</span>
                        <strong>{number(collectionRate, 1)}%</strong>
                      </div>
                      <div>
                        <span>Neto de caja</span>
                        <strong className={data.overview.cash_net >= 0 ? "reports-positive" : "reports-negative"}>
                          {money(data.overview.cash_net)}
                        </strong>
                      </div>
                    </div>

                    <div className="reports-progress">
                      <div>
                        <span>Tasa de cobro</span>
                        <strong>{number(collectionRate, 1)}%</strong>
                      </div>
                      <div className="reports-progress-track">
                        <span style={{ width: `${collectionRate}%` }} />
                      </div>
                    </div>
                  </div>
                </article>
              </section>
            )}

            {(tab === "general" || tab === "sales") && (
              <section className="reports-grid reports-grid-secondary">
                <article className="gestart-card">
                  <div className="gestart-card-body">
                    <div className="gestart-card-title">
                      <div>
                        <h3>Pedidos por estado</h3>
                        <p>Distribución operativa de las ventas.</p>
                      </div>
                    </div>
                    <div className="reports-ranked-list">
                      {data.orderStatuses.map((row) => (
                        <div key={row.status}>
                          <div>
                            <span>{STATUS_LABELS[row.status] || row.status}</span>
                            <strong>{row.orders_count}</strong>
                          </div>
                          <div className="reports-rank-track">
                            <span style={{ width: `${(row.orders_count / maxStatus) * 100}%` }} />
                          </div>
                          <small>{money(row.sales_total)}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                </article>

                <article className="gestart-card">
                  <div className="gestart-card-body">
                    <div className="gestart-card-title">
                      <div>
                        <h3>Medios de pago</h3>
                        <p>Participación de los cobros registrados.</p>
                      </div>
                    </div>
                    <div className="reports-payment-list">
                      {data.paymentMethods.length === 0 ? (
                        <div className="reports-empty-small">Sin cobros en el período.</div>
                      ) : (
                        data.paymentMethods.map((row) => (
                          <div key={row.payment_method_id}>
                            <span className="reports-payment-icon">
                              <Icon name={row.code === "cash" ? "cash" : "credit"} size={14} />
                            </span>
                            <div>
                              <strong>{row.name}</strong>
                              <small>{row.payments_count} operaciones</small>
                            </div>
                            <div className="reports-payment-amount">
                              <strong>{money(row.amount)}</strong>
                              <span>{number(row.share_pct, 1)}%</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </article>
              </section>
            )}

            {(tab === "general" || tab === "clients") && (
              <section className="gestart-card reports-clients-card">
                <div className="gestart-card-body">
                  <div className="gestart-card-title">
                    <div>
                      <h3>Clientes con mayor facturación</h3>
                      <p>Ventas, cobros y saldo pendiente dentro del período.</p>
                    </div>
                  </div>

                  {data.topClients.length === 0 ? (
                    <div className="reports-empty-small">No hay clientes con ventas en este período.</div>
                  ) : (
                    <div className="data-table-wrap reports-table-wrap">
                      <table className="data-table reports-table">
                        <thead>
                          <tr>
                            <th>Cliente</th>
                            <th>Pedidos</th>
                            <th>Ventas</th>
                            <th>Cobrado</th>
                            <th>Pendiente</th>
                            <th>Participación</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.topClients.map((row) => (
                            <tr key={row.client_id}>
                              <td>
                                <strong>{row.client_name}</strong>
                                <small>{row.company_name || "Cliente particular"}</small>
                              </td>
                              <td>{row.orders_count}</td>
                              <td className="money"><strong>{money(row.sales_total)}</strong></td>
                              <td className="money reports-positive">{money(row.paid_total)}</td>
                              <td className={`money ${row.outstanding_total > 0 ? "reports-negative" : ""}`}>
                                {money(row.outstanding_total)}
                              </td>
                              <td>
                                <div className="reports-client-share">
                                  <span style={{ width: `${(row.sales_total / maxClient) * 100}%` }} />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>
            )}

            {(tab === "general" || tab === "production") && (
              <section className="reports-grid reports-production-grid">
                <article className="gestart-card">
                  <div className="gestart-card-body">
                    <div className="gestart-card-title">
                      <div>
                        <h3>Producción</h3>
                        <p>Carga actual por etapa del tablero Kanban.</p>
                      </div>
                    </div>
                    <div className="reports-production-stages">
                      {data.production.map((row) => (
                        <div key={row.status}>
                          <span>{STATUS_LABELS[row.status] || row.status}</span>
                          <strong>{row.jobs_count}</strong>
                          <small>
                            {row.overdue_count > 0
                              ? `${row.overdue_count} vencidos`
                              : "Sin vencidos"}
                          </small>
                        </div>
                      ))}
                    </div>
                  </div>
                </article>

                <article className="gestart-card reports-kpi-card">
                  <div className="gestart-card-body">
                    <div className="reports-big-kpi">
                      <span>Trabajos terminados</span>
                      <strong>{number(data.overview.completed_jobs)}</strong>
                      <small>durante el período</small>
                    </div>
                    <div className="reports-big-kpi">
                      <span>Tiempo promedio</span>
                      <strong>{number(data.overview.average_production_hours, 1)} h</strong>
                      <small>inicio → finalización</small>
                    </div>
                  </div>
                </article>
              </section>
            )}

            {(tab === "general" || tab === "cash") && (
              <section className="gestart-card reports-cash-card">
                <div className="gestart-card-body">
                  <div className="gestart-card-title">
                    <div>
                      <h3>Caja</h3>
                      <p>Ingresos y egresos operativos del período.</p>
                    </div>
                  </div>

                  <div className="reports-cash-summary">
                    <div className="income">
                      <span>Ingresos</span>
                      <strong>{money(data.overview.cash_income)}</strong>
                    </div>
                    <div className="expense">
                      <span>Egresos</span>
                      <strong>{money(data.overview.cash_expense)}</strong>
                    </div>
                    <div className={data.overview.cash_net >= 0 ? "net positive" : "net negative"}>
                      <span>Resultado neto</span>
                      <strong>{money(data.overview.cash_net)}</strong>
                    </div>
                  </div>

                  <div className="reports-cash-days">
                    {data.series.map((row) => {
                      const net = row.cash_income - row.cash_expense;
                      return (
                        <div key={row.period_date}>
                          <span>{dateLabel(row.period_date)}</span>
                          <div>
                            <i className="income" style={{ width: `${Math.min(100, row.cash_income / Math.max(maxSeries, 1) * 100)}%` }} />
                            <i className="expense" style={{ width: `${Math.min(100, row.cash_expense / Math.max(maxSeries, 1) * 100)}%` }} />
                          </div>
                          <strong className={net >= 0 ? "reports-positive" : "reports-negative"}>
                            {money(net)}
                          </strong>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {(tab === "general" || tab === "inventory") && (
              <section className="gestart-card reports-inventory-card">
                <div className="gestart-card-body">
                  <div className="gestart-card-title">
                    <div>
                      <h3>Inventario y consumo</h3>
                      <p>Valor actual y materiales más consumidos en el período.</p>
                    </div>
                    <div className="reports-inventory-total">
                      <span>Valor inventario</span>
                      <strong>{money(data.overview.inventory_value)}</strong>
                    </div>
                  </div>

                  {data.inventory.length === 0 ? (
                    <div className="reports-empty-small">No hay materiales cargados.</div>
                  ) : (
                    <div className="data-table-wrap reports-table-wrap">
                      <table className="data-table reports-table reports-inventory-table">
                        <thead>
                          <tr>
                            <th>Material</th>
                            <th>Stock</th>
                            <th>Valor actual</th>
                            <th>Consumo período</th>
                            <th>Valor consumido</th>
                            <th>Alerta</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.inventory.map((row) => (
                            <tr key={row.material_id}>
                              <td>
                                <strong>{row.name}</strong>
                                <small>{row.code || "Sin código"} · {row.category || "Sin categoría"}</small>
                              </td>
                              <td>
                                <strong>{number(row.current_stock, 3)} {row.unit}</strong>
                                <small>Mín. {number(row.minimum_stock, 3)}</small>
                              </td>
                              <td className="money">{money(row.inventory_value)}</td>
                              <td>
                                <strong>{number(row.consumed_quantity, 3)} {row.unit}</strong>
                              </td>
                              <td>
                                <div className="reports-consumption-cell">
                                  <strong>{money(row.consumed_value)}</strong>
                                  <span>
                                    <i style={{ width: `${(row.consumed_value / maxInventoryConsumption) * 100}%` }} />
                                  </span>
                                </div>
                              </td>
                              <td>
                                {row.low_stock ? (
                                  <span className="status-pill status-red">Stock bajo</span>
                                ) : (
                                  <span className="status-pill status-green">OK</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>
            )}

            {tab === "general" && (
              <section className="reports-integrity">
                <Icon name="shield" size={18} />
                <div>
                  <strong>Datos aislados por empresa</strong>
                  <p>
                    Los RPC de reportes verifican `reports.read` y reciben el
                    `company_id` del tenant activo. Una empresa no puede consultar
                    información de otra.
                  </p>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
