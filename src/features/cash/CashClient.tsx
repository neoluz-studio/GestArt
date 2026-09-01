"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CompactMetric } from "@/components/Metric";
import { Icon } from "@/components/Icon";
import { Topbar } from "@/components/Topbar";
import { useTenant } from "@/contexts/TenantContext";
import { cashMovements as demoCashMovements, money as demoMoney } from "@/lib/demo-data";
import { demoMode } from "@/lib/runtime";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { listSuppliers, type SupplierLookup } from "@/services/inventory";
import { listClients, type ClientSummary } from "@/services/clients";
import { listQuotesByClient } from "@/services/quotes";
import { getOrderById } from "@/services/orders";
import {
  closeCash,
  createManualCashMovement,
  getCashMethodBalances,
  getCashOverview,
  listCashClosures,
  listCashMovements,
  listPaymentMethods,
  previewCashClosure,
  reverseCashMovement,
  type CashClosure,
  type CashMethodBalance,
  type CashMovement,
  type CashOverview,
  type ManualCashMovementInput,
  type PaymentMethod
} from "@/services/cash";

const EMPTY_OVERVIEW: CashOverview = {
  current_balance: 0,
  income_today: 0,
  expense_today: 0,
  period_expected: 0,
  last_closed_at: null,
  last_difference: 0
};

const EMPTY_FORM: ManualCashMovementInput = {
  movement_type: "income",
  concept: "",
  category: "other",
  amount: 0,
  payment_method_id: "",
  client_id: null,
quote_id: null,
order_id: null,
  supplier_id: null,
  notes: "",
  reference: "",
  occurred_at: null
};

const categories = {
  income: [
    ["sale", "Venta / mostrador"],
    ["service", "Servicio"],
    ["capital", "Aporte de capital"],
    ["refund_received", "Reintegro recibido"],
    ["other", "Otro ingreso"]
  ],
  expense: [
    ["materials", "Compra de materiales"],
    ["supplier", "Proveedor"],
    ["services", "Servicios"],
    ["shipping", "Envíos"],
    ["fuel", "Combustible"],
    ["taxes", "Impuestos"],
    ["general", "Gastos generales"],
    ["other", "Otro egreso"]
  ]
} as const;

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Error inesperado.");
  }
  return "Ocurrió un error inesperado.";
}

function demoRows(): CashMovement[] {
  return demoCashMovements.map((item, index) => ({
    id: `demo-cash-${index}`,
    movement_type: item.type === "Ingreso" ? "income" : "expense",
    category: item.type === "Ingreso" ? "sale" : "materials",
    concept: item.concept,
    amount: Math.abs(item.amount),
    payment_method_id: `demo-method-${item.method}`,
    payment_method_name: item.method,
    order_id: item.concept.includes("#") ? "demo-order" : null,
    order_number: item.concept.includes("#") ? 251 : null,
    client_id: null,
client_name: null,
quote_id: null,
quote_number: null,
    supplier_id: null,
    supplier_name: item.type === "Egreso" ? "Insumos Print" : null,
    notes: null,
    reference: null,
    occurred_at: new Date(Date.now() - index * 3600000).toISOString(),
    created_by: null,
    created_by_name: item.user,
    source: item.concept.startsWith("Pago pedido") ? "order_payment" : "manual",
    reversal_of_id: null,
    reversed_by_id: null
  }));
}

function sourceLabel(source: string) {
  if (source === "order_payment") return "Pedido";
  if (source === "inventory_purchase") return "Inventario";
  if (source === "reversal") return "Reversión";
  return "Manual";
}

function categoryLabel(code: string | null) {
  const all = [...categories.income, ...categories.expense] as readonly (readonly [string,string])[];
  return all.find(([value]) => value === code)?.[1] ?? code ?? "Sin categoría";
}

export function CashClient() {
  const { currentCompany, settings } = useTenant();
  const [overview, setOverview] = useState<CashOverview>(
    demoMode
      ? { current_balance: 832000, income_today: 285000, expense_today: 48000, period_expected: 832000, last_closed_at: null, last_difference: 0 }
      : EMPTY_OVERVIEW
  );
  const [methodBalances, setMethodBalances] = useState<CashMethodBalance[]>(
    demoMode
      ? [
          { payment_method_id:"cash",code:"cash",name:"Efectivo",balance:250000,income:280000,expense:30000 },
          { payment_method_id:"transfer",code:"transfer",name:"Transferencia",balance:382000,income:430000,expense:48000 },
          { payment_method_id:"mercadopago",code:"mercadopago",name:"Mercado Pago",balance:120000,income:120000,expense:0 },
          { payment_method_id:"cards",code:"credit",name:"Tarjetas",balance:80000,income:80000,expense:0 }
        ]
      : []
  );
  const [movements, setMovements] = useState<CashMovement[]>(demoMode ? demoRows() : []);
  const [methods, setMethods] = useState<PaymentMethod[]>(
    demoMode
      ? [
          {id:"cash",code:"cash",name:"Efectivo"},
          {id:"transfer",code:"transfer",name:"Transferencia"},
          {id:"mercadopago",code:"mercadopago",name:"Mercado Pago"},
          {id:"debit",code:"debit",name:"Tarjeta de débito"},
          {id:"credit",code:"credit",name:"Tarjeta de crédito"}
        ]
      : []
  );
  const [suppliers, setSuppliers] = useState<SupplierLookup[]>([]);
const [closures, setClosures] = useState<CashClosure[]>([]);

const [clients, setClients] = useState<ClientSummary[]>([]);
const [clientSearch, setClientSearch] = useState("");
const [selectedClient, setSelectedClient] = useState<ClientSummary | null>(null);
const [quotes, setQuotes] = useState<any[]>([]);
const [orders, setOrders] = useState<any[]>([]);

  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [movementOpen, setMovementOpen] = useState(false);
  const [movementForm, setMovementForm] = useState<ManualCashMovementInput>(EMPTY_FORM);
  const [savingMovement, setSavingMovement] = useState(false);

  const [closureOpen, setClosureOpen] = useState(false);
  const [closurePreview, setClosurePreview] = useState<{
    opened_at: string;
    opening_balance: number;
    income_total: number;
    expense_total: number;
    expected_balance: number;
  } | null>(null);
  const [actualBalance, setActualBalance] = useState(0);
  const [closureNotes, setClosureNotes] = useState("");
  const [closing, setClosing] = useState(false);

  const [reversal, setReversal] = useState<CashMovement | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [reversing, setReversing] = useState(false);

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

  const dateTime = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
async function handleClientChange(clientId: string) {

  const client =
    clients.find(
      item => item.id === clientId
    ) || null;


  setSelectedClient(client);


  setMovementForm(prev => ({
    ...prev,
    client_id: clientId || null,
    quote_id: null,
    order_id: null
  }));


  setQuotes([]);
  setOrders([]);


  if (
    !clientId ||
    !currentCompany ||
    !supabaseBrowser
  ) {
    return;
  }


  try {

    const clientQuotes =
      await listQuotesByClient(
        supabaseBrowser,
        currentCompany.id,
        clientId
      );


    setQuotes(clientQuotes);

  } catch (error) {

    setError(errorMessage(error));

  }

}



async function handleQuoteChange(quoteId: string) {

  setMovementForm(prev => ({
    ...prev,
    quote_id: quoteId || null,
    order_id: null
  }));

  setOrders([]);


  if (
    !quoteId ||
    !currentCompany ||
    !supabaseBrowser
  ) {
    return;
  }


  try {

    const quote =
      quotes.find(
        item => item.id === quoteId
      );


    if (
      !quote ||
      !quote.converted_order_id
    ) {
      return;
    }


    const order =
      await getOrderById(
        supabaseBrowser,
        currentCompany.id,
        quote.converted_order_id
      );


    setOrders([
      order
    ]);


  } catch(error){

    setError(errorMessage(error));

  }

}
  async function loadBase() {
    if (demoMode || !supabaseBrowser || !currentCompany) return;
    setLoading(true);
    setError("");
    try {
      const [
  summary,
  balances,
  paymentMethods,
  supplierRows,
  closureRows,
  clientRows
] = await Promise.all([
  getCashOverview(supabaseBrowser, currentCompany.id),
  getCashMethodBalances(supabaseBrowser, currentCompany.id),
  listPaymentMethods(supabaseBrowser, currentCompany.id),
  listSuppliers(supabaseBrowser, currentCompany.id),
  listCashClosures(supabaseBrowser, currentCompany.id),
  listClients(supabaseBrowser, currentCompany.id)
]);
setClients(clientRows);
      setOverview(summary);
      setMethodBalances(balances);
      setMethods(paymentMethods);
      setSuppliers(supplierRows);
      setClosures(closureRows);
      if (!movementForm.payment_method_id && paymentMethods[0]) {
        setMovementForm((current) => ({ ...current, payment_method_id: paymentMethods[0].id }));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadMovements() {
    if (demoMode) {
      let rows = demoRows();
      const term = search.trim().toLowerCase();
      if (term) {
        rows = rows.filter((row) =>
          [row.concept,row.category,row.payment_method_name,row.supplier_name,row.created_by_name]
            .some((value) => String(value ?? "").toLowerCase().includes(term))
        );
      }
      if (typeFilter) rows = rows.filter((row) => row.movement_type === typeFilter);
      if (methodFilter) rows = rows.filter((row) => row.payment_method_id === methodFilter);
      setMovements(rows);
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;
    try {
      setMovements(await listCashMovements(supabaseBrowser, currentCompany.id, {
        search,
        type: typeFilter,
        paymentMethodId: methodFilter,
        fromDate,
        toDate
      }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    void loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadMovements(), 220);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id, search, typeFilter, methodFilter, fromDate, toDate]);

  function openMovement(type: "income" | "expense" = "income") {
    setMovementForm({
      ...EMPTY_FORM,
      movement_type: type,
      category: type === "income" ? "sale" : "general",
      payment_method_id: methods[0]?.id ?? ""
    });
    setMovementOpen(true);
    setError("");
    setSuccess("");
  }

  async function saveMovement(event: FormEvent) {
    event.preventDefault();
    if (!movementForm.concept.trim()) {
      setError("Indicá el concepto.");
      return;
    }
    if (movementForm.amount <= 0) {
      setError("El monto debe ser mayor a cero.");
      return;
    }
    if (!movementForm.payment_method_id) {
      setError("Elegí un medio de pago.");
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
      await createManualCashMovement(supabaseBrowser, currentCompany.id, movementForm);
      setMovementOpen(false);
      setSuccess("Movimiento registrado.");
      await Promise.all([loadBase(), loadMovements()]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingMovement(false);
    }
  }

  async function openClosure() {
    setError("");
    if (demoMode) {
      const preview = {
        opened_at: new Date(Date.now() - 8 * 3600000).toISOString(),
        opening_balance: 595000,
        income_total: 285000,
        expense_total: 48000,
        expected_balance: 832000
      };
      setClosurePreview(preview);
      setActualBalance(preview.expected_balance);
      setClosureOpen(true);
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;
    try {
      const preview = await previewCashClosure(supabaseBrowser, currentCompany.id);
      setClosurePreview(preview);
      setActualBalance(preview.expected_balance);
      setClosureNotes("");
      setClosureOpen(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function submitClosure(event: FormEvent) {
    event.preventDefault();
    if (demoMode) {
      setClosureOpen(false);
      setSuccess("Cierre registrado en modo demo.");
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;

    setClosing(true);
    setError("");
    try {
      await closeCash(supabaseBrowser, currentCompany.id, actualBalance, closureNotes);
      setClosureOpen(false);
      setSuccess("Cierre de caja registrado.");
      await Promise.all([loadBase(), loadMovements()]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setClosing(false);
    }
  }

  async function submitReversal(event: FormEvent) {
    event.preventDefault();
    if (!reversal) return;
    if (reversalReason.trim().length < 5) {
      setError("Explicá el motivo de la reversión.");
      return;
    }
    if (demoMode) {
      setReversal(null);
      setReversalReason("");
      setSuccess("Movimiento revertido en modo demo.");
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;

    setReversing(true);
    setError("");
    try {
      await reverseCashMovement(supabaseBrowser, currentCompany.id, reversal.id, reversalReason);
      setReversal(null);
      setReversalReason("");
      setSuccess("Movimiento revertido mediante contramovimiento.");
      await Promise.all([loadBase(), loadMovements()]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setReversing(false);
    }
  }

  const closureDifference = closurePreview ? actualBalance - closurePreview.expected_balance : 0;
  const totalMethods = useMemo(
    () => methodBalances.reduce((sum, row) => sum + row.balance, 0),
    [methodBalances]
  );

  return (
    <>
      <Topbar eyebrow="Administración" title="Caja y pagos" />

      <div className="page-content page-stack cash-page-real">
        <section className="module-intro cash-intro-real">
          <div className="module-copy">
            <span className="module-kicker">CONTROL FINANCIERO</span>
            <h2>
              Tu caja, <span>sin sorpresas.</span>
            </h2>
            <p>
              Pagos de pedidos, ingresos, egresos y cierres quedan trazados por empresa, usuario y medio de pago.
            </p>
          </div>
          <div className="module-actions cash-hero-actions">
            <button className="button modal-secondary" type="button" onClick={() => openMovement("expense")}>
              <Icon name="alert" size={14} /> Nuevo egreso
            </button>
            <button className="button button-dark" type="button" onClick={() => openMovement("income")}>
              <Icon name="plus" size={14} /> Nuevo ingreso
            </button>
          </div>
        </section>

        {(error || success) && (
          <div className={`form-message ${error ? "error" : "success"}`}>
            {error || success}
          </div>
        )}

        <section className="compact-metrics">
          <CompactMetric icon="cash" tone="purple" label="Saldo actual" value={money(overview.current_balance)} />
          <CompactMetric icon="money" tone="green" label="Ingresos del día" value={money(overview.income_today)} />
          <CompactMetric icon="alert" tone="red" label="Egresos del día" value={money(overview.expense_today)} />
          <CompactMetric icon="check" tone="blue" label="Saldo esperado período" value={money(overview.period_expected)} />
        </section>

        <section className="gestart-card cash-method-section">
          <div className="gestart-card-body">
            <div className="gestart-card-title">
              <div>
                <h3>Saldo por medio de pago</h3>
                <p>Los pagos mixtos se separan automáticamente por cada método.</p>
              </div>
              <button className="button button-dark" type="button" onClick={() => void openClosure()}>
                <Icon name="check" size={14} /> Cierre de caja
              </button>
            </div>

            {loading ? (
              <div className="cash-method-grid">
                {[0,1,2,3].map((item) => <div className="cash-method-card cash-method-skeleton" key={item} />)}
              </div>
            ) : methodBalances.length === 0 ? (
              <p className="muted-small">Todavía no hay movimientos de caja.</p>
            ) : (
              <div className="cash-method-grid">
                {methodBalances.map((method) => (
                  <article className="cash-method-card" key={method.payment_method_id ?? method.name}>
                    <div className="cash-method-icon"><Icon name={method.code === "cash" ? "cash" : "credit"} size={16} /></div>
                    <span>{method.name.toUpperCase()}</span>
                    <strong>{money(method.balance)}</strong>
                    <div>
                      <small>+ {money(method.income)}</small>
                      <small>- {money(method.expense)}</small>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <div className="cash-method-total">
              <span>Total conciliado por métodos</span>
              <strong>{money(totalMethods)}</strong>
            </div>
          </div>
        </section>

        <section className="filter-bar cash-filters">
          <label className="filter-search">
            <Icon name="search" size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar concepto, cliente, presupuesto, pedido..."
            />
          </label>

          <select className="filter-select" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="">Ingresos y egresos</option>
            <option value="income">Ingresos</option>
            <option value="expense">Egresos</option>
          </select>

          <select className="filter-select" value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}>
            <option value="">Todos los métodos</option>
            {methods.map((method) => <option value={method.id} key={method.id}>{method.name}</option>)}
          </select>

          <label className="cash-date-filter">
            <span>Desde</span>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="cash-date-filter">
            <span>Hasta</span>
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
        </section>

        <section className="content-card cash-movements-card">
          <div className="section-heading cash-section-heading">
            <div>
              <span>MOVIMIENTOS</span>
              <h3>Historial de caja</h3>
            </div>
            <span>{movements.length} registros</span>
          </div>

          {movements.length === 0 ? (
            <div className="clients-empty">
              <span><Icon name="cash" size={24} /></span>
              <strong>No hay movimientos</strong>
              <p>Los pagos de pedidos aparecerán automáticamente. También podés registrar ingresos o egresos manuales.</p>
            </div>
          ) : (
            <div className="data-table-wrap cash-table-wrap">
              <table className="data-table cash-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Concepto</th>
                    <th>Categoría</th>
                    <th>Método</th>
                    <th>Origen</th>
                    <th>Usuario</th>
                    <th>Monto</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {movements.map((movement) => (
                    <tr key={movement.id} className={movement.reversal_of_id ? "cash-reversal-row" : ""}>
                      <td>{dateTime(movement.occurred_at)}</td>
                      <td>
                        <span className={`status-pill ${movement.movement_type === "income" ? "status-green" : "status-red"}`}>
                          {movement.movement_type === "income" ? "Ingreso" : "Egreso"}
                        </span>
                      </td>
                      <td>
  <strong>{movement.concept}</strong>

  <small className="cash-row-note">

    {movement.client_name && (
      <>
        Cliente: {movement.client_name}
        <br />
      </>
    )}


    {movement.quote_number && (
      <>
        Presupuesto #
        {String(movement.quote_number).padStart(5,"0")}
        <br />
      </>
    )}


    {movement.order_number && (
      <>
        Pedido #
        {String(movement.order_number).padStart(5,"0")}
      </>
    )}

  </small>

</td>
                      <td>{categoryLabel(movement.category)}</td>
                      <td>{movement.payment_method_name || "—"}</td>
                      <td><span className="cash-source-pill">{sourceLabel(movement.source)}</span></td>
                      <td>{movement.created_by_name || "Usuario"}</td>
                      <td className={`money ${movement.movement_type === "expense" ? "cash-negative" : "cash-positive"}`}>
                        {movement.movement_type === "expense" ? "- " : "+ "}{money(movement.amount)}
                      </td>
                      <td>
                        {movement.source === "manual" && !movement.reversed_by_id && !movement.reversal_of_id ? (
                          <button
                            className="cash-reverse-button"
                            type="button"
                            onClick={() => { setReversal(movement); setReversalReason(""); }}
                          >
                            Revertir
                          </button>
                        ) : movement.reversed_by_id ? (
                          <span className="cash-reversed-label">Revertido</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="gestart-card cash-closures-card">
          <div className="gestart-card-body">
            <div className="gestart-card-title">
              <div>
                <h3>Últimos cierres</h3>
                <p>Saldo esperado contra saldo real informado por el usuario.</p>
              </div>
            </div>

            {closures.length === 0 ? (
              <p className="muted-small">Todavía no se realizó ningún cierre.</p>
            ) : (
              <div className="cash-closure-list">
                {closures.slice(0, 8).map((closure) => (
                  <div className="cash-closure-row" key={closure.id}>
                    <div>
                      <strong>{dateTime(closure.closed_at)}</strong>
                      <span>{closure.closed_by_name || "Usuario"}</span>
                    </div>
                    <div><span>Ingresos</span><strong>{money(closure.income_total)}</strong></div>
                    <div><span>Egresos</span><strong>{money(closure.expense_total)}</strong></div>
                    <div><span>Esperado</span><strong>{money(closure.expected_balance)}</strong></div>
                    <div><span>Real</span><strong>{money(closure.actual_balance)}</strong></div>
                    <div>
                      <span>Diferencia</span>
                      <strong className={closure.difference === 0 ? "cash-positive" : "cash-negative"}>
                        {money(closure.difference)}
                      </strong>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {movementOpen && (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.currentTarget === event.target) setMovementOpen(false);
          }}>
            <form className="modal-card cash-movement-modal" onSubmit={saveMovement}>
              <div className="modal-head">
                <div>
                  <span>CAJA</span>
                  <h3>{movementForm.movement_type === "income" ? "Registrar ingreso" : "Registrar egreso"}</h3>
                </div>
                <button type="button" className="modal-close" onClick={() => setMovementOpen(false)}>×</button>
              </div>

              <div className="cash-type-toggle">
                <button
                  type="button"
                  className={movementForm.movement_type === "income" ? "active income" : ""}
                  onClick={() => setMovementForm({ ...movementForm, movement_type:"income", category:"sale", supplier_id:null })}
                >
                  Ingreso
                </button>
                <button
                  type="button"
                  className={movementForm.movement_type === "expense" ? "active expense" : ""}
                  onClick={() => setMovementForm({ ...movementForm, movement_type:"expense", category:"general" })}
                >
                  Egreso
                </button>
              </div>

              <div className="client-form-grid">
                {movementForm.movement_type === "income" && (
  <label className="form-field full-field">
    <span>Cliente</span>

    <select
      value={movementForm.client_id || ""}
      onChange={(event) => {

  const client =
    clients.find(
      item => item.id === event.target.value
    ) || null;


  setSelectedClient(client);


  setMovementForm({
    ...movementForm,
    client_id: client?.id || null,
    quote_id: null,
    order_id: null
  });


  setQuotes([]);
  setOrders([]);


  if (client && currentCompany && supabaseBrowser) {

    void listQuotesByClient(
      supabaseBrowser,
      currentCompany.id,
      client.id
    )
    .then((rows) => {
      setQuotes(rows);
    })
    .catch((error) => {
      setError(errorMessage(error));
    });

  }

}}
    >

      <option value="">
        Sin cliente asociado
      </option>

      {clients.map(client => (
        <option
          value={client.id}
          key={client.id}
        >
          {client.name}
        </option>
      ))}

    </select>

  </label>
  
)}
{quotes.length > 0 && (
  <label className="form-field full-field">

    <span>Presupuesto</span>

    <select
      value={movementForm.quote_id || ""}
      onChange={(event) =>
        handleQuoteChange(event.target.value)
      }
    >

      <option value="">
        Sin presupuesto asociado
      </option>


      {quotes.map((quote) => (

        <option
          key={quote.id}
          value={quote.id}
        >
          #{quote.quote_number} - {money(quote.total)}
        </option>

      ))}

    </select>

  </label>
)}
{orders.length > 0 && (
  <label className="form-field full-field">

    <span>Pedido</span>

    <select
      value={movementForm.order_id || ""}
      onChange={(event) => {

        setMovementForm({
          ...movementForm,
          order_id: event.target.value || null
        });

      }}
    >

      <option value="">
        Sin pedido asociado
      </option>


      {orders.map((order) => (

        <option
          key={order.id}
          value={order.id}
        >
          #{order.order_number} - {money(order.total)}
        </option>

      ))}

    </select>

  </label>
)}
                <label className="form-field full-field">
                  <span>Concepto *</span>
                  <input
                    value={movementForm.concept}
                    onChange={(event) => setMovementForm({ ...movementForm, concept:event.target.value })}
                    placeholder={movementForm.movement_type === "income" ? "Venta mostrador" : "Compra de materiales"}
                  />
                </label>

                <label className="form-field">
                  <span>Categoría</span>
                  <select
                    value={movementForm.category || ""}
                    onChange={(event) => setMovementForm({ ...movementForm, category:event.target.value })}
                  >
                    {(movementForm.movement_type === "income" ? categories.income : categories.expense).map(([value,label]) => (
                      <option value={value} key={value}>{label}</option>
                    ))}
                  </select>
                </label>

                <label className="form-field">
                  <span>Monto *</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={movementForm.amount || ""}
                    onChange={(event) => setMovementForm({ ...movementForm, amount:Number(event.target.value) })}
                  />
                </label>

                <label className="form-field">
                  <span>Medio de pago *</span>
                  <select
                    value={movementForm.payment_method_id}
                    onChange={(event) => setMovementForm({ ...movementForm, payment_method_id:event.target.value })}
                  >
                    <option value="">Seleccionar</option>
                    {methods.map((method) => <option value={method.id} key={method.id}>{method.name}</option>)}
                  </select>
                </label>

                {movementForm.movement_type === "expense" && (
                  <label className="form-field">
                    <span>Proveedor</span>
                    <select
                      value={movementForm.supplier_id || ""}
                      onChange={(event) => setMovementForm({ ...movementForm, supplier_id:event.target.value || null })}
                    >
                      <option value="">Sin proveedor</option>
                      {suppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}
                    </select>
                  </label>
                )}

                <label className="form-field">
                  <span>Referencia</span>
                  <input
                    value={movementForm.reference || ""}
                    onChange={(event) => setMovementForm({ ...movementForm, reference:event.target.value })}
                    placeholder="Comprobante / operación"
                  />
                </label>

                <label className="form-field">
                  <span>Fecha y hora</span>
                  <input
                    type="datetime-local"
                    value={movementForm.occurred_at || ""}
                    onChange={(event) => setMovementForm({ ...movementForm, occurred_at:event.target.value || null })}
                  />
                </label>

                <label className="form-field full-field">
                  <span>Observaciones</span>
                  <textarea
                    rows={3}
                    value={movementForm.notes || ""}
                    onChange={(event) => setMovementForm({ ...movementForm, notes:event.target.value })}
                  />
                </label>
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

        {closureOpen && closurePreview && (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.currentTarget === event.target) setClosureOpen(false);
          }}>
            <form className="modal-card cash-closure-modal" onSubmit={submitClosure}>
              <div className="modal-head">
                <div>
                  <span>CONTROL DE CAJA</span>
                  <h3>Cierre de caja</h3>
                </div>
                <button type="button" className="modal-close" onClick={() => setClosureOpen(false)}>×</button>
              </div>

              <div className="cash-closure-summary">
                <div><span>Saldo inicial</span><strong>{money(closurePreview.opening_balance)}</strong></div>
                <div className="positive"><span>+ Ingresos</span><strong>{money(closurePreview.income_total)}</strong></div>
                <div className="negative"><span>- Egresos</span><strong>{money(closurePreview.expense_total)}</strong></div>
                <div className="expected"><span>= Saldo esperado</span><strong>{money(closurePreview.expected_balance)}</strong></div>
              </div>

              <label className="form-field cash-actual-field">
                <span>Saldo real *</span>
                <input type="number" step="0.01" value={actualBalance} onChange={(event) => setActualBalance(Number(event.target.value))} />
              </label>

              <div className={`cash-difference ${closureDifference === 0 ? "balanced" : closureDifference < 0 ? "negative" : "positive"}`}>
                <span>Diferencia</span>
                <strong>{money(closureDifference)}</strong>
              </div>

              <label className="form-field">
                <span>Observaciones</span>
                <textarea rows={3} value={closureNotes} onChange={(event) => setClosureNotes(event.target.value)} placeholder="Aclaraciones del cierre..." />
              </label>

              <div className="modal-actions">
                <button className="button modal-secondary" type="button" onClick={() => setClosureOpen(false)}>Cancelar</button>
                <button className="button button-dark" type="submit" disabled={closing}>
                  {closing ? "Cerrando..." : "Confirmar cierre"}
                </button>
              </div>
            </form>
          </div>
        )}

        {reversal && (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.currentTarget === event.target) setReversal(null);
          }}>
            <form className="modal-card cash-reversal-modal" onSubmit={submitReversal}>
              <div className="modal-head">
                <div>
                  <span>AUDITORÍA</span>
                  <h3>Revertir movimiento</h3>
                </div>
                <button type="button" className="modal-close" onClick={() => setReversal(null)}>×</button>
              </div>

              <div className="cash-reversal-warning">
                <Icon name="alert" size={19} />
                <p>
                  GestArt no elimina movimientos de caja. Se creará un contramovimiento por <strong>{money(reversal.amount)}</strong> para conservar la trazabilidad.
                </p>
              </div>

              <label className="form-field">
                <span>Motivo *</span>
                <textarea rows={3} value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} placeholder="Ej.: movimiento cargado por duplicado" />
              </label>

              <div className="modal-actions">
                <button className="button modal-secondary" type="button" onClick={() => setReversal(null)}>Cancelar</button>
                <button className="button inventory-archive-button" type="submit" disabled={reversing}>
                  {reversing ? "Revirtiendo..." : "Crear contramovimiento"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </>
  );
}
