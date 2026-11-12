"use client";

import { useEffect, useMemo, useState } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { buildTicketHtml, printHtmlDocument } from "@/lib/ticket";
import type { SaleRecord } from "@/services/sales";

const WIDTH_KEY = "gestart_ticket_width";

export function SaleTicketModal({
  sale,
  received,
  onClose
}: {
  sale: SaleRecord;
  received?: number | null;
  onClose: () => void;
}) {
  const { currentCompany, settings } = useTenant();
  const [width, setWidth] = useState<58 | 80>(58);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(WIDTH_KEY);
      if (saved === "80") setWidth(80);
    } catch {
      // el navegador puede bloquear el almacenamiento
    }
  }, []);

  function changeWidth(next: 58 | 80) {
    setWidth(next);
    try {
      window.localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      // ignorar
    }
  }

  const html = useMemo(
    () =>
      buildTicketHtml(sale, {
        width,
        locale: settings?.locale || "es-AR",
        currency: settings?.currency || "ARS",
        received,
        company: {
          name: currentCompany?.name || "GestArt",
          legal_name: currentCompany?.legal_name,
          tax_id: currentCompany?.tax_id,
          address: settings?.address,
          city: settings?.city,
          phone: settings?.phone || settings?.whatsapp
        }
      }),
    [sale, width, received, currentCompany, settings]
  );

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="modal-card pos-ticket-card">
        <div className="modal-head">
          <div>
            <span>TICKET</span>
            <h3>Venta #{sale.sale_number}</h3>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="pos-tabs" role="tablist" style={{ width: "fit-content" }}>
          <button type="button" className={width === 58 ? "active" : ""} onClick={() => changeWidth(58)}>Rollo 58 mm</button>
          <button type="button" className={width === 80 ? "active" : ""} onClick={() => changeWidth(80)}>Rollo 80 mm</button>
        </div>

        <iframe
          className={`pos-ticket-frame w${width}`}
          title={`Ticket de la venta ${sale.sale_number}`}
          srcDoc={html}
        />

        <p className="muted-small">
          Se imprime en la impresora de tickets. Para guardarlo como PDF, elegí «Guardar como PDF» en el cuadro de impresión.
        </p>

        <div className="modal-actions">
          <button type="button" className="button modal-secondary" onClick={onClose}>Cerrar</button>
          <button type="button" className="button button-dark" onClick={() => printHtmlDocument(html)}>
            Imprimir ticket
          </button>
        </div>
      </div>
    </div>
  );
}
