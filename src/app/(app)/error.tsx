"use client";

import { useEffect } from "react";
import { Icon } from "@/components/Icon";

export default function AppError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("GestArt route error:", error);
  }, [error]);

  return (
    <div className="page-content route-error-page">
      <div className="route-error-card">
        <span><Icon name="alert" size={25} /></span>
        <strong>No pudimos cargar esta sección</strong>
        <p>
          La información no se modificó. Podés volver a intentar o regresar al
          panel principal.
        </p>
        <div>
          <button className="button button-dark" type="button" onClick={reset}>
            Reintentar
          </button>
          <a className="button modal-secondary" href="/dashboard">
            Ir al inicio
          </a>
        </div>
        {error.digest && <small>Referencia: {error.digest}</small>}
      </div>
    </div>
  );
}
