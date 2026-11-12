import type { SaleRecord } from "@/services/sales";

export type TicketCompany = {
  name: string;
  legal_name?: string | null;
  tax_id?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
};

export type TicketOptions = {
  /** Ancho del papel en mm (rollos térmicos de 58 u 80 mm). */
  width: 58 | 80;
  locale: string;
  currency: string;
  company: TicketCompany;
  /** Efectivo recibido, para mostrar el vuelto. */
  received?: number | null;
};

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Arma el HTML del ticket (formato rollo térmico, como el de Lo de Fausti). */
export function buildTicketHtml(sale: SaleRecord, options: TicketOptions): string {
  const { width, locale, currency, company, received } = options;
  const money = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 });
  const qtyFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(
    new Date(sale.sold_at)
  );

  const bodyWidth = width === 58 ? "48mm" : "72mm";
  const font = width === 58 ? 11 : 12;
  const number = String(sale.sale_number).padStart(6, "0");
  const change = received != null && received >= sale.total ? received - sale.total : null;
  const units = sale.items.reduce((sum, item) => sum + item.quantity, 0);

  const itemsHtml = sale.items
    .map((item) => {
      const gross = item.unit_price * item.quantity;
      return `
        <div class="item">
          <div class="name">${esc(item.name)}</div>
          <div class="row"><span>${esc(qtyFmt.format(item.quantity))} x ${esc(money.format(item.unit_price))}</span><span>${esc(money.format(gross))}</span></div>
          ${item.discount > 0 ? `<div class="row small"><span>Descuento</span><span>-${esc(money.format(item.discount))}</span></div>` : ""}
        </div>`;
    })
    .join("");

  const address = [company.address, company.city].filter(Boolean).join(", ");

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Ticket #${esc(number)}</title>
<style>
  @page { size: ${width}mm auto; margin: 2mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: ${bodyWidth}; margin: 0 auto; padding: 2mm 0; font-family: "Courier New", Courier, monospace; font-size: ${font}px; line-height: 1.35; color: #000; }
  .center { text-align: center; }
  .brand { font-size: ${font + 4}px; font-weight: 700; letter-spacing: .5px; }
  .muted { font-size: ${font - 1}px; }
  .sep { border-top: 1px dashed #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
  .item { margin-bottom: 5px; }
  .item .name { font-weight: 700; word-break: break-word; }
  .small { font-size: ${font - 1}px; }
  .total { font-size: ${font + 4}px; font-weight: 700; }
  .stamp { border: 2px solid #000; text-align: center; font-weight: 700; padding: 3px; margin: 6px 0; }
</style></head>
<body>
  <div class="center">
    <div class="brand">${esc(company.name)}</div>
    ${company.legal_name && company.legal_name !== company.name ? `<div class="muted">${esc(company.legal_name)}</div>` : ""}
    ${company.tax_id ? `<div class="muted">CUIT: ${esc(company.tax_id)}</div>` : ""}
    ${address ? `<div class="muted">${esc(address)}</div>` : ""}
    ${company.phone ? `<div class="muted">Tel: ${esc(company.phone)}</div>` : ""}
  </div>
  <div class="sep"></div>
  <div class="row"><span>Ticket N&deg;</span><strong>${esc(number)}</strong></div>
  <div class="row"><span>Fecha</span><span>${esc(when)}</span></div>
  ${sale.status === "cancelled" ? `<div class="stamp">VENTA ANULADA</div>` : ""}
  <div class="sep"></div>
  ${itemsHtml}
  <div class="sep"></div>
  <div class="row small"><span>Cantidad de unidades</span><span>${esc(qtyFmt.format(units))}</span></div>
  <div class="row"><span>Subtotal</span><span>${esc(money.format(sale.subtotal))}</span></div>
  ${sale.discount_total > 0 ? `<div class="row"><span>Descuentos</span><span>-${esc(money.format(sale.discount_total))}</span></div>` : ""}
  <div class="sep"></div>
  <div class="row total"><span>TOTAL</span><span>${esc(money.format(sale.total))}</span></div>
  <div class="sep"></div>
  <div class="row"><span>Pago</span><span>${esc(sale.payment_method_name || "-")}</span></div>
  ${received != null ? `<div class="row"><span>Recibido</span><span>${esc(money.format(received))}</span></div>` : ""}
  ${change != null ? `<div class="row"><strong>Vuelto</strong><strong>${esc(money.format(change))}</strong></div>` : ""}
  <div class="sep"></div>
  <div class="center">
    <div>&iexcl;Gracias por su compra!</div>
    <div class="muted">Comprobante no v&aacute;lido como factura</div>
  </div>
  <div style="height:8mm"></div>
</body></html>`;
}

/** Imprime un documento HTML sin abrir ventanas emergentes (permite "Guardar como PDF"). */
export function printHtmlDocument(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(frame);

  const cleanup = () => window.setTimeout(() => frame.remove(), 1500);
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return cleanup();
    win.focus();
    win.onafterprint = cleanup;
    win.print();
    window.setTimeout(cleanup, 120000);
  };
  frame.srcdoc = html;
}
