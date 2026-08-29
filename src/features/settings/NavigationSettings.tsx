"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon, iconNames, isIconName, type IconName } from "@/components/Icon";
import { useTenant, type TenantModule } from "@/contexts/TenantContext";
import { demoMode } from "@/lib/runtime";
import { supabaseBrowser } from "@/lib/supabase/browser";

type DraftModule = TenantModule & {
  label: string;
  icon: IconName;
};

function toDraft(item: TenantModule): DraftModule {
  const label =
    item.custom_label ||
    item.modules?.default_label ||
    item.modules?.code ||
    "Módulo";
  const icon =
    item.custom_icon && isIconName(item.custom_icon)
      ? item.custom_icon
      : item.modules?.default_icon && isIconName(item.modules.default_icon)
        ? item.modules.default_icon
        : "boxes";

  return { ...item, label, icon };
}

export function NavigationSettings() {
  const { currentCompany, modules, reload } = useTenant();
  const [rows, setRows] = useState<DraftModule[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setRows([...modules].sort((a, b) => a.sort_order - b.sort_order).map(toDraft));
  }, [modules]);

  const enabledCount = useMemo(
    () => rows.filter((item) => item.enabled).length,
    [rows]
  );

  function patch(moduleId: string, value: Partial<DraftModule>) {
    setRows((current) =>
      current.map((item) =>
        item.module_id === moduleId ? { ...item, ...value } : item
      )
    );
  }

  function move(fromId: string, toId: string) {
    if (fromId === toId) return;
    setRows((current) => {
      const next = [...current];
      const from = next.findIndex((item) => item.module_id === fromId);
      const to = next.findIndex((item) => item.module_id === toId);
      if (from < 0 || to < 0) return current;
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next.map((row, index) => ({ ...row, sort_order: index + 1 }));
    });
  }

  async function save() {
    setMessage("");
    setError("");

    if (demoMode) {
      setMessage("Navegación actualizada en modo demo.");
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;

    setBusy(true);
    try {
      const { error: rpcError } = await supabaseBrowser.rpc(
        "save_company_navigation",
        {
          p_company_id: currentCompany.id,
          p_modules: rows.map((item, index) => ({
            module_id: item.module_id,
            enabled: item.modules?.is_core ? true : item.enabled,
            custom_label:
              item.label.trim() &&
              item.label.trim() !== item.modules?.default_label
                ? item.label.trim()
                : null,
            custom_icon:
              item.icon !== item.modules?.default_icon ? item.icon : null,
            sort_order: index + 1
          }))
        }
      );
      if (rpcError) throw rpcError;
      await reload();
      setMessage("Navegación guardada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la navegación.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="settings-section-heading">
        <div>
          <h3>Navegación</h3>
          <p>
            Activá módulos, cambiá sus nombres e iconos y arrastralos para definir
            el orden del menú.
          </p>
        </div>
        <span className="settings-count-pill">{enabledCount} activos</span>
      </div>

      {rows.length === 0 ? (
        <div className="settings-coming-card">
          <Icon name="menu" size={24} />
          <h3>Sin módulos configurados</h3>
          <p>Revisá que la empresa haya completado correctamente el onboarding.</p>
        </div>
      ) : (
        <div className="navigation-editor">
          {rows.map((item) => (
            <div
              className={`navigation-editor-row ${
                dragging === item.module_id ? "dragging" : ""
              }`}
              key={item.module_id}
              draggable
              onDragStart={() => setDragging(item.module_id)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragging) move(dragging, item.module_id);
                setDragging(null);
              }}
            >
              <button
                className="navigation-drag-handle"
                type="button"
                title="Arrastrar para ordenar"
                aria-label={`Mover ${item.label}`}
              >
                <span /><span /><span />
              </button>

              <span className="navigation-preview-icon">
                <Icon name={item.icon} size={16} />
              </span>

              <label className="navigation-editor-field">
                <span>Nombre</span>
                <input
                  value={item.label}
                  maxLength={40}
                  onChange={(event) =>
                    patch(item.module_id, { label: event.target.value })
                  }
                />
              </label>

              <label className="navigation-editor-field icon-field">
                <span>Icono</span>
                <select
                  value={item.icon}
                  onChange={(event) =>
                    patch(item.module_id, {
                      icon: event.target.value as IconName
                    })
                  }
                >
                  {iconNames
                    .filter((name) =>
                      [
                        "home","orders","quote","users","production","materials",
                        "cash","reports","history","settings","building","boxes",
                        "calendar","credit","database","truck","palette"
                      ].includes(name)
                    )
                    .map((name) => (
                      <option value={name} key={name}>{name}</option>
                    ))}
                </select>
              </label>

              <label className="navigation-toggle">
                <input
                  type="checkbox"
                  checked={item.modules?.is_core ? true : item.enabled}
                  disabled={Boolean(item.modules?.is_core)}
                  onChange={(event) =>
                    patch(item.module_id, { enabled: event.target.checked })
                  }
                />
                <span>
                  <strong>{item.modules?.is_core ? "Esencial" : "Activo"}</strong>
                  <small>
                    {item.modules?.is_core
                      ? "No puede desactivarse."
                      : item.enabled
                        ? "Visible en el menú."
                        : "Oculto para la empresa."}
                  </small>
                </span>
              </label>
            </div>
          ))}
        </div>
      )}

      {error && <div className="form-message error">{error}</div>}
      {message && <div className="form-message success">{message}</div>}

      <button
        className="button button-dark"
        type="button"
        disabled={busy || rows.length === 0}
        onClick={() => void save()}
        style={{ marginTop: 18 }}
      >
        {busy ? "Guardando..." : "Guardar navegación"}
      </button>
    </>
  );
}
