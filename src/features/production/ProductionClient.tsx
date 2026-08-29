"use client";

import { useEffect, useMemo, useState } from "react";
import { CompactMetric } from "@/components/Metric";
import { Icon } from "@/components/Icon";
import { Topbar } from "@/components/Topbar";
import { useTenant } from "@/contexts/TenantContext";
import { demoMode } from "@/lib/runtime";
import { orders as demoOrders } from "@/lib/demo-data";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  assignProductionJob,
  listProductionBoard,
  listProductionMembers,
  moveProductionJob,
  updateProductionNotes,
  type ProductionJob,
  type ProductionMember,
  type ProductionStage
} from "@/services/production";

const STAGES: Array<{
  value: ProductionStage;
  label: string;
  short: string;
}> = [
  { value: "pending", label: "Pendiente", short: "Pendiente" },
  { value: "design", label: "Diseño", short: "Diseño" },
  { value: "waiting_approval", label: "Esperando aprobación", short: "Aprobación" },
  { value: "production", label: "Producción", short: "Producción" },
  { value: "finished", label: "Terminado", short: "Terminado" },
  { value: "delivery", label: "Entrega", short: "Entrega" }
];

const PRIORITIES = [
  { value: "", label: "Todas las prioridades" },
  { value: "urgent", label: "Urgente" },
  { value: "high", label: "Alta" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Baja" }
];

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Ocurrió un error inesperado.";
}

function stageFromDemo(status: string): ProductionStage {
  if (status === "Diseño") return "design";
  if (status === "En producción") return "production";
  if (status === "Listo") return "finished";
  if (status === "Pendiente de entrega") return "delivery";
  return "pending";
}

function demoJobs(): ProductionJob[] {
  return demoOrders.map((order, index) => ({
    job_id: `demo-job-${index}`,
    order_id: `demo-order-${index}`,
    order_number: Number(order.number),
    client_id: `demo-client-${index}`,
    client_name: order.client,
    first_item: order.detail,
    item_count: 1,
    priority:
      order.priority === "Urgente"
        ? "urgent"
        : order.priority === "Alta"
          ? "high"
          : "normal",
    order_status: order.status,
    production_status: stageFromDemo(order.status),
    delivery_date: order.due.split("/").reverse().join("-"),
    responsible_user_id: null,
    responsible_name: order.responsible || "Sin asignar",
    notes: null,
    started_at: null,
    completed_at: order.status === "Listo" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
    is_overdue: false
  }));
}

function priorityLabel(priority: string) {
  return PRIORITIES.find((item) => item.value === priority)?.label ?? priority;
}

function priorityClass(priority: string) {
  if (priority === "urgent") return "priority-urgent";
  if (priority === "high") return "priority-high";
  if (priority === "low") return "priority-low";
  return "priority-normal";
}

function formatDate(value: string | null) {
  if (!value) return "Sin fecha";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

export function ProductionClient() {
  const { currentCompany } = useTenant();
  const [jobs, setJobs] = useState<ProductionJob[]>(demoMode ? demoJobs() : []);
  const [members, setMembers] = useState<ProductionMember[]>(demoMode ? [
    { user_id: "demo-lionel", full_name: "Lionel", role_name: "Administrador" },
    { user_id: "demo-design", full_name: "Diseño", role_name: "Diseño" },
    { user_id: "demo-production", full_name: "Producción", role_name: "Producción" }
  ] : []);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("");
  const [responsible, setResponsible] = useState("");
  const [loading, setLoading] = useState(!demoMode);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [draggedJobId, setDraggedJobId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<ProductionStage | null>(null);
  const [selected, setSelected] = useState<ProductionJob | null>(null);
  const [notes, setNotes] = useState("");
  const [detailResponsible, setDetailResponsible] = useState("");

  async function load() {
    if (demoMode) {
      let rows = demoJobs();
      const term = search.trim().toLowerCase();
      if (term) {
        rows = rows.filter((job) =>
          [String(job.order_number), job.client_name, job.first_item ?? ""]
            .some((value) => value.toLowerCase().includes(term))
        );
      }
      if (priority) rows = rows.filter((job) => job.priority === priority);
      setJobs(rows);
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;
    setLoading(true);
    setError("");
    try {
      const [board, team] = await Promise.all([
        listProductionBoard(supabaseBrowser, currentCompany.id, {
          search,
          priority,
          responsibleUserId: responsible
        }),
        listProductionMembers(supabaseBrowser, currentCompany.id)
      ]);
      setJobs(board);
      setMembers(team);
      if (selected) {
        const refreshed = board.find((job) => job.job_id === selected.job_id) ?? null;
        setSelected(refreshed);
        if (refreshed) {
          setNotes(refreshed.notes ?? "");
          setDetailResponsible(refreshed.responsible_user_id ?? "");
        }
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 220);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id, search, priority, responsible]);

  const grouped = useMemo(() => {
    const map = new Map<ProductionStage, ProductionJob[]>();
    for (const stage of STAGES) map.set(stage.value, []);
    for (const job of jobs) {
      const stage = STAGES.some((item) => item.value === job.production_status)
        ? job.production_status
        : "pending";
      map.get(stage)?.push(job);
    }
    return map;
  }, [jobs]);

  const metrics = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return {
      pending: jobs.filter((job) => job.production_status === "pending").length,
      active: jobs.filter((job) => ["design", "waiting_approval", "production"].includes(job.production_status)).length,
      finishedToday: jobs.filter((job) => job.completed_at?.slice(0, 10) === today).length,
      overdue: jobs.filter((job) => job.is_overdue).length
    };
  }, [jobs]);

  async function move(jobId: string, stage: ProductionStage) {
    const job = jobs.find((item) => item.job_id === jobId);
    if (!job || job.production_status === stage) return;

    setError("");
    setSuccess("");

    if (demoMode) {
      setJobs((current) =>
        current.map((item) =>
          item.job_id === jobId ? { ...item, production_status: stage } : item
        )
      );
      setSelected((current) => current?.job_id === jobId ? { ...current, production_status: stage } : current);
      setSuccess(`Pedido #${String(job.order_number).padStart(5, "0")} movido a ${STAGES.find((item) => item.value === stage)?.label}.`);
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;
    setBusyJobId(jobId);

    const previous = jobs;
    const previousSelected = selected;
    setJobs((current) =>
      current.map((item) =>
        item.job_id === jobId ? { ...item, production_status: stage } : item
      )
    );
    setSelected((current) => current?.job_id === jobId ? { ...current, production_status: stage } : current);

    try {
      await moveProductionJob(supabaseBrowser, currentCompany.id, jobId, stage);
      setSuccess(`Pedido #${String(job.order_number).padStart(5, "0")} actualizado.`);
      await load();
    } catch (err) {
      setJobs(previous);
      setSelected(previousSelected);
      setError(errorMessage(err));
    } finally {
      setBusyJobId(null);
    }
  }

  function openDetail(job: ProductionJob) {
    setSelected(job);
    setNotes(job.notes ?? "");
    setDetailResponsible(job.responsible_user_id ?? "");
    setError("");
  }

  async function saveResponsible(value: string) {
    if (!selected) return;
    setDetailResponsible(value);

    if (demoMode) {
      const name = members.find((member) => member.user_id === value)?.full_name ?? "Sin asignar";
      const next = { ...selected, responsible_user_id: value || null, responsible_name: name };
      setSelected(next);
      setJobs((current) => current.map((job) => job.job_id === next.job_id ? next : job));
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;
    setBusyJobId(selected.job_id);
    try {
      await assignProductionJob(
        supabaseBrowser,
        currentCompany.id,
        selected.job_id,
        value || null
      );
      setSuccess("Responsable actualizado.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyJobId(null);
    }
  }

  async function saveNotes() {
    if (!selected) return;
    if (demoMode) {
      const next = { ...selected, notes };
      setSelected(next);
      setJobs((current) => current.map((job) => job.job_id === next.job_id ? next : job));
      setSuccess("Notas actualizadas en modo demo.");
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;

    setBusyJobId(selected.job_id);
    try {
      await updateProductionNotes(supabaseBrowser, currentCompany.id, selected.job_id, notes);
      setSuccess("Notas de producción guardadas.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyJobId(null);
    }
  }

  return (
    <>
      <Topbar eyebrow="Operación" title="Producción" />

      <div className="page-content page-stack production-page-real">
        <section className="module-intro production-intro">
          <div className="module-copy">
            <span className="module-kicker">TABLERO DE PRODUCCIÓN</span>
            <h2>
              Del pedido a la <span>entrega.</span>
            </h2>
            <p>
              Mové cada trabajo entre etapas, asigná responsables y controlá prioridades y vencimientos sin perder trazabilidad.
            </p>
          </div>
          <div className="production-help">
            <Icon name="production" size={18} />
            <div>
              <strong>Drag & drop</strong>
              <span>Arrastrá una tarjeta para cambiar el estado del pedido.</span>
            </div>
          </div>
        </section>

        {(error || success) && (
          <div className={`form-message ${error ? "error" : "success"}`}>
            {error || success}
          </div>
        )}

        <section className="compact-metrics">
          <CompactMetric icon="clock" tone="orange" label="Pendientes" value={String(metrics.pending)} />
          <CompactMetric icon="production" tone="purple" label="En proceso" value={String(metrics.active)} />
          <CompactMetric icon="check" tone="green" label="Terminados hoy" value={String(metrics.finishedToday)} />
          <CompactMetric icon="alert" tone="red" label="Vencidos" value={String(metrics.overdue)} />
        </section>

        <section className="filter-bar production-filters">
          <label className="filter-search">
            <Icon name="search" size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar pedido, cliente o trabajo..."
            />
          </label>

          <select className="filter-select" value={priority} onChange={(event) => setPriority(event.target.value)}>
            {PRIORITIES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
          </select>

          <select className="filter-select" value={responsible} onChange={(event) => setResponsible(event.target.value)}>
            <option value="">Todos los responsables</option>
            {members.map((member) => (
              <option value={member.user_id} key={member.user_id}>{member.full_name}</option>
            ))}
          </select>

          {(search || priority || responsible) && (
            <button className="button modal-secondary" type="button" onClick={() => { setSearch(""); setPriority(""); setResponsible(""); }}>
              Limpiar filtros
            </button>
          )}
        </section>

        {loading ? (
          <section className="production-loading">
            {STAGES.map((stage) => (
              <div className="kanban-column" key={stage.value}>
                <div className="kanban-head"><strong>{stage.label}</strong><span className="kanban-count">—</span></div>
                {[0,1].map((item) => <div className="production-card-skeleton" key={item}><span/><span/><span/></div>)}
              </div>
            ))}
          </section>
        ) : (
          <section className="kanban production-kanban">
            {STAGES.map((stage) => {
              const stageJobs = grouped.get(stage.value) ?? [];
              return (
                <div
                  className={`kanban-column production-column ${dragOverStage === stage.value ? "drag-over" : ""}`}
                  key={stage.value}
                  onDragOver={(event) => { event.preventDefault(); setDragOverStage(stage.value); }}
                  onDragLeave={() => setDragOverStage(null)}
                  onDrop={(event) => {
                    event.preventDefault();
                    const jobId = event.dataTransfer.getData("text/plain") || draggedJobId;
                    setDragOverStage(null);
                    setDraggedJobId(null);
                    if (jobId) void move(jobId, stage.value);
                  }}
                >
                  <div className="kanban-head production-column-head">
                    <div>
                      <span className={`stage-dot stage-${stage.value}`} />
                      <strong>{stage.label}</strong>
                    </div>
                    <span className="kanban-count">{stageJobs.length}</span>
                  </div>

                  <div className="production-column-body">
                    {stageJobs.length === 0 ? (
                      <div className="production-column-empty">
                        <span>Sin trabajos</span>
                      </div>
                    ) : stageJobs.map((job) => (
                      <article
                        className={`job-card production-job-card ${busyJobId === job.job_id ? "busy" : ""}`}
                        key={job.job_id}
                        draggable={busyJobId !== job.job_id}
                        onDragStart={(event) => {
                          setDraggedJobId(job.job_id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", job.job_id);
                        }}
                        onDragEnd={() => { setDraggedJobId(null); setDragOverStage(null); }}
                        onClick={() => openDetail(job)}
                      >
                        <div className="production-card-top">
                          <span className="job-number">#{String(job.order_number).padStart(5, "0")}</span>
                          <span className={`production-priority ${priorityClass(job.priority)}`}>
                            {priorityLabel(job.priority)}
                          </span>
                        </div>

                        <h4>{job.first_item || "Trabajo sin descripción"}</h4>
                        <p>{job.client_name}</p>

                        {job.item_count > 1 && <span className="production-items-count">+ {job.item_count - 1} ítems</span>}

                        <div className="production-assignee">
                          <span className="assignee-avatar">{job.responsible_name.slice(0,2).toUpperCase()}</span>
                          <span>{job.responsible_name}</span>
                        </div>

                        <div className="job-meta production-date-row">
                          <span>{job.is_overdue ? "Vencido" : "Entrega"}</span>
                          <strong className={job.is_overdue ? "overdue" : ""}>{formatDate(job.delivery_date)}</strong>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </div>

      {selected && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <article className="modal-card production-detail-modal">
            <header className="modal-head">
              <div>
                <span>PRODUCCIÓN · PEDIDO #{String(selected.order_number).padStart(5, "0")}</span>
                <h3>{selected.first_item || "Trabajo"}</h3>
              </div>
              <button className="modal-close" type="button" onClick={() => setSelected(null)}>×</button>
            </header>

            <div className="production-detail-body">
              <div className="production-detail-summary">
                <div><span>Cliente</span><strong>{selected.client_name}</strong></div>
                <div><span>Prioridad</span><strong>{priorityLabel(selected.priority)}</strong></div>
                <div><span>Entrega</span><strong className={selected.is_overdue ? "overdue" : ""}>{formatDate(selected.delivery_date)}</strong></div>
                <div><span>Ítems</span><strong>{selected.item_count}</strong></div>
              </div>

              <div className="production-detail-grid">
                <div className="field">
                  <label>Etapa</label>
                  <select
                    value={selected.production_status}
                    disabled={busyJobId === selected.job_id}
                    onChange={(event) => void move(selected.job_id, event.target.value as ProductionStage)}
                  >
                    {STAGES.map((stage) => <option value={stage.value} key={stage.value}>{stage.label}</option>)}
                  </select>
                </div>

                <div className="field">
                  <label>Responsable</label>
                  <select
                    value={detailResponsible}
                    disabled={busyJobId === selected.job_id}
                    onChange={(event) => void saveResponsible(event.target.value)}
                  >
                    <option value="">Sin asignar</option>
                    {members.map((member) => (
                      <option value={member.user_id} key={member.user_id}>{member.full_name} · {member.role_name}</option>
                    ))}
                  </select>
                </div>

                <div className="field full production-notes-field">
                  <label>Notas internas de producción</label>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Indicaciones, materiales, detalles de terminación, observaciones..."
                  />
                </div>
              </div>
            </div>

            <footer className="modal-actions">
              <button className="button modal-secondary" type="button" onClick={() => setSelected(null)}>Cerrar</button>
              <button className="button button-dark" type="button" disabled={busyJobId === selected.job_id} onClick={() => void saveNotes()}>
                {busyJobId === selected.job_id ? "Guardando..." : "Guardar notas"}
              </button>
            </footer>
          </article>
        </div>
      )}
    </>
  );
}
