"use client";

import Link from "next/link";
import { useTenant } from "@/contexts/TenantContext";
import { demoMode } from "@/lib/runtime";

/**
 * Muestra un aviso si el módulo está desactivado para la empresa actual.
 * Los módulos se activan en Configuración > Navegación.
 */
export function ModuleGate({
  code,
  label,
  children
}: {
  code: string;
  label: string;
  children: React.ReactNode;
}) {
  const { modules, loading } = useTenant();

  if (demoMode || loading) return <>{children}</>;

  const config = modules.find((item) => item.modules?.code === code);
  if (config && !config.enabled) {
    return (
      <div className="page-content page-stack">
        <section className="content-card">
          <div className="clients-empty">
            <strong>El módulo «{label}» está desactivado</strong>
            <p>Podés activarlo en Configuración → Navegación.</p>
            <Link className="button button-dark" href="/configuracion">
              Ir a Configuración
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return <>{children}</>;
}
