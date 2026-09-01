"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { CompactMetric } from "@/components/Metric";
import { Icon } from "@/components/Icon";
import { Topbar } from "@/components/Topbar";
import { useTenant } from "@/contexts/TenantContext";
import { useAppState } from "@/contexts/AppStateContext";
import { clients as demoClients, money as demoMoney, quotes as demoQuotes } from "@/lib/demo-data";
import { demoMode } from "@/lib/runtime";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { listClients, type ClientSummary } from "@/services/clients";
import { buildCompanyDocumentProfile, loadDocumentClient, loadDocumentPaymentMethods, logDocumentAction, type DocumentClient } from "@/services/documents";
import { downloadQuotePdf, printQuoteDocument } from "@/lib/documents/generator";
import {
  changeQuoteStatus,
  convertQuoteToOrder,
  createQuote,
  duplicateQuote,
  getQuoteOverview,
  listQuotes,
  loadQuoteDetail,
  updateQuote,
  type QuoteDetail,
  type QuoteInput,
  type QuoteOverview,
  type QuoteStatus,
  type QuoteSummary,
  type StoredQuoteStatus
} from "@/services/quotes";

const today = () => new Date().toISOString().slice(0, 10);

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

const EMPTY_QUOTE: QuoteInput = {
  client_id: "",
  issue_date: today(),
  valid_until: addDays(today(), 15),
  status: "draft",
  discount: 0,
  notes: "",
  items: [{ description: "", quantity: 1, unit_price: 0 }]
};

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Todos los estados" },
  { value: "draft", label: "Borrador" },
  { value: "sent", label: "Enviado" },
  { value: "approved", label: "Aprobado" },
  { value: "rejected", label: "Rechazado" },
  { value: "expired", label: "Vencido" },
  { value: "converted", label: "Convertido" },
  { value: "cancelled", label: "Cancelado" }
];

const PRIORITIES = [
  ["normal", "Normal"],
  ["high", "Alta"],
  ["urgent", "Urgente"],
  ["low", "Baja"]
] as const;

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Error inesperado.");
  }
  return "Ocurrió un error inesperado.";
}

function statusLabel(status: QuoteStatus | string) {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status;
}

function statusClass(status: string) {
  if (status === "approved" || status === "converted") return "status-green";
  if (status === "sent") return "status-blue";
  if (status === "draft") return "status-gray";
  if (status === "expired") return "status-orange";
  if (status === "rejected" || status === "cancelled") return "status-red";
  return "status-gray";
}

function demoRows(): QuoteSummary[] {
  return demoQuotes.map((quote, index) => {
    const number = Number(String(quote.number).replace(/\D/g, "")) || index + 1;
    const status: QuoteStatus =
      quote.status === "Aprobado"
        ? "approved"
        : quote.status === "Enviado"
          ? "sent"
          : "draft";

    return {
      id: `demo-quote-${index}`,
      quote_number: number,
      client_id: demoClients[index % demoClients.length]?.id ?? `demo-client-${index}`,
      client_name: quote.client,
      client_company: null,
      client_phone: null,
      client_email: null,
      status,
      stored_status: status as StoredQuoteStatus,
      issue_date: quote.date.split("/").reverse().join("-"),
      valid_until: quote.validUntil.split("/").reverse().join("-"),
      subtotal: quote.total,
      discount: 0,
      total: quote.total,
      item_count: 1,
      first_item: quote.detail,
      notes: null,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      approved_at: status === "approved" ? new Date().toISOString() : null,
      rejected_at: null,
      converted_at: null,
      converted_order_id: null,
      converted_order_number: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  });
}

export function QuotesClient() {
  const { currentCompany, settings } = useTenant();
  const {
  state,
  updateState
} = useAppState();

  const [quotes, setQuotes] = useState<QuoteSummary[]>(demoMode ? demoRows() : []);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [overview, setOverview] = useState<QuoteOverview>(
    demoMode
      ? {
          total_quotes: demoRows().length,
          open_quotes: demoRows().filter((item) => ["draft", "sent"].includes(item.status)).length,
          approved_quotes: demoRows().filter((item) => item.status === "approved").length,
          converted_quotes: 0,
          quoted_total: demoRows().reduce((sum, item) => sum + item.total, 0)
        }
      : {
          total_quotes: 0,
          open_quotes: 0,
          approved_quotes: 0,
          converted_quotes: 0,
          quoted_total: 0
        }
  );

  const [search, setSearch] = useState(
  state.filters.quotesSearch || ""
);

const [statusFilter, setStatusFilter] = useState(
  state.filters.quotesStatus || ""
);

const [daysFilter, setDaysFilter] = useState(
  state.filters.quotesDays || "30"
);
useEffect(() => {

  updateState({
    filters: {
      quotesSearch: search,
      quotesStatus: statusFilter,
      quotesDays: daysFilter
    }
  });

}, [
  search,
  statusFilter,
  daysFilter]);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [formOpen, setFormOpen] = useState(
  state.quoteDraft?.formOpen ?? false
);

const [editing, setEditing] = useState<QuoteDetail | null>(
  state.quoteDraft?.editing ?? null
);

const [form, setForm] = useState<QuoteInput>(
  state.quoteDraft?.form ?? EMPTY_QUOTE
);
useEffect(() => {

  updateState({
    quoteDraft: {
      form,
      formOpen,
      editing
    }
  });

}, [
  form,
  formOpen,
  editing
]);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [documentBusy, setDocumentBusy] = useState<"pdf" | "print" | null>(null);

  const [convertOpen, setConvertOpen] = useState(false);
  const [convertDeliveryDate, setConvertDeliveryDate] = useState("");
  const [convertPriority, setConvertPriority] = useState<"urgent" | "high" | "normal" | "low">("normal");
  const [convertNotes, setConvertNotes] = useState("");
  const [converting, setConverting] = useState(false);
  const [convertedOrder, setConvertedOrder] = useState<{ id: string; number: number } | null>(null);

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

  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(locale, {
          day: "2-digit",
          month: "2-digit",
          year: "numeric"
        }).format(new Date(`${value}T12:00:00`))
      : "—";

  const dateTime = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "short",
          timeStyle: "short"
        }).format(new Date(value))
      : "—";

  const formSubtotal = useMemo(
    () =>
      form.items.reduce(
        (sum, item) =>
          sum +
          Math.max(0, Number(item.quantity) || 0) *
            Math.max(0, Number(item.unit_price) || 0),
        0
      ),
    [form.items]
  );

  const formTotal = Math.max(
    formSubtotal - Math.max(0, Number(form.discount) || 0),
    0
  );

  async function loadBase() {
    if (demoMode || !supabaseBrowser || !currentCompany) return;

    try {
      const [summary, clientRows] = await Promise.all([
        getQuoteOverview(supabaseBrowser, currentCompany.id),
        listClients(supabaseBrowser, currentCompany.id, "")
      ]);
      setOverview(summary);
      setClients(clientRows.filter((client) => client.is_active));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function load() {
    if (demoMode) {
      let rows = demoRows();
      const term = search.trim().toLowerCase();

      if (term) {
        rows = rows.filter((quote) =>
          [
            String(quote.quote_number),
            quote.client_name,
            quote.first_item,
            quote.client_company
          ].some((value) =>
            String(value ?? "").toLowerCase().includes(term)
          )
        );
      }

      if (statusFilter) {
        rows = rows.filter((quote) => quote.status === statusFilter);
      }

      setQuotes(rows);
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;

    setLoading(true);
    setError("");
    try {
      setQuotes(
        await listQuotes(supabaseBrowser, currentCompany.id, {
          search,
          status: statusFilter,
          days: daysFilter
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
    const timer = window.setTimeout(() => void load(), 240);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id, search, statusFilter, daysFilter]);

  function openNew() {
    setEditing(null);
    setForm({
      ...EMPTY_QUOTE,
      issue_date: today(),
      valid_until: addDays(today(), 15),
      items: [{ description: "", quantity: 1, unit_price: 0 }]
    });
    setFormOpen(true);
    setError("");
    setSuccess("");
  }

  async function openDetail(summary: QuoteSummary) {
    setConvertedOrder(null);

    if (demoMode) {
      setDetail({
        quote: summary,
        items: [
          {
            id: "demo-item",
            description: summary.first_item || "Trabajo gráfico",
            quantity: 1,
            unit_price: summary.total,
            total: summary.total,
            sort_order: 1
          }
        ]
      });
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;
    setDetailLoading(true);
    setError("");
    try {
      setDetail(
        await loadQuoteDetail(
          supabaseBrowser,
          currentCompany.id,
          summary.id
        )
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  }

  async function openEdit(summary: QuoteSummary) {
    if (summary.stored_status === "converted" || summary.stored_status === "cancelled") {
      setError("Un presupuesto convertido o cancelado no puede editarse.");
      return;
    }

    if (demoMode) {
      setEditing({
        quote: summary,
        items: [
          {
            id: "demo-item",
            description: summary.first_item || "Trabajo gráfico",
            quantity: 1,
            unit_price: summary.total,
            total: summary.total,
            sort_order: 1
          }
        ]
      });
      setForm({
        client_id: summary.client_id,
        issue_date: summary.issue_date,
        valid_until: summary.valid_until,
        status: summary.stored_status,
        discount: summary.discount,
        notes: summary.notes,
        items: [
          {
            description: summary.first_item || "Trabajo gráfico",
            quantity: 1,
            unit_price: summary.total
          }
        ]
      });
      setFormOpen(true);
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;
    setDetailLoading(true);
    setError("");
    try {
      const next = await loadQuoteDetail(
        supabaseBrowser,
        currentCompany.id,
        summary.id
      );
      setEditing(next);
      setForm({
        client_id: next.quote.client_id,
        issue_date: next.quote.issue_date,
        valid_until: next.quote.valid_until,
        status:
          next.quote.stored_status === "converted"
            ? "approved"
            : next.quote.stored_status,
        discount: next.quote.discount,
        notes: next.quote.notes,
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

  function validateForm() {
    if (!form.client_id) return "Seleccioná un cliente.";
    if (!form.issue_date) return "Indicá la fecha del presupuesto.";
    if (form.valid_until && form.valid_until < form.issue_date) {
      return "La fecha de validez no puede ser anterior a la fecha de emisión.";
    }
    if (!form.items.length) return "Agregá al menos un ítem.";
    if (
      form.items.some(
        (item) =>
          !item.description.trim() ||
          Number(item.quantity) <= 0 ||
          Number(item.unit_price) < 0
      )
    ) {
      return "Revisá las descripciones, cantidades y precios.";
    }
    if (Number(form.discount) < 0 || Number(form.discount) > formSubtotal) {
      return "El descuento no puede ser negativo ni superar el subtotal.";
    }
    return null;
  }

  async function saveQuote(event: FormEvent) {
    event.preventDefault();
    const validation = validateForm();
    if (validation) {
      setError(validation);
      return;
    }

    if (demoMode) {
      setFormOpen(false);
      setSuccess(
        editing
          ? "Presupuesto actualizado en modo demo."
          : "Presupuesto creado en modo demo."
      );
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;

    setSaving(true);
    setError("");
    try {
      if (editing) {
        await updateQuote(
          supabaseBrowser,
          currentCompany.id,
          editing.quote.id,
          form
        );
        setSuccess("Presupuesto actualizado.");
      } else {
        await createQuote(supabaseBrowser, currentCompany.id, form);
        setSuccess("Presupuesto creado.");
      }

      setFormOpen(false);
      setEditing(null);
      await Promise.all([loadBase(), load()]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function setQuoteStatus(
    quote: QuoteSummary,
    status: Exclude<StoredQuoteStatus, "converted">
  ) {
    if (demoMode) {
      setSuccess(`Estado cambiado a ${statusLabel(status)} en modo demo.`);
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;

    setStatusSaving(true);
    setError("");
    try {
      await changeQuoteStatus(
        supabaseBrowser,
        currentCompany.id,
        quote.id,
        status
      );
      setSuccess(`Presupuesto marcado como ${statusLabel(status)}.`);
      await Promise.all([loadBase(), load()]);
      if (detail?.quote.id === quote.id) {
        setDetail(
          await loadQuoteDetail(
            supabaseBrowser,
            currentCompany.id,
            quote.id
          )
        );
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStatusSaving(false);
    }
  }

  async function cloneQuote(quote: QuoteSummary) {
    if (demoMode) {
      setSuccess("Presupuesto duplicado en modo demo.");
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;

    setError("");
    try {
      await duplicateQuote(
        supabaseBrowser,
        currentCompany.id,
        quote.id
      );
      setSuccess("Presupuesto duplicado como borrador.");
      await Promise.all([loadBase(), load()]);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function exportQuote(action: "pdf" | "print") {
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
        const demo = demoClients.find((item) => item.id === detail.quote.client_id);
        client = {
          id: detail.quote.client_id,
          name: detail.quote.client_name,
          company_name: detail.quote.client_company || demo?.company || null,
          tax_id: null,
          phone: detail.quote.client_phone || demo?.phone || null,
          email: detail.quote.client_email || demo?.email || null,
          address: null
        };
      } else {
        if (!supabaseBrowser) return;
        client = await loadDocumentClient(
          supabaseBrowser,
          currentCompany.id,
          detail.quote.client_id
        );
      }

      if (action === "pdf") {
        await downloadQuotePdf(profile, detail, client);
      } else {
        printQuoteDocument(profile, detail, client);
      }

      if (!demoMode && supabaseBrowser) {
        await logDocumentAction(
          supabaseBrowser,
          currentCompany.id,
          "quote",
          detail.quote.id,
          action
        );
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDocumentBusy(null);
    }
  }

  function openConversion(quote: QuoteSummary) {
    if (quote.status !== "approved") {
      setError("Solo los presupuestos aprobados pueden convertirse en pedido.");
      return;
    }
    setDetail({ quote, items: [] });
    setConvertDeliveryDate("");
    setConvertPriority("normal");
    setConvertNotes("");
    setConvertOpen(true);
    setConvertedOrder(null);
    setError("");
  }

  async function convert(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;

    if (demoMode) {
      setConvertOpen(false);
      setConvertedOrder({ id: "demo-order", number: 999 });
      setSuccess("Presupuesto convertido en pedido en modo demo.");
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;

    setConverting(true);
    setError("");
    try {
      const result = await convertQuoteToOrder(
        supabaseBrowser,
        currentCompany.id,
        detail.quote.id,
        {
          delivery_date: convertDeliveryDate || null,
          priority: convertPriority,
          notes: convertNotes
        }
      );
      setConvertedOrder({
        id: result.order_id,
        number: result.order_number
      });
      setConvertOpen(false);
      setSuccess(
        `Presupuesto convertido en pedido #${String(result.order_number).padStart(5, "0")}.`
      );
      await Promise.all([loadBase(), load()]);
      setDetail(
        await loadQuoteDetail(
          supabaseBrowser,
          currentCompany.id,
          detail.quote.id
        )
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setConverting(false);
    }
  }

  const detailQuote = detail?.quote ?? null;
  const detailItems = detail?.items ?? [];

  return (
    <>
      <Topbar eyebrow="Ventas" title="Presupuestos" />

      <div className="page-content budget-page quote-page-real">
        <section className="budget-intro quote-intro-real">
          <div>
            <span className="budget-eyebrow">GESTIÓN COMERCIAL</span>
            <h2>
              Presupuestos <span>claros y rápidos.</span>
            </h2>
            <p>
              Cotizá trabajos con múltiples ítems, controlá su vigencia y convertí
              los aprobados en pedidos sin volver a cargar información.
            </p>
          </div>

          <div className="budget-summary">
            <div className="summary-item">
              <span>Presupuestos</span>
              <strong>{overview.total_quotes}</strong>
            </div>
            <div className="summary-divider" />
            <div className="summary-item">
              <span>Total cotizado</span>
              <strong>{money(overview.quoted_total)}</strong>
            </div>
          </div>
        </section>

        {(error || success) && (
          <div className={`form-message ${error ? "error" : "success"}`}>
            {error || success}
          </div>
        )}

        <section className="compact-metrics quote-metrics">
          <CompactMetric
            icon="clock"
            tone="orange"
            label="Abiertos"
            value={String(overview.open_quotes)}
          />
          <CompactMetric
            icon="check"
            tone="green"
            label="Aprobados"
            value={String(overview.approved_quotes)}
          />
          <CompactMetric
            icon="orders"
            tone="purple"
            label="Convertidos"
            value={String(overview.converted_quotes)}
          />
          <CompactMetric
            icon="money"
            tone="blue"
            label="Total cotizado"
            value={money(overview.quoted_total)}
          />
        </section>

        <section className="budget-toolbar quote-toolbar-real">
          <label className="budget-search">
            <Icon name="search" size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar presupuesto, cliente o detalle..."
            />
          </label>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option value={option.value} key={option.value || "all"}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={daysFilter}
            onChange={(event) => setDaysFilter(event.target.value)}
          >
            <option value="">Todo el historial</option>
            <option value="7">Últimos 7 días</option>
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
            <option value="365">Último año</option>
          </select>

          <button className="button button-dark" type="button" onClick={openNew}>
            <Icon name="plus" size={14} /> Nuevo presupuesto
          </button>
        </section>

        <section className="budget-list-section">
          <div className="section-heading">
            <div>
              <span>Actividad comercial</span>
              <h3>Presupuestos</h3>
            </div>
            <span className="quote-results-count">{quotes.length} resultados</span>
          </div>

          {loading ? (
            <div className="quote-loading">
              {[0, 1, 2, 3, 4].map((item) => (
                <div key={item}>
                  <span /><span /><span /><span /><span />
                </div>
              ))}
            </div>
          ) : quotes.length === 0 ? (
            <div className="content-card clients-empty quote-empty">
              <span><Icon name="quote" size={24} /></span>
              <strong>No hay presupuestos para mostrar</strong>
              <p>Creá una cotización o cambiá los filtros actuales.</p>
              <button className="button button-dark" type="button" onClick={openNew}>
                <Icon name="plus" size={14} /> Crear presupuesto
              </button>
            </div>
          ) : (
            <div className="data-table-wrap quote-table-wrap">
              <table className="data-table quote-table-real">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Cliente</th>
                    <th>Detalle</th>
                    <th>Estado</th>
                    <th>Fecha</th>
                    <th>Válido hasta</th>
                    <th>Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => (
                    <tr key={quote.id}>
                      <td>
                        <button
                          className="quote-number-link"
                          type="button"
                          onClick={() => void openDetail(quote)}
                        >
                          P-{String(quote.quote_number).padStart(4, "0")}
                        </button>
                      </td>
                      <td>
                        <strong>{quote.client_name}</strong>
                        <span className="cell-sub">
                          {quote.client_company || quote.client_email || "Cliente"}
                        </span>
                      </td>
                      <td>
                        <strong>{quote.first_item || "Sin detalle"}</strong>
                        <span className="cell-sub">
                          {quote.item_count} {quote.item_count === 1 ? "ítem" : "ítems"}
                        </span>
                      </td>
                      <td>
                        <span className={`status-pill ${statusClass(quote.status)}`}>
                          {statusLabel(quote.status)}
                        </span>
                      </td>
                      <td>{date(quote.issue_date)}</td>
                      <td>
                        <span className={quote.status === "expired" ? "quote-expired-date" : ""}>
                          {date(quote.valid_until)}
                        </span>
                      </td>
                      <td className="money">
                        <strong>{money(quote.total)}</strong>
                      </td>
                      <td>
                        <div className="row-actions quote-row-actions">
                          <button type="button" onClick={() => void openDetail(quote)}>
                            Ver
                          </button>
                          {!["converted", "cancelled"].includes(quote.stored_status) && (
                            <button type="button" onClick={() => void openEdit(quote)}>
                              Editar
                            </button>
                          )}
                          {quote.status === "approved" && (
                            <button type="button" onClick={() => openConversion(quote)}>
                              Convertir
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {formOpen && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) setFormOpen(false);
            }}
          >
            <form className="modal-card quote-form-modal" onSubmit={saveQuote}>
              <div className="modal-head">
                <div>
                  <span>PRESUPUESTOS</span>
                  <h3>{editing ? "Editar presupuesto" : "Nuevo presupuesto"}</h3>
                </div>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setFormOpen(false)}
                >
                  ×
                </button>
              </div>

              <div className="quote-form-scroll">
                <div className="client-form-grid">
                  <label className="form-field full-field">
                    <span>Cliente *</span>
                    <select
                      value={form.client_id}
                      onChange={(event) =>
                        setForm({ ...form, client_id: event.target.value })
                      }
                    >
                      <option value="">Seleccionar cliente</option>
                      {demoMode
                        ? demoClients.map((client) => (
                            <option value={client.id} key={client.id}>
                              {client.name}
                            </option>
                          ))
                        : clients.map((client) => (
                            <option value={client.id} key={client.id}>
                              {client.name}
                              {client.company_name ? ` · ${client.company_name}` : ""}
                            </option>
                          ))}
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Fecha *</span>
                    <input
                      type="date"
                      value={form.issue_date}
                      onChange={(event) =>
                        setForm({ ...form, issue_date: event.target.value })
                      }
                    />
                  </label>

                  <label className="form-field">
                    <span>Válido hasta</span>
                    <input
                      type="date"
                      value={form.valid_until || ""}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          valid_until: event.target.value || null
                        })
                      }
                    />
                  </label>

                  <label className="form-field">
                    <span>Estado</span>
                    <select
                      value={form.status}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          status: event.target.value as QuoteInput["status"]
                        })
                      }
                    >
                      <option value="draft">Borrador</option>
                      <option value="sent">Enviado</option>
                      <option value="approved">Aprobado</option>
                      <option value="rejected">Rechazado</option>
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Descuento total</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.discount}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          discount: Number(event.target.value)
                        })
                      }
                    />
                  </label>
                </div>

                <section className="quote-items-editor">
                  <div className="quote-items-head">
                    <div>
                      <span>DETALLE</span>
                      <h4>Ítems del presupuesto</h4>
                    </div>
                    <button
                      type="button"
                      className="button modal-secondary"
                      onClick={() =>
                        setForm({
                          ...form,
                          items: [
                            ...form.items,
                            { description: "", quantity: 1, unit_price: 0 }
                          ]
                        })
                      }
                    >
                      <Icon name="plus" size={13} /> Agregar ítem
                    </button>
                  </div>

                  <div className="quote-items-list">
                    {form.items.map((item, index) => {
                      const total =
                        Math.max(0, Number(item.quantity) || 0) *
                        Math.max(0, Number(item.unit_price) || 0);

                      return (
                        <div className="quote-item-row" key={item.id || index}>
                          <label className="form-field quote-item-description">
                            <span>Descripción</span>
                            <input
                              value={item.description}
                              onChange={(event) => {
                                const items = [...form.items];
                                items[index] = {
                                  ...items[index],
                                  description: event.target.value
                                };
                                setForm({ ...form, items });
                              }}
                              placeholder="Ej.: 500 tarjetas doble faz"
                            />
                          </label>

                          <label className="form-field">
                            <span>Cantidad</span>
                            <input
                              type="number"
                              min="0.001"
                              step="0.001"
                              value={item.quantity}
                              onChange={(event) => {
                                const items = [...form.items];
                                items[index] = {
                                  ...items[index],
                                  quantity: Number(event.target.value)
                                };
                                setForm({ ...form, items });
                              }}
                            />
                          </label>

                          <label className="form-field">
                            <span>Precio unitario</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.unit_price}
                              onChange={(event) => {
                                const items = [...form.items];
                                items[index] = {
                                  ...items[index],
                                  unit_price: Number(event.target.value)
                                };
                                setForm({ ...form, items });
                              }}
                            />
                          </label>

                          <div className="quote-item-total">
                            <span>Total</span>
                            <strong>{money(total)}</strong>
                          </div>

                          <button
                            className="quote-remove-item"
                            type="button"
                            title="Quitar ítem"
                            disabled={form.items.length === 1}
                            onClick={() =>
                              setForm({
                                ...form,
                                items: form.items.filter((_, itemIndex) => itemIndex !== index)
                              })
                            }
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <label className="form-field quote-notes-field">
                  <span>Observaciones</span>
                  <textarea
                    rows={3}
                    value={form.notes || ""}
                    onChange={(event) =>
                      setForm({ ...form, notes: event.target.value })
                    }
                    placeholder="Plazos, aclaraciones internas o detalles adicionales..."
                  />
                </label>

                <div className="quote-form-totals">
                  <div>
                    <span>Subtotal</span>
                    <strong>{money(formSubtotal)}</strong>
                  </div>
                  <div>
                    <span>Descuento</span>
                    <strong>- {money(Math.max(0, Number(form.discount) || 0))}</strong>
                  </div>
                  <div className="total">
                    <span>Total</span>
                    <strong>{money(formTotal)}</strong>
                  </div>
                </div>
              </div>

              <div className="modal-actions">
                <button
                  className="button modal-secondary"
                  type="button"
                  onClick={() => setFormOpen(false)}
                >
                  Cancelar
                </button>
                <button className="button button-dark" type="submit" disabled={saving}>
                  {saving
                    ? "Guardando..."
                    : editing
                      ? "Guardar cambios"
                      : "Crear presupuesto"}
                </button>
              </div>
            </form>
          </div>
        )}

        {detailQuote && (
          <div
            className="drawer-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) setDetail(null);
            }}
          >
            <aside className="client-drawer quote-drawer">
              <div className="drawer-head">
                <div className="drawer-client">
                  <span className="quote-detail-icon">
                    <Icon name="quote" size={20} />
                  </span>
                  <div>
                    <span>PRESUPUESTO</span>
                    <h3>P-{String(detailQuote.quote_number).padStart(4, "0")}</h3>
                    <p>{detailQuote.client_name}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setDetail(null)}
                >
                  ×
                </button>
              </div>

              {detailLoading ? (
                <div className="quote-detail-loading">Cargando presupuesto...</div>
              ) : (
                <>
                  <div className="quote-detail-status-line">
                    <span className={`status-pill ${statusClass(detailQuote.status)}`}>
                      {statusLabel(detailQuote.status)}
                    </span>
                    <span>
                      Emitido {date(detailQuote.issue_date)} · válido hasta{" "}
                      {date(detailQuote.valid_until)}
                    </span>
                  </div>

                  <div className="drawer-actions quote-drawer-actions">
                    <button
                      className="button document-primary-action"
                      type="button"
                      disabled={documentBusy !== null}
                      onClick={() => void exportQuote("pdf")}
                    >
                      <Icon name="download" size={13} /> {documentBusy === "pdf" ? "Generando..." : "Descargar PDF"}
                    </button>
                    <button
                      className="button modal-secondary"
                      type="button"
                      disabled={documentBusy !== null}
                      onClick={() => void exportQuote("print")}
                    >
                      <Icon name="printer" size={13} /> {documentBusy === "print" ? "Abriendo..." : "Imprimir"}
                    </button>
                    {!["converted", "cancelled"].includes(detailQuote.stored_status) && (
                      <button
                        className="button modal-secondary"
                        type="button"
                        onClick={() => void openEdit(detailQuote)}
                      >
                        Editar
                      </button>
                    )}

                    {detailQuote.status === "draft" && (
                      <button
                        className="button modal-secondary"
                        type="button"
                        disabled={statusSaving}
                        onClick={() => void setQuoteStatus(detailQuote, "sent")}
                      >
                        Marcar enviado
                      </button>
                    )}

                    {["draft", "sent"].includes(detailQuote.status) && (
                      <button
                        className="button button-dark"
                        type="button"
                        disabled={statusSaving}
                        onClick={() => void setQuoteStatus(detailQuote, "approved")}
                      >
                        Aprobar
                      </button>
                    )}

                    {detailQuote.status === "approved" && (
                      <button
                        className="button quote-convert-button"
                        type="button"
                        onClick={() => openConversion(detailQuote)}
                      >
                        <Icon name="arrow" size={13} /> Convertir a pedido
                      </button>
                    )}

                    <button
                      className="button modal-secondary"
                      type="button"
                      onClick={() => void cloneQuote(detailQuote)}
                    >
                      Duplicar
                    </button>
                  </div>

                  {convertedOrder && (
                    <div className="quote-converted-success">
                      <Icon name="check" size={18} />
                      <div>
                        <strong>
                          Pedido #{String(convertedOrder.number).padStart(5, "0")} creado
                        </strong>
                        <Link href="/pedidos">Ir a Pedidos →</Link>
                      </div>
                    </div>
                  )}

                  {detailQuote.converted_order_number && (
                    <div className="quote-converted-success">
                      <Icon name="orders" size={18} />
                      <div>
                        <strong>
                          Convertido en pedido #
                          {String(detailQuote.converted_order_number).padStart(5, "0")}
                        </strong>
                        <Link href="/pedidos">Abrir módulo Pedidos →</Link>
                      </div>
                    </div>
                  )}

                  <div className="client-detail-metrics quote-detail-metrics">
                    <div>
                      <span>Subtotal</span>
                      <strong>{money(detailQuote.subtotal)}</strong>
                    </div>
                    <div>
                      <span>Descuento</span>
                      <strong>{money(detailQuote.discount)}</strong>
                    </div>
                    <div>
                      <span>Total</span>
                      <strong>{money(detailQuote.total)}</strong>
                    </div>
                    <div>
                      <span>Ítems</span>
                      <strong>{detailQuote.item_count}</strong>
                    </div>
                  </div>

                  <section className="drawer-section">
                    <h4>Cliente</h4>
                    <div className="contact-grid">
                      <div>
                        <span>Nombre</span>
                        <strong>{detailQuote.client_name}</strong>
                      </div>
                      <div>
                        <span>Empresa</span>
                        <strong>{detailQuote.client_company || "—"}</strong>
                      </div>
                      <div>
                        <span>Teléfono</span>
                        <strong>{detailQuote.client_phone || "—"}</strong>
                      </div>
                      <div>
                        <span>Email</span>
                        <strong>{detailQuote.client_email || "—"}</strong>
                      </div>
                    </div>
                  </section>

                  <section className="drawer-section">
                    <div className="drawer-section-head">
                      <h4>Detalle cotizado</h4>
                      <span>{detailItems.length}</span>
                    </div>

                    <div className="quote-detail-items">
                      {detailItems.map((item) => (
                        <div key={item.id}>
                          <span>
                            <strong>{item.description}</strong>
                            <small>
                              {item.quantity} × {money(item.unit_price)}
                            </small>
                          </span>
                          <b>{money(item.total)}</b>
                        </div>
                      ))}
                    </div>
                  </section>

                  {detailQuote.notes && (
                    <section className="drawer-section">
                      <h4>Observaciones</h4>
                      <p className="client-notes">{detailQuote.notes}</p>
                    </section>
                  )}

                  <section className="drawer-section">
                    <h4>Trazabilidad comercial</h4>
                    <div className="quote-timeline">
                      <div className="active">
                        <span />
                        <p><strong>Creado</strong><small>{dateTime(detailQuote.created_at)}</small></p>
                      </div>
                      {detailQuote.sent_at && (
                        <div className="active">
                          <span />
                          <p><strong>Enviado</strong><small>{dateTime(detailQuote.sent_at)}</small></p>
                        </div>
                      )}
                      {detailQuote.approved_at && (
                        <div className="active">
                          <span />
                          <p><strong>Aprobado</strong><small>{dateTime(detailQuote.approved_at)}</small></p>
                        </div>
                      )}
                      {detailQuote.rejected_at && (
                        <div className="rejected">
                          <span />
                          <p><strong>Rechazado</strong><small>{dateTime(detailQuote.rejected_at)}</small></p>
                        </div>
                      )}
                      {detailQuote.converted_at && (
                        <div className="active">
                          <span />
                          <p><strong>Convertido a pedido</strong><small>{dateTime(detailQuote.converted_at)}</small></p>
                        </div>
                      )}
                    </div>
                  </section>

                  {!["converted", "cancelled"].includes(detailQuote.stored_status) && (
                    <section className="drawer-section quote-danger-zone">
                      <div>
                        <strong>Acciones comerciales</strong>
                        <p>Rechazar o cancelar conserva el presupuesto y su historial.</p>
                      </div>
                      <div>
                        {!["rejected", "expired"].includes(detailQuote.status) && (
                          <button
                            className="button inventory-archive-button"
                            type="button"
                            disabled={statusSaving}
                            onClick={() => void setQuoteStatus(detailQuote, "rejected")}
                          >
                            Rechazar
                          </button>
                        )}
                        <button
                          className="button inventory-archive-button"
                          type="button"
                          disabled={statusSaving}
                          onClick={() => void setQuoteStatus(detailQuote, "cancelled")}
                        >
                          Cancelar
                        </button>
                      </div>
                    </section>
                  )}
                </>
              )}
            </aside>
          </div>
        )}

        {convertOpen && detailQuote && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) setConvertOpen(false);
            }}
          >
            <form className="modal-card quote-convert-modal" onSubmit={convert}>
              <div className="modal-head">
                <div>
                  <span>PRESUPUESTO → PEDIDO</span>
                  <h3>
                    Convertir P-{String(detailQuote.quote_number).padStart(4, "0")}
                  </h3>
                </div>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setConvertOpen(false)}
                >
                  ×
                </button>
              </div>

              <div className="quote-convert-summary">
                <div>
                  <span>Cliente</span>
                  <strong>{detailQuote.client_name}</strong>
                </div>
                <div>
                  <span>Total</span>
                  <strong>{money(detailQuote.total)}</strong>
                </div>
                <div>
                  <span>Ítems</span>
                  <strong>{detailQuote.item_count}</strong>
                </div>
              </div>

              <div className="client-form-grid">
                <label className="form-field">
                  <span>Fecha de entrega</span>
                  <input
                    type="date"
                    min={today()}
                    value={convertDeliveryDate}
                    onChange={(event) => setConvertDeliveryDate(event.target.value)}
                  />
                </label>

                <label className="form-field">
                  <span>Prioridad</span>
                  <select
                    value={convertPriority}
                    onChange={(event) =>
                      setConvertPriority(
                        event.target.value as typeof convertPriority
                      )
                    }
                  >
                    {PRIORITIES.map(([value, label]) => (
                      <option value={value} key={value}>{label}</option>
                    ))}
                  </select>
                </label>

                <label className="form-field full-field">
                  <span>Notas para el pedido</span>
                  <textarea
                    rows={3}
                    value={convertNotes}
                    onChange={(event) => setConvertNotes(event.target.value)}
                    placeholder="Indicaciones de producción, entrega o seguimiento..."
                  />
                </label>
              </div>

              <div className="quote-convert-info">
                <Icon name="check" size={17} />
                <p>
                  Se copiarán cliente, ítems, precios, descuento y total. El pedido
                  conservará el vínculo con este presupuesto y entrará al flujo de
                  Producción automáticamente.
                </p>
              </div>

              <div className="modal-actions">
                <button
                  className="button modal-secondary"
                  type="button"
                  onClick={() => setConvertOpen(false)}
                >
                  Cancelar
                </button>
                <button className="button button-dark" type="submit" disabled={converting}>
                  {converting ? "Convirtiendo..." : "Crear pedido"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </>
  );
}
