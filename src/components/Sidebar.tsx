"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon, isIconName } from "@/components/Icon";
import { navigation } from "@/lib/navigation";
import { brand } from "@/lib/brand";
import { company as demoCompany, user as demoUser } from "@/lib/demo-data";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { demoMode } from "@/lib/runtime";

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function closeMobileMenu() {
  document.getElementById("sidebar")?.classList.remove("visible");
  document.getElementById("sidebar-backdrop")?.classList.remove("visible");
  document.body.classList.remove("mobile-nav-open");
}

export function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const {
    memberships,
    currentCompany,
    currentRole,
    modules,
    setCurrentCompanyId
  } = useTenant();

  const companyName = currentCompany?.name ?? demoCompany.name;
  const userName =
    user?.user_metadata?.full_name ||
    user?.email?.split("@")[0] ||
    demoUser.fullName;

  const moduleConfig = new Map(
    modules
      .filter((item) => item.modules?.code)
      .map((item) => [item.modules!.code, item])
  );

  const settingsConfig = moduleConfig.get("settings");
  const settingsLabel = settingsConfig?.custom_label || "Configuración";
  const settingsIcon =
    settingsConfig?.custom_icon && isIconName(settingsConfig.custom_icon)
      ? settingsConfig.custom_icon
      : "settings";

  const visibleNavigation = navigation
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => {
          if (demoMode) return true;
          if (item.code === "users") return true;
          const config = moduleConfig.get(item.code);
          return config ? config.enabled : true;
        })
        .map((item) => {
          const config = moduleConfig.get(item.code);
          return {
            ...item,
            label: config?.custom_label || item.label,
            icon:
              config?.custom_icon && isIconName(config.custom_icon)
                ? config.custom_icon
                : item.icon,
            sortOrder: config?.sort_order ?? 999
          };
        })
        .sort((a, b) => a.sortOrder - b.sortOrder)
    }))
    .filter((group) => group.items.length > 0);

  useEffect(() => {
    closeMobileMenu();
  }, [path]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobileMenu();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleSignOut = async () => {
    closeMobileMenu();
    await signOut();
    router.push("/login");
  };

  return (
    <>
      <aside className="sidebar" id="sidebar" aria-label="Navegación principal">
        <div className="sidebar-top">
          <Link href="/dashboard" className="brand" onClick={closeMobileMenu}>
            <div className="brand-symbol" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="brand-copy">
              <strong>{brand.name}</strong>
              <small>{brand.tagline}</small>
            </div>
          </Link>

          <button
            type="button"
            className="sidebar-close"
            aria-label="Cerrar menú"
            onClick={closeMobileMenu}
          >
            ×
          </button>
        </div>

        <div className="workspace-card">
          <div className="workspace-logo">
            {initials(companyName) || brand.initials}
          </div>

          <div className="workspace-info">
            <span>Espacio de trabajo</span>
            {memberships.length > 1 && !demoMode ? (
              <select
                className="workspace-select"
                value={currentCompany?.id ?? ""}
                onChange={(event) => {
                  setCurrentCompanyId(event.target.value);
                  closeMobileMenu();
                }}
                aria-label="Cambiar empresa"
              >
                {memberships.map((membership) => (
                  <option key={membership.company_id} value={membership.company_id}>
                    {membership.companies?.name ?? "Empresa"}
                  </option>
                ))}
              </select>
            ) : (
              <strong>{companyName}</strong>
            )}
          </div>

          <Link
            href="/configuracion"
            className="workspace-action"
            aria-label="Configurar empresa"
            onClick={closeMobileMenu}
          >
            <Icon name="arrow" size={13} />
          </Link>
        </div>

        <nav className="main-navigation">
          {visibleNavigation.map((group) => (
            <div className="navigation-section" key={group.section}>
              <span className="navigation-label">{group.section}</span>

              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={closeMobileMenu}
                  className={`nav-link ${
                    path.startsWith(item.href) ? "active" : ""
                  }`}
                >
                  <span className="nav-icon">
                    <Icon name={item.icon} size={16} />
                  </span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <Link
            href="/configuracion"
            onClick={closeMobileMenu}
            className={`nav-link ${
              path.startsWith("/configuracion") ? "active" : ""
            }`}
          >
            <span className="nav-icon">
              <Icon name={settingsIcon} size={16} />
            </span>
            <span>{settingsLabel}</span>
          </Link>

          <div className="user-card">
            <div className="user-avatar">{initials(userName) || "AD"}</div>
            <div className="user-information">
              <strong>{userName}</strong>
              <span>{currentRole ?? demoUser.role}</span>
            </div>

            <button
              type="button"
              className="user-menu-button"
              aria-label="Cerrar sesión"
              onClick={handleSignOut}
            >
              <Icon name="logout" size={15} />
            </button>
          </div>
        </div>
      </aside>

      <button
        id="sidebar-backdrop"
        className="sidebar-backdrop"
        type="button"
        aria-label="Cerrar navegación"
        onClick={closeMobileMenu}
      />
    </>
  );
}
