export const navigation = [
  {
    section: "Operación",
    items: [
      { code: "dashboard", href: "/dashboard", label: "Inicio", icon: "home" as const },
      { code: "clients", href: "/clientes", label: "Clientes", icon: "users" as const },
      { code: "quotes", href: "/presupuestos", label: "Presupuestos", icon: "quote" as const },
      { code: "orders", href: "/pedidos", label: "Pedidos", icon: "orders" as const },
      { code: "production", href: "/produccion", label: "Producción", icon: "production" as const },
      { code: "materials", href: "/materiales", label: "Materiales", icon: "materials" as const }
    ]
  },
  {
    section: "Administración",
    items: [
      { code: "cash", href: "/caja", label: "Caja y pagos", icon: "cash" as const },
      { code: "reports", href: "/reportes", label: "Reportes", icon: "reports" as const },
      { code: "history", href: "/historial", label: "Historial", icon: "history" as const },
      { code: "users", href: "/usuarios", label: "Usuarios", icon: "users" as const }
    ]
  }
];
