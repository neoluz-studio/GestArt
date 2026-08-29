"use client";

import { useEffect, useMemo, useState } from "react";
import { CompactMetric } from "@/components/Metric";
import { Icon } from "@/components/Icon";
import { Topbar } from "@/components/Topbar";
import { useTenant } from "@/contexts/TenantContext";
import { demoMode } from "@/lib/runtime";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  getAuditOverview,
  listAuditEntityTypes,
  listAuditEvents,
  listAuditUsers,
  type AuditEvent,
  type AuditOverview,
  type AuditUser
} from "@/services/history";

const EMPTY_OVERVIEW: AuditOverview = {
  events_today: 0,
  events_7d: 0,
  active_users_7d: 0,
  entity_types_7d: 0
};

const ACTION_GROUPS = [
  ["clients", "Clientes"],
  ["orders", "Pedidos"],
  ["quotes", "Presupuestos"],
  ["payments", "Pagos"],
  ["production", "Producción"],
  ["inventory", "Inventario"],
  ["cash", "Caja"],
  ["reports", "Reportes"],
  ["security", "Usuarios y seguridad"],
  ["settings", "Configuración"]
] as const;

const ENTITY_LABELS: Record<string, string> = {
  client: "Cliente",
  clients: "Cliente",
  order: "Pedido",
  orders: "Pedido",
  payment: "Pago",
  payment_batch: "Pago",
  production_job: "Producción",
  material: "Material",
  stock_movement: "Stock",
  cash_movement: "Caja",
  cash_closure: "Cierre de caja",
  company: "Empresa",
  company_settings: "Configuración",
  company_membership: "Usuario",
  company_module: "Navegación",
  role: "Rol",
  quote: "Presupuesto"
};

const DEMO_EVENTS: AuditEvent[] = [
  {
    id: 9,
    action: "cash.closed",
    entity_type: "cash_closure",
    entity_id: "demo-close",
    description: "Cierre de caja realizado",
    metadata: { expected_balance: 832000, actual_balance: 827000, difference: -5000 },
    created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    user_id: "demo-admin",
    user_name: "Administrador",
    user_email: "admin@gestart.demo"
  },
  {
    id: 8,
    action: "stock.movement",
    entity_type: "material",
    entity_id: "demo-material",
    description: "Salida de stock: Vinilo blanco",
    metadata: { quantity: -12, balance_after: 38, order_id: "demo-order" },
    created_at: new Date(Date.now() - 75 * 60_000).toISOString(),
    user_id: "demo-production",
    user_name: "Producción",
    user_email: "produccion@gestart.demo"
  },
  {
    id: 7,
    action: "production.status.changed",
    entity_type: "production_job",
    entity_id: "demo-job",
    description: "Pedido #00251 movido a Producción",
    metadata: { from: "design", to: "production" },
    created_at: new Date(Date.now() - 110 * 60_000).toISOString(),
    user_id: "demo-production",
    user_name: "Producción",
    user_email: "produccion@gestart.demo"
  },
  {
    id: 6,
    action: "payment.registered",
    entity_type: "order",
    entity_id: "demo-order",
    description: "Pago mixto registrado en pedido #00251",
    metadata: { amount: 70000, methods: 2 },
    created_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
    user_id: "demo-admin",
    user_name: "Administrador",
    user_email: "admin@gestart.demo"
  },
  {
    id: 5,
    action: "order.created",
    entity_type: "order",
    entity_id: "demo-order",
    description: "Pedido #00251 creado",
    metadata: { total: 100000, priority: "normal" },
    created_at: new Date(Date.now() - 5 * 3600_000).toISOString(),
    user_id: "demo-admin",
    user_name: "Administrador",
    user_email: "admin@gestart.demo"
  },
  {
    id: 4,
    action: "client.created",
    entity_type: "client",
    entity_id: "demo-client",
    description: "Cliente creado: Estudio Norte",
    metadata: {},
    created_at: new Date(Date.now() - 8 * 3600_000).toISOString(),
    user_id: "demo-admin",
    user_name: "Administrador",
    user_email: "admin@gestart.demo"
  },
  {
    id: 3,
    action: "company.settings.updated",
    entity_type: "company_settings",
    entity_id: "demo-company",
    description: "Configuración de empresa actualizada",
    metadata: { changed_fields: ["phone", "primary_color"] },
    created_at: new Date(Date.now() - 24 * 3600_000).toISOString(),
    user_id: "demo-admin",
    user_name: "Administrador",
    user_email: "admin@gestart.demo"
  }
];

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Error inesperado.");
  }
  return "Ocurrió un error inesperado.";
}

function actionGroup(action: string, entityType: string | null) {
  const value = `${action} ${entityType ?? ""}`.toLowerCase();
  if (value.includes("client")) return "clients";
  if (value.includes("quote")) return "quotes";
  if (value.includes("order")) return "orders";
  if (value.includes("payment")) return "payments";
  if (value.includes("production")) return "production";
  if (value.includes("material") || value.includes("stock") || value.includes("inventory")) return "inventory";
  if (value.includes("cash")) return "cash";
  if (value.includes("report")) return "reports";
  if (
    value.includes("membership") ||
    value.includes("role") ||
    value.includes("user") ||
    value.includes("security")
  ) return "security";
  if (
    value.includes("settings") ||
    value.includes("module") ||
    value.includes("company.")
  ) return "settings";
  return "other";
}

function actionTone(group: string) {
  if (group === "cash" || group === "payments") return "green";
  if (group === "production") return "blue";
  if (group === "inventory") return "orange";
  if (group === "security") return "red";
  if (group === "reports") return "blue";
  if (group === "clients") return "purple";
  if (group === "quotes") return "violet";
  if (group === "orders") return "violet";
  return "gray";
}

function actionIcon(group: string) {
  if (group === "cash" || group === "payments") return "cash" as const;
  if (group === "production") return "production" as const;
  if (group === "inventory") return "materials" as const;
  if (group === "security") return "shield" as const;
  if (group === "clients") return "users" as const;
  if (group === "quotes") return "quote" as const;
  if (group === "orders") return "orders" as const;
  if (group === "settings") return "settings" as const;
  if (group === "reports") return "reports" as const;
  return "history" as const;
}

function friendlyAction(action: string) {
  const map: Record<string, string> = {
    "client.created": "Cliente creado",
    "client.updated": "Cliente actualizado",
    "client.deleted": "Cliente eliminado",
    "quote.created": "Presupuesto creado",
    "quote.updated": "Presupuesto actualizado",
    "quote.status.changed": "Estado de presupuesto",
    "quote.duplicated": "Presupuesto duplicado",
    "quote.converted": "Presupuesto convertido",
    "order.created": "Pedido creado",
    "order.updated": "Pedido actualizado",
    "order.cancelled": "Pedido cancelado",
    "payment.registered": "Pago registrado",
    "production.status.changed": "Etapa de producción",
    "production.assignee.changed": "Responsable cambiado",
    "stock.movement": "Movimiento de stock",
    "material.created": "Material creado",
    "material.updated": "Material actualizado",
    "material.archived": "Material archivado",
    "material.restored": "Material restaurado",
    "cash.income.created": "Ingreso de caja",
    "cash.expense.created": "Egreso de caja",
    "cash.movement.reversed": "Movimiento revertido",
    "cash.closed": "Cierre de caja",
    "company.settings.updated": "Configuración actualizada",
    "company.membership.created": "Usuario agregado",
    "company.membership.updated": "Usuario actualizado",
    "company.membership.deleted": "Usuario eliminado",
    "company.module.updated": "Navegación actualizada",
    "document.pdf.generated": "PDF generado",
    "document.printed": "Documento impreso"
  };
  return map[action] ?? action.replaceAll(".", " · ");
}

function entityLabel(entityType: string | null) {
  if (!entityType) return "General";
  return ENTITY_LABELS[entityType] ?? entityType.replaceAll("_", " ");
}

function metadataEntries(metadata: Record<string, unknown>) {
  return Object.entries(metadata ?? {}).filter(([, value]) => value !== null && value !== undefined);
}

function formatMetaValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Intl.NumberFormat("es-AR").format(value);
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function csvCell(value: unknown) {
  const text = String(value ?? "").replaceAll('"', '""');
  return `"${text}"`;
}

export function HistoryClient() {
  const { currentCompany, settings } = useTenant();

  const [events, setEvents] = useState<AuditEvent[]>(demoMode ? DEMO_EVENTS : []);
  const [overview, setOverview] = useState<AuditOverview>(
    demoMode
      ? { events_today: 6, events_7d: 43, active_users_7d: 2, entity_types_7d: 8 }
      : EMPTY_OVERVIEW
  );
  const [users, setUsers] = useState<AuditUser[]>(
    demoMode
      ? [
          { user_id: "demo-admin", full_name: "Administrador", email: "admin@gestart.demo", event_count: 31 },
          { user_id: "demo-production", full_name: "Producción", email: "produccion@gestart.demo", event_count: 12 }
        ]
      : []
  );
  const [entityTypes, setEntityTypes] = useState<string[]>(
    demoMode ? ["client", "order", "production_job", "material", "cash_movement", "cash_closure", "company_settings"] : []
  );

  const [search, setSearch] = useState("");
  const [userId, setUserId] = useState("");
  const [entityType, setEntityType] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState("");

  const locale = settings?.locale || "es-AR";

  const dateTime = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));

  const shortDateTime = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));

  async function loadBase() {
    if (demoMode || !supabaseBrowser || !currentCompany) return;

    setError("");
    try {
      const [summary, userRows, typeRows] = await Promise.all([
        getAuditOverview(supabaseBrowser, currentCompany.id),
        listAuditUsers(supabaseBrowser, currentCompany.id),
        listAuditEntityTypes(supabaseBrowser, currentCompany.id)
      ]);
      setOverview(summary);
      setUsers(userRows);
      setEntityTypes(typeRows);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function loadEvents() {
    if (demoMode) {
      let rows = [...DEMO_EVENTS];
      const term = search.trim().toLowerCase();

      if (term) {
        rows = rows.filter((event) =>
          [
            event.action,
            event.description,
            event.entity_type,
            event.entity_id,
            event.user_name,
            event.user_email,
            JSON.stringify(event.metadata)
          ].some((value) => String(value ?? "").toLowerCase().includes(term))
        );
      }
      if (userId) rows = rows.filter((event) => event.user_id === userId);
      if (entityType) rows = rows.filter((event) => event.entity_type === entityType);
      if (actionFilter) rows = rows.filter((event) => actionGroup(event.action, event.entity_type) === actionFilter);
      if (fromDate) rows = rows.filter((event) => new Date(event.created_at) >= new Date(`${fromDate}T00:00:00`));
      if (toDate) rows = rows.filter((event) => new Date(event.created_at) < new Date(`${toDate}T23:59:59.999`));

      setEvents(rows);
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;

    setLoading(true);
    setError("");
    try {
      setEvents(
        await listAuditEvents(supabaseBrowser, currentCompany.id, {
          search,
          userId,
          entityType,
          actionGroup: actionFilter,
          fromDate,
          toDate,
          limit: 250
        })
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadEvents(), 220);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id, search, userId, entityType, actionFilter, fromDate, toDate]);

  const groupedByDay = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    });

    const groups: { key: string; label: string; events: AuditEvent[] }[] = [];
    const byKey = new Map<string, { key: string; label: string; events: AuditEvent[] }>();

    for (const event of events) {
      const date = new Date(event.created_at);
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      let group = byKey.get(key);

      if (!group) {
        group = {
          key,
          label: formatter.format(date),
          events: []
        };
        byKey.set(key, group);
        groups.push(group);
      }
      group.events.push(event);
    }

    return groups;
  }, [events, locale]);

  function clearFilters() {
    setSearch("");
    setUserId("");
    setEntityType("");
    setActionFilter("");
    setFromDate("");
    setToDate("");
  }

  function exportCsv() {
    const rows = [
      ["Fecha", "Usuario", "Email", "Acción", "Entidad", "ID entidad", "Descripción", "Metadata"],
      ...events.map((event) => [
        dateTime(event.created_at),
        event.user_name,
        event.user_email ?? "",
        event.action,
        event.entity_type ?? "",
        event.entity_id ?? "",
        event.description ?? "",
        JSON.stringify(event.metadata ?? {})
      ])
    ];

    const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);

    anchor.href = url;
    anchor.download = `gestart-historial-${date}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const filtersActive = Boolean(search || userId || entityType || actionFilter || fromDate || toDate);

  return (
    <>
      <Topbar eyebrow="Auditoría" title="Historial" />

      <div className="page-content page-stack history-page-real">
        <section className="module-intro history-intro-real">
          <div className="module-copy">
            <span className="module-kicker">TRAZABILIDAD GENERAL</span>
            <h2>
              Cada acción deja <span>huella.</span>
            </h2>
            <p>
              Consultá quién hizo qué, cuándo y sobre qué registro. El historial está aislado por empresa y no se edita desde la aplicación.
            </p>
          </div>

          <div className="module-actions">
            <button className="button button-dark" type="button" onClick={exportCsv} disabled={events.length === 0}>
              <Icon name="database" size={14} /> Exportar CSV
            </button>
          </div>
        </section>

        {error && <div className="form-message error">{error}</div>}

        <section className="compact-metrics">
          <CompactMetric icon="history" tone="purple" label="Eventos hoy" value={String(overview.events_today)} />
          <CompactMetric icon="calendar" tone="blue" label="Últimos 7 días" value={String(overview.events_7d)} />
          <CompactMetric icon="users" tone="green" label="Usuarios activos" value={String(overview.active_users_7d)} />
          <CompactMetric icon="database" tone="orange" label="Tipos auditados" value={String(overview.entity_types_7d)} />
        </section>

        <section className="filter-bar history-filters">
          <label className="filter-search history-search">
            <Icon name="search" size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar acción, descripción, usuario, pedido, material..."
            />
          </label>

          <select className="filter-select" value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">Todos los usuarios</option>
            {users.map((user) => (
              <option value={user.user_id} key={user.user_id}>
                {user.full_name} ({user.event_count})
              </option>
            ))}
          </select>

          <select className="filter-select" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
            <option value="">Todos los módulos</option>
            {ACTION_GROUPS.map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>

          <select className="filter-select" value={entityType} onChange={(event) => setEntityType(event.target.value)}>
            <option value="">Todas las entidades</option>
            {entityTypes.map((type) => (
              <option value={type} key={type}>{entityLabel(type)}</option>
            ))}
          </select>

          <label className="history-date-filter">
            <span>Desde</span>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>

          <label className="history-date-filter">
            <span>Hasta</span>
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>

          {filtersActive && (
            <button className="button modal-secondary history-clear-button" type="button" onClick={clearFilters}>
              Limpiar
            </button>
          )}
        </section>

        <section className="gestart-card history-feed-card">
          <div className="gestart-card-body">
            <div className="gestart-card-title history-card-title">
              <div>
                <h3>Actividad de la empresa</h3>
                <p>Mostrando hasta 250 eventos según los filtros actuales.</p>
              </div>
              <span>{events.length} eventos</span>
            </div>

            {loading ? (
              <div className="history-loading">
                {[0,1,2,3,4,5].map((item) => (
                  <div key={item}>
                    <span /><span /><span />
                  </div>
                ))}
              </div>
            ) : groupedByDay.length === 0 ? (
              <div className="clients-empty history-empty">
                <span><Icon name="history" size={24} /></span>
                <strong>No encontramos eventos</strong>
                <p>Probá limpiar los filtros o realizar una operación en GestArt.</p>
                {filtersActive && (
                  <button className="button button-dark" type="button" onClick={clearFilters}>
                    Limpiar filtros
                  </button>
                )}
              </div>
            ) : (
              <div className="history-day-list">
                {groupedByDay.map((day) => (
                  <section className="history-day" key={day.key}>
                    <div className="history-day-title">
                      <span>{day.label}</span>
                      <small>{day.events.length}</small>
                    </div>

                    <div className="history-event-list">
                      {day.events.map((event) => {
                        const group = actionGroup(event.action, event.entity_type);
                        const metaCount = metadataEntries(event.metadata).length;

                        return (
                          <button
                            className="history-event"
                            type="button"
                            key={event.id}
                            onClick={() => setSelected(event)}
                          >
                            <div className="history-event-time">
                              <strong>{shortDateTime(event.created_at).split(",").at(-1)?.trim() ?? ""}</strong>
                            </div>

                            <div className={`history-event-icon tone-${actionTone(group)}`}>
                              <Icon name={actionIcon(group)} size={15} />
                            </div>

                            <div className="history-event-main">
                              <div className="history-event-heading">
                                <strong>{friendlyAction(event.action)}</strong>
                                <span>{entityLabel(event.entity_type)}</span>
                              </div>
                              <p>{event.description || "Evento registrado"}</p>
                              <div className="history-event-user">
                                <span className="history-user-avatar">
                                  {event.user_name.slice(0, 1).toUpperCase()}
                                </span>
                                <span>
                                  {event.user_name}
                                  {event.user_email ? ` · ${event.user_email}` : ""}
                                </span>
                              </div>
                            </div>

                            <div className="history-event-meta">
                              {metaCount > 0 && <span>{metaCount} datos</span>}
                              <Icon name="arrow" size={13} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="history-integrity">
          <Icon name="shield" size={18} />
          <div>
            <strong>Historial protegido</strong>
            <p>
              Los eventos pueden consultarse y exportarse, pero GestArt no permite modificarlos ni borrarlos desde los módulos operativos.
            </p>
          </div>
        </section>

        {selected && (
          <div
            className="drawer-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) setSelected(null);
            }}
          >
            <aside className="client-drawer history-drawer">
              <div className="drawer-head">
                <div className="drawer-client">
                  <span className={`history-detail-icon tone-${actionTone(actionGroup(selected.action, selected.entity_type))}`}>
                    <Icon name={actionIcon(actionGroup(selected.action, selected.entity_type))} size={20} />
                  </span>
                  <div>
                    <span>EVENTO #{selected.id}</span>
                    <h3>{friendlyAction(selected.action)}</h3>
                    <p>{dateTime(selected.created_at)}</p>
                  </div>
                </div>
                <button type="button" className="modal-close" onClick={() => setSelected(null)}>×</button>
              </div>

              <section className="drawer-section">
                <h4>Descripción</h4>
                <p className="history-detail-description">
                  {selected.description || "Sin descripción adicional."}
                </p>
              </section>

              <section className="drawer-section">
                <h4>Actor</h4>
                <div className="history-actor-card">
                  <span className="history-user-avatar large">
                    {selected.user_name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{selected.user_name}</strong>
                    <span>{selected.user_email || "Evento generado por sistema"}</span>
                    {selected.user_id && <small>ID: {selected.user_id}</small>}
                  </div>
                </div>
              </section>

              <section className="drawer-section">
                <h4>Entidad</h4>
                <div className="contact-grid">
                  <div>
                    <span>Tipo</span>
                    <strong>{entityLabel(selected.entity_type)}</strong>
                  </div>
                  <div>
                    <span>Acción técnica</span>
                    <strong>{selected.action}</strong>
                  </div>
                  <div className="full">
                    <span>ID del registro</span>
                    <strong className="history-entity-id">{selected.entity_id || "—"}</strong>
                  </div>
                </div>
              </section>

              <section className="drawer-section">
                <div className="drawer-section-head">
                  <h4>Datos del evento</h4>
                  <span>{metadataEntries(selected.metadata).length}</span>
                </div>

                {metadataEntries(selected.metadata).length === 0 ? (
                  <p className="muted-small">Este evento no tiene metadatos adicionales.</p>
                ) : (
                  <div className="history-metadata-list">
                    {metadataEntries(selected.metadata).map(([key, value]) => (
                      <div className="history-metadata-row" key={key}>
                        <span>{key.replaceAll("_", " ")}</span>
                        <strong>{formatMetaValue(value)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="drawer-section history-technical-section">
                <h4>Información técnica</h4>
                <div className="history-code-block">
                  <span>event_id: {selected.id}</span>
                  <span>created_at: {selected.created_at}</span>
                  <span>company: tenant actual</span>
                </div>
              </section>
            </aside>
          </div>
        )}
      </div>
    </>
  );
}
