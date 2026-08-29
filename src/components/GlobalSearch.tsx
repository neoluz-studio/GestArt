"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, isIconName, type IconName } from "@/components/Icon";
import { navigation } from "@/lib/navigation";
import { useTenant } from "@/contexts/TenantContext";
import { demoMode } from "@/lib/runtime";

export function GlobalSearch() {
  const router = useRouter();
  const { modules } = useTenant();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const moduleConfig = useMemo(
    () =>
      new Map(
        modules
          .filter((item) => item.modules?.code)
          .map((item) => [item.modules!.code, item])
      ),
    [modules]
  );

  const entries = useMemo(() => {
    type SearchEntry = {
      code: string;
      href: string;
      label: string;
      icon: IconName;
      section: string;
      searchable: string;
    };

    const rows: SearchEntry[] = navigation.flatMap((group) =>
      group.items
        .filter((item) => {
          if (demoMode || item.code === "users") return true;
          const config = moduleConfig.get(item.code);
          return config ? config.enabled : true;
        })
        .map((item) => {
          const config = moduleConfig.get(item.code);
          const label = config?.custom_label || item.label;
          const icon: IconName =
            config?.custom_icon && isIconName(config.custom_icon)
              ? config.custom_icon
              : item.icon;

          return {
            code: item.code,
            href: item.href,
            label,
            icon,
            section: group.section,
            searchable: `${label} ${group.section} ${item.code}`.toLowerCase()
          };
        })
    );

    const settingsConfig = moduleConfig.get("settings");
    rows.push({
      code: "settings",
      href: "/configuracion",
      label: settingsConfig?.custom_label || "Configuración",
      icon:
        settingsConfig?.custom_icon && isIconName(settingsConfig.custom_icon)
          ? settingsConfig.custom_icon
          : "settings",
      section: "Sistema",
      searchable:
        "configuración ajustes empresa apariencia navegación presupuestos pagos sistema seguridad"
    });

    return rows;
  }, [moduleConfig]);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return entries.slice(0, 8);
    return entries
      .filter((entry) => entry.searchable.includes(term))
      .slice(0, 8);
  }, [entries, query]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    document.body.classList.add("command-open");
    return () => {
      window.clearTimeout(timer);
      document.body.classList.remove("command-open");
    };
  }, [open]);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <>
      <button
        className="quick-search"
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Icon name="search" size={14} />
        <span>Buscar en GestArt...</span>
        <kbd>Ctrl K</kbd>
      </button>

      {open && (
        <div
          className="command-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false);
          }}
        >
          <section
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Buscar en GestArt"
          >
            <div className="command-search-box">
              <Icon name="search" size={17} />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && results[0]) {
                    go(results[0].href);
                  }
                }}
                placeholder="Ir a clientes, pedidos, caja, reportes..."
              />
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar búsqueda">
                ESC
              </button>
            </div>

            <div className="command-results">
              {results.length === 0 ? (
                <div className="command-empty">
                  <Icon name="search" size={20} />
                  <strong>Sin resultados</strong>
                  <span>Probá con otra palabra.</span>
                </div>
              ) : (
                results.map((entry, index) => (
                  <button
                    type="button"
                    className="command-result"
                    key={entry.href}
                    onClick={() => go(entry.href)}
                  >
                    <span className="command-result-icon">
                      <Icon name={entry.icon} size={15} />
                    </span>
                    <span>
                      <strong>{entry.label}</strong>
                      <small>{entry.section}</small>
                    </span>
                    {index === 0 && <kbd>Enter</kbd>}
                    <Icon name="arrow" size={13} />
                  </button>
                ))
              )}
            </div>

            <footer className="command-footer">
              <span><kbd>Ctrl K</kbd> abrir</span>
              <span><kbd>Esc</kbd> cerrar</span>
              <span><kbd>Enter</kbd> ir</span>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
