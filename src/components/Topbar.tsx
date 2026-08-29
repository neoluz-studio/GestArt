"use client";

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { GlobalSearch } from "@/components/GlobalSearch";
import { user as demoUser } from "@/lib/demo-data";
import { useAuth } from "@/contexts/AuthContext";

export function Topbar({
  eyebrow = "Panel general",
  title
}: {
  eyebrow?: string;
  title?: string;
}) {
  const { user } = useAuth();

  const name =
    user?.user_metadata?.full_name?.split(" ")[0] ||
    user?.email?.split("@")[0] ||
    demoUser.name;

  const openMenu = () => {
    document.getElementById("sidebar")?.classList.add("visible");
    document.getElementById("sidebar-backdrop")?.classList.add("visible");
    document.body.classList.add("mobile-nav-open");
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="menu-button"
          type="button"
          aria-label="Abrir menú"
          onClick={openMenu}
        >
          <Icon name="menu" size={18} />
        </button>

        <div className="topbar-title">
          <span className="eyebrow">{eyebrow}</span>
          <h1>
            {title ?? (
              <>
                Buen día, <span>{name}</span>
              </>
            )}
          </h1>
        </div>
      </div>

      <div className="topbar-actions">
        <GlobalSearch />

        <button className="icon-button" type="button" aria-label="Notificaciones">
          <Icon name="bell" size={16} />
          <span className="notification-dot" />
        </button>

        <Link className="primary-action" href="/pedidos?new=1">
          <Icon name="plus" size={15} />
          <span>Nuevo pedido</span>
        </Link>
      </div>
    </header>
  );
}
