"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/Icon";

const mobileItems = [
  { href: "/dashboard", label: "Inicio", icon: "home" as const },
  { href: "/clientes", label: "Clientes", icon: "users" as const },
  { href: "/pedidos", label: "Pedidos", icon: "orders" as const },
  { href: "/produccion", label: "Producción", icon: "production" as const }
];

export function MobileNav() {
  const pathname = usePathname();

  const openMore = () => {
    document.getElementById("sidebar")?.classList.add("visible");
    document.getElementById("sidebar-backdrop")?.classList.add("visible");
    document.body.classList.add("mobile-nav-open");
  };

  return (
    <nav className="mobile-bottom-nav" aria-label="Accesos rápidos">
      {mobileItems.map((item) => (
        <Link
          href={item.href}
          key={item.href}
          className={pathname.startsWith(item.href) ? "active" : ""}
        >
          <Icon name={item.icon} size={18} />
          <span>{item.label}</span>
        </Link>
      ))}
      <button type="button" onClick={openMore}>
        <Icon name="menu" size={18} />
        <span>Más</span>
      </button>
    </nav>
  );
}
