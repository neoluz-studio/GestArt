"use client";

import autoTable from "jspdf-autotable";
import { jsPDF } from "jspdf";
import type { OrderDetail } from "@/services/orders";
import type { QuoteDetail } from "@/services/quotes";
import type { ReportBundle } from "@/services/reports";
import type {
  CompanyDocumentProfile,
  DocumentClient,
  PaymentInformation
} from "@/services/documents";

type DocumentItem = {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
};

type PrintableDocument = {
  kind: "quote" | "order";
  title: string;
  number: string;
  status: string;
  issueLabel: string;
  issueDate: string;
  secondaryLabel: string;
  secondaryDate: string | null;
  client: DocumentClient;
  items: DocumentItem[];
  subtotal: number;
  discount: number;
  total: number;
  notes: string | null;
  paid?: number;
  balance?: number;
  footer: string | null;
};

function money(profile: CompanyDocumentProfile, value: number) {
  return new Intl.NumberFormat(profile.locale, {
    style: "currency",
    currency: profile.currency,
    maximumFractionDigits: 2
  }).format(value);
}

function date(profile: CompanyDocumentProfile, value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(profile.locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(`${value}T12:00:00`));
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "").trim();
  const value = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized.padEnd(6, "0").slice(0, 6);
  return {
    r: Number.parseInt(value.slice(0, 2), 16) || 109,
    g: Number.parseInt(value.slice(2, 4), 16) || 74,
    b: Number.parseInt(value.slice(4, 6), 16) || 255
  };
}

function paymentRows(value: CompanyDocumentProfile["payment_information"]) {
  if (!value) return [] as Array<[string, string]>;

  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry === "string") return [["Pago", entry] as [string, string]];
      if (entry && typeof entry === "object") {
        const object = entry as Record<string, unknown>;
        const label = String(object.label ?? object.name ?? "Pago");
        const itemValue = object.value ?? object.detail ?? object.text;
        return itemValue == null ? [] : [[label, String(itemValue)] as [string, string]];
      }
      return [];
    });
  }

  if (typeof value === "object") {
    const info = value as PaymentInformation & Record<string, unknown>;
    const known: Array<[keyof PaymentInformation, string]> = [
      ["bank", "Banco"],
      ["holder", "Titular"],
      ["cbu", "CBU/CVU"],
      ["alias", "Alias"],
      ["account", "Cuenta"],
      ["notes", "Información de pago"]
    ];
    const rows = known
      .filter(([key]) => info[key] != null && String(info[key]).trim())
      .map(([key, label]) => [label, String(info[key])] as [string, string]);
    if (rows.length) return rows;

    return Object.entries(info)
      .filter(([, item]) => item != null && typeof item !== "object")
      .map(([key, item]) => [key.replaceAll("_", " "), String(item)] as [string, string]);
  }

  return [];
}

async function imageData(url: string | null) {
  if (!url) return null;
  try {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) return null;
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = objectUrl;
      });
      const maxWidth = 900;
      const scale = Math.min(1, maxWidth / Math.max(image.naturalWidth, 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return { dataUrl: canvas.toDataURL("image/png"), format: "PNG", width: canvas.width, height: canvas.height };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

// Encaja el logo dentro de una caja máxima (maxW x maxH) sin deformarlo:
// escala por el lado que más se pasa y devuelve el ancho/alto final más
// el offset para centrarlo verticalmente dentro de esa misma caja.
function fitLogoBox(
  logo: { width?: number; height?: number },
  maxW: number,
  maxH: number
): { w: number; h: number; offsetY: number } {
  const naturalW = logo.width || maxW;
  const naturalH = logo.height || maxH;
  const scale = Math.min(maxW / naturalW, maxH / naturalH, 1);
  const w = naturalW * scale;
  const h = naturalH * scale;
  return { w, h, offsetY: (maxH - h) / 2 };
}

function companyAddress(profile: CompanyDocumentProfile) {
  return [profile.address, profile.city, profile.province]
    .filter(Boolean)
    .join(", ");
}

function clientIdentity(client: DocumentClient) {
  return client.company_name && client.company_name !== client.name
    ? `${client.name} · ${client.company_name}`
    : client.name;
}

function quotePrintable(detail: QuoteDetail, client: DocumentClient): PrintableDocument {
  return {
    kind: "quote",
    title: "PRESUPUESTO",
    number: `P-${String(detail.quote.quote_number).padStart(4, "0")}`,
    status: detail.quote.status,
    issueLabel: "Fecha",
    issueDate: detail.quote.issue_date,
    secondaryLabel: "Válido hasta",
    secondaryDate: detail.quote.valid_until,
    client,
    items: detail.items,
    subtotal: detail.quote.subtotal,
    discount: detail.quote.discount,
    total: detail.quote.total,
    notes: detail.quote.notes,
    footer: null
  };
}

function orderPrintable(detail: OrderDetail, client: DocumentClient): PrintableDocument {
  return {
    kind: "order",
    title: "PEDIDO",
    number: `#${String(detail.order.order_number).padStart(5, "0")}`,
    status: detail.order.status,
    issueLabel: "Fecha",
    issueDate: detail.order.order_date,
    secondaryLabel: "Entrega",
    secondaryDate: detail.order.delivery_date,
    client,
    items: detail.items,
    subtotal: detail.order.subtotal,
    discount: detail.order.discount,
    total: detail.order.total,
    notes: detail.order.notes,
    paid: detail.order.paid,
    balance: detail.order.balance,
    footer: null
  };
}


function statusLabel(value: string) {
  const labels: Record<string, string> = {
    draft: "Borrador", sent: "Enviado", approved: "Aprobado", rejected: "Rechazado",
    converted: "Convertido", cancelled: "Cancelado", expired: "Vencido",
    budget: "Presupuesto", pending_payment: "Pendiente de pago", confirmed: "Confirmado",
    design: "Diseño", waiting_approval: "Esperando aprobación", pending_production: "Pendiente de producción",
    in_production: "En producción", ready: "Listo", pending_delivery: "Pendiente de entrega", delivered: "Entregado"
  };
  return labels[value] ?? value;
}

function setTextColor(doc: jsPDF, value: number) {
  doc.setTextColor(value, value, value);
}

async function downloadBusinessDocument(
  profile: CompanyDocumentProfile,
  document: PrintableDocument
) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const rgb = hexToRgb(profile.primary_color);
  const margin = 15;
  const showLogo = profile.document_settings.show_logo !== false;
  const logo = showLogo ? await imageData(profile.logo_url) : null;

  // Encabezado
  doc.setFillColor(rgb.r, rgb.g, rgb.b);
  doc.rect(0, 0, pageWidth, 7, "F");

  let companyX = margin;
  if (logo) {
    try {
      const logoBox = fitLogoBox(logo, 31, 18);
      doc.addImage(logo.dataUrl, logo.format, margin, 13 + logoBox.offsetY, logoBox.w, logoBox.h, undefined, "FAST");
      companyX = 50;
    } catch {
      companyX = margin;
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(32, 29, 42);
  doc.text(profile.name, companyX, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setTextColor(doc, 105);
  const companyLines = [
    profile.legal_name && profile.legal_name !== profile.name ? profile.legal_name : null,
    profile.document_settings.show_tax_id !== false && profile.tax_id ? `CUIT: ${profile.tax_id}` : null,
    profile.document_settings.show_contact !== false ? companyAddress(profile) : null,
    profile.document_settings.show_contact !== false && profile.phone ? `Tel: ${profile.phone}` : null,
    profile.document_settings.show_contact !== false && profile.email ? profile.email : null,
    profile.document_settings.show_contact !== false && profile.website ? profile.website : null
  ].filter(Boolean) as string[];
  doc.text(companyLines, companyX, 23, { lineHeightFactor: 1.35 });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(rgb.r, rgb.g, rgb.b);
  doc.text(document.title, pageWidth - margin, 17, { align: "right" });
  doc.setFontSize(18);
  doc.text(document.number, pageWidth - margin, 25, { align: "right" });

  if (document.kind === "quote" && profile.quote_header) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    setTextColor(doc, 105);
    const header = doc.splitTextToSize(profile.quote_header, 67);
    doc.text(header.slice(0, 3), pageWidth - margin, 30, { align: "right" });
  }

  doc.setDrawColor(232, 229, 238);
  doc.line(margin, 42, pageWidth - margin, 42);

  // Cliente y fechas
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(rgb.r, rgb.g, rgb.b);
  doc.text("CLIENTE", margin, 50);
  doc.text("DOCUMENTO", 126, 50);

  doc.setFontSize(11);
  doc.setTextColor(32, 29, 42);
  doc.text(clientIdentity(document.client), margin, 56);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setTextColor(doc, 100);
  const clientLines = [
    document.client.tax_id ? `CUIT/DNI: ${document.client.tax_id}` : null,
    document.client.address,
    document.client.phone,
    document.client.email
  ].filter(Boolean) as string[];
  doc.text(clientLines.slice(0, 4), margin, 61, { lineHeightFactor: 1.35 });

  doc.setFontSize(8.5);
  doc.setTextColor(50, 47, 58);
  doc.text(`${document.issueLabel}: ${date(profile, document.issueDate)}`, 126, 56);
  doc.text(`${document.secondaryLabel}: ${date(profile, document.secondaryDate)}`, 126, 61);
  doc.text(`Estado: ${statusLabel(document.status)}`, 126, 66);

  autoTable(doc, {
    startY: 79,
    margin: { left: margin, right: margin },
    head: [["Descripción", "Cant.", "Precio unit.", "Total"]],
    body: document.items.map((item) => [
      item.description,
      new Intl.NumberFormat(profile.locale, { maximumFractionDigits: 3 }).format(item.quantity),
      money(profile, item.unit_price),
      money(profile, item.total)
    ]),
    theme: "plain",
    headStyles: {
      fillColor: [rgb.r, rgb.g, rgb.b],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8.2,
      cellPadding: 3
    },
    bodyStyles: {
      fontSize: 8.4,
      textColor: [55, 52, 64],
      cellPadding: 3,
      lineColor: [232, 229, 238],
      lineWidth: { bottom: 0.1 }
    },
    columnStyles: {
  0: { cellWidth: 82 },
  1: { cellWidth: 18, halign: "right" },
  2: { cellWidth: 30, halign: "right" },
  3: { cellWidth: 30, halign: "right", fontStyle: "bold" }
},
    didDrawPage: () => {
      doc.setFontSize(7);
      setTextColor(doc, 145);
      doc.text(
        `${profile.name} · ${document.title} ${document.number}`,
        margin,
        pageHeight - 7
      );
      doc.text(
        `Página ${doc.getNumberOfPages()}`,
        pageWidth - margin,
        pageHeight - 7,
        { align: "right" }
      );
    }
  });

  const lastY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100;
  let y = lastY + 8;
  const totalsX = 126;
  const totalWidth = pageWidth - margin - totalsX;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 18) {
      doc.addPage();
      y = 20;
    }
  };

  ensureSpace(34);
  doc.setFontSize(8.5);
  setTextColor(doc, 92);
  doc.text("Subtotal", totalsX, y);
  doc.text(money(profile, document.subtotal), totalsX + totalWidth, y, { align: "right" });
  y += 6;

  if (document.discount > 0) {
    doc.text("Descuento", totalsX, y);
    doc.text(`- ${money(profile, document.discount)}`, totalsX + totalWidth, y, { align: "right" });
    y += 6;
  }

  doc.setDrawColor(225, 221, 234);
  doc.line(totalsX, y, pageWidth - margin, y);
  y += 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(rgb.r, rgb.g, rgb.b);
  doc.text("TOTAL", totalsX, y);
  doc.text(money(profile, document.total), pageWidth - margin, y, { align: "right" });
  doc.setFont("helvetica", "normal");

  if (document.kind === "order" && document.paid != null && document.balance != null) {
    y += 7;
    doc.setFontSize(8.2);
    setTextColor(doc, 92);
    doc.text(`Pagado: ${money(profile, document.paid)}`, totalsX, y);
    doc.text(`Saldo: ${money(profile, document.balance)}`, pageWidth - margin, y, { align: "right" });
  }

  y += 13;

  if (document.notes) {
    ensureSpace(26);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(rgb.r, rgb.g, rgb.b);
    doc.text("OBSERVACIONES", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setTextColor(doc, 85);
    const lines = doc.splitTextToSize(document.notes, pageWidth - margin * 2);
    doc.text(lines, margin, y, { lineHeightFactor: 1.4 });
    y += Math.min(lines.length, 12) * 4 + 7;
  }

  const payRows = profile.document_settings.show_payment_information !== false
    ? [
        ...(profile.payment_methods.length
          ? [["Métodos aceptados", profile.payment_methods.join(" · ")] as [string, string]]
          : []),
        ...paymentRows(profile.payment_information)
      ]
    : [];
  if (payRows.length) {
    ensureSpace(18 + payRows.length * 5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(rgb.r, rgb.g, rgb.b);
    doc.text("DATOS DE PAGO", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setTextColor(doc, 85);
    for (const [label, value] of payRows) {
      doc.setFont("helvetica", "bold");
      doc.text(`${label}:`, margin, y);
      doc.setFont("helvetica", "normal");
      const wrapped = doc.splitTextToSize(value, 125);
      doc.text(wrapped, margin + 31, y);
      y += Math.max(1, wrapped.length) * 4.2;
    }
    y += 5;
  }

  if (document.kind === "quote" && profile.terms_and_conditions) {
    ensureSpace(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(rgb.r, rgb.g, rgb.b);
    doc.text("TÉRMINOS Y CONDICIONES", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
    setTextColor(doc, 100);
    const lineHeight = 3.8;
    const termLines = doc.splitTextToSize(profile.terms_and_conditions, pageWidth - margin * 2) as string[];
    // Los términos y condiciones pueden ser largos: en vez de reservar un
    // espacio fijo y dejar que el texto se corte o se superponga con el
    // pie de página, dibujamos línea por línea y saltamos de página
    // cuando hace falta, para que nunca quede nada fuera de los márgenes.
    for (const line of termLines) {
      ensureSpace(lineHeight + 4);
      doc.text(line, margin, y);
      y += lineHeight;
    }
    y += 6;
  }

  const footer = document.kind === "quote" ? profile.quote_footer : profile.order_footer;
  if (footer) {
    ensureSpace(17);
    doc.setDrawColor(232, 229, 238);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;
    doc.setFontSize(7.5);
    setTextColor(doc, 115);
    const footerLines = doc.splitTextToSize(footer, pageWidth - margin * 2) as string[];
    ensureSpace(footerLines.length * 3.6 + 6);
    doc.text(footerLines, pageWidth / 2, y, { align: "center" });
    y += footerLines.length * 3.6 + 6;
  }

  // Firma de marca del sistema, discreta, al pie de la última página.
  // No pisa el pie que dibuja didDrawPage (nombre de la empresa + número
  // de página) porque va pegada al borde inferior de la hoja.
  const totalPages = doc.getNumberOfPages();
  doc.setPage(totalPages);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  setTextColor(doc, 175);
  doc.text("Sistema de gestión creado por NEOLUZ Studio", pageWidth / 2, pageHeight - 3, { align: "center" });

  doc.save(`${profile.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${document.kind}-${document.number.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function printableHtml(profile: CompanyDocumentProfile, document: PrintableDocument) {
  const rgb = hexToRgb(profile.primary_color);
  const payment = [
    ...(profile.payment_methods.length
      ? [["Métodos aceptados", profile.payment_methods.join(" · ")] as [string, string]]
      : []),
    ...paymentRows(profile.payment_information)
  ];
  const paymentHtml = profile.document_settings.show_payment_information !== false && payment.length
    ? `<section class="block"><h3>Datos de pago</h3>${payment.map(([label,value]) => `<p><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}</p>`).join("")}</section>`
    : "";
  const termsHtml = document.kind === "quote" && profile.terms_and_conditions
    ? `<section class="block terms"><h3>Términos y condiciones</h3><p>${escapeHtml(profile.terms_and_conditions).replaceAll("\n", "<br>")}</p></section>`
    : "";
  const footer = document.kind === "quote" ? profile.quote_footer : profile.order_footer;

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(document.title)} ${escapeHtml(document.number)}</title>
<style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#24212c;margin:0;font-size:12px}.topline{height:6px;background:rgb(${rgb.r},${rgb.g},${rgb.b});position:fixed;top:0;left:0;right:0}.header{display:flex;justify-content:space-between;gap:28px;padding-top:10px;padding-bottom:18px;border-bottom:1px solid #e8e5ed}.brand{display:flex;gap:15px;align-items:flex-start}.brand img{width:115px;max-height:68px;object-fit:contain}.brand h1{font-size:21px;margin:0 0 5px}.muted{color:#777281}.brand p,.doc-meta p,.client p{margin:2px 0;line-height:1.35}.doc-meta{text-align:right}.doc-meta small{color:rgb(${rgb.r},${rgb.g},${rgb.b});font-weight:700}.doc-meta h2{font-size:24px;color:rgb(${rgb.r},${rgb.g},${rgb.b});margin:4px 0 8px}.info{display:grid;grid-template-columns:1.5fr 1fr;gap:28px;padding:18px 0}.info h3,.block h3{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:rgb(${rgb.r},${rgb.g},${rgb.b});margin:0 0 7px}.client strong{font-size:14px}table{width:100%;border-collapse:collapse;margin-top:5px}th{background:rgb(${rgb.r},${rgb.g},${rgb.b});color:white;text-align:left;padding:9px 8px;font-size:10px}td{padding:9px 8px;border-bottom:1px solid #ebe8ef}th:nth-child(n+2),td:nth-child(n+2){text-align:right}.totals{width:290px;margin:17px 0 20px auto}.totals>div{display:flex;justify-content:space-between;padding:5px 0}.totals .grand{border-top:1px solid #ddd7e8;margin-top:4px;padding-top:9px;color:rgb(${rgb.r},${rgb.g},${rgb.b});font-size:17px;font-weight:800}.block{margin-top:17px;padding-top:10px}.block p{margin:3px 0;line-height:1.5}.terms{font-size:10px;color:#696472}.footer{margin-top:25px;padding-top:10px;border-top:1px solid #e8e5ed;text-align:center;color:#777281;font-size:10px}.status{display:inline-block;padding:4px 8px;background:#f0edf5;border-radius:99px;font-size:10px;font-weight:700}.print-help{position:fixed;right:12px;bottom:12px;background:#17151d;color:white;border:0;padding:10px 14px;border-radius:9px;cursor:pointer}@media print{.print-help{display:none}}.brand-mark{margin-top:16px;text-align:center;color:#b7b2c1;font-size:8.5px}
</style></head><body><div class="topline"></div>
<header class="header"><div class="brand">${profile.document_settings.show_logo !== false && profile.logo_url ? `<img src="${escapeHtml(profile.logo_url)}" alt="Logo">` : ""}<div><h1>${escapeHtml(profile.name)}</h1>${profile.legal_name && profile.legal_name !== profile.name ? `<p class="muted">${escapeHtml(profile.legal_name)}</p>` : ""}${profile.document_settings.show_tax_id !== false && profile.tax_id ? `<p>CUIT: ${escapeHtml(profile.tax_id)}</p>` : ""}${profile.document_settings.show_contact !== false && companyAddress(profile) ? `<p>${escapeHtml(companyAddress(profile))}</p>` : ""}${profile.document_settings.show_contact !== false && profile.phone ? `<p>${escapeHtml(profile.phone)}</p>` : ""}${profile.document_settings.show_contact !== false && profile.email ? `<p>${escapeHtml(profile.email)}</p>` : ""}</div></div><div class="doc-meta"><small>${escapeHtml(document.title)}</small><h2>${escapeHtml(document.number)}</h2>${document.kind === "quote" && profile.quote_header ? `<p class="muted">${escapeHtml(profile.quote_header)}</p>` : ""}<span class="status">${escapeHtml(statusLabel(document.status))}</span></div></header>
<section class="info"><div class="client"><h3>Cliente</h3><strong>${escapeHtml(clientIdentity(document.client))}</strong>${document.client.tax_id ? `<p>CUIT/DNI: ${escapeHtml(document.client.tax_id)}</p>` : ""}${document.client.address ? `<p>${escapeHtml(document.client.address)}</p>` : ""}${document.client.phone ? `<p>${escapeHtml(document.client.phone)}</p>` : ""}${document.client.email ? `<p>${escapeHtml(document.client.email)}</p>` : ""}</div><div><h3>Documento</h3><p>${escapeHtml(document.issueLabel)}: <b>${escapeHtml(date(profile,document.issueDate))}</b></p><p>${escapeHtml(document.secondaryLabel)}: <b>${escapeHtml(date(profile,document.secondaryDate))}</b></p></div></section>
<table><thead><tr><th>Descripción</th><th>Cant.</th><th>Precio unit.</th><th>Total</th></tr></thead><tbody>${document.items.map(item=>`<tr><td>${escapeHtml(item.description)}</td><td>${escapeHtml(new Intl.NumberFormat(profile.locale,{maximumFractionDigits:3}).format(item.quantity))}</td><td>${escapeHtml(money(profile,item.unit_price))}</td><td><b>${escapeHtml(money(profile,item.total))}</b></td></tr>`).join("")}</tbody></table>
<div class="totals"><div><span>Subtotal</span><b>${escapeHtml(money(profile,document.subtotal))}</b></div>${document.discount>0?`<div><span>Descuento</span><b>- ${escapeHtml(money(profile,document.discount))}</b></div>`:""}<div class="grand"><span>Total</span><span>${escapeHtml(money(profile,document.total))}</span></div>${document.kind==="order"&&document.paid!=null&&document.balance!=null?`<div><span>Pagado</span><b>${escapeHtml(money(profile,document.paid))}</b></div><div><span>Saldo</span><b>${escapeHtml(money(profile,document.balance))}</b></div>`:""}</div>
${document.notes?`<section class="block"><h3>Observaciones</h3><p>${escapeHtml(document.notes).replaceAll("\n","<br>")}</p></section>`:""}${paymentHtml}${termsHtml}${footer?`<footer class="footer">${escapeHtml(footer).replaceAll("\n","<br>")}</footer>`:""}<div class="brand-mark">Sistema de gestión creado por NEOLUZ Studio</div><button class="print-help" onclick="window.print()">Imprimir / Guardar PDF</button><script>window.addEventListener('load',()=>{const imgs=[...document.images];Promise.all(imgs.map(img=>img.complete?Promise.resolve():new Promise(r=>{img.onload=r;img.onerror=r}))).then(()=>setTimeout(()=>window.print(),150));});</script></body></html>`;
}

function openPrintWindow(profile: CompanyDocumentProfile, document: PrintableDocument) {
  const printWindow = window.open("", "_blank", "width=980,height=900");
  if (!printWindow) {
    throw new Error("El navegador bloqueó la ventana de impresión. Permití ventanas emergentes para GestArt.");
  }
  printWindow.document.open();
  printWindow.document.write(printableHtml(profile, document));
  printWindow.document.close();
}

export async function downloadQuotePdf(
  profile: CompanyDocumentProfile,
  detail: QuoteDetail,
  client: DocumentClient
) {
  await downloadBusinessDocument(profile, quotePrintable(detail, client));
}

export function printQuoteDocument(
  profile: CompanyDocumentProfile,
  detail: QuoteDetail,
  client: DocumentClient
) {
  openPrintWindow(profile, quotePrintable(detail, client));
}

export async function downloadOrderPdf(
  profile: CompanyDocumentProfile,
  detail: OrderDetail,
  client: DocumentClient
) {
  await downloadBusinessDocument(profile, orderPrintable(detail, client));
}

export function printOrderDocument(
  profile: CompanyDocumentProfile,
  detail: OrderDetail,
  client: DocumentClient
) {
  openPrintWindow(profile, orderPrintable(detail, client));
}

export async function downloadReportPdf(
  profile: CompanyDocumentProfile,
  data: ReportBundle,
  fromDate: string,
  toDate: string
) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const rgb = hexToRgb(profile.primary_color);
  const margin = 15;
  const width = doc.internal.pageSize.getWidth();
  const logo = profile.document_settings.show_logo !== false ? await imageData(profile.logo_url) : null;

  doc.setFillColor(rgb.r, rgb.g, rgb.b);
  doc.rect(0, 0, width, 7, "F");
  if (logo) {
    try {
      const logoBox = fitLogoBox(logo, 28, 16);
      doc.addImage(logo.dataUrl, logo.format, margin, 13 + logoBox.offsetY, logoBox.w, logoBox.h, undefined, "FAST");
    } catch { /* sin logo */ }
  }
  const brandX = logo ? 49 : margin;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(32,29,42);
  doc.text(profile.name, brandX, 19);
  doc.setFontSize(8);
  setTextColor(doc,100);
  doc.text("Reporte ejecutivo", brandX, 25);
  doc.setTextColor(rgb.r,rgb.g,rgb.b);
  doc.setFontSize(16);
  doc.text("REPORTE", width-margin, 18, {align:"right"});
  doc.setFontSize(8.5);
  setTextColor(doc,90);
  doc.text(`${date(profile,fromDate)} — ${date(profile,toDate)}`, width-margin, 25, {align:"right"});

  autoTable(doc, {
    startY: 38,
    margin: {left:margin,right:margin},
    head: [["Indicador","Valor"]],
    body: [
      ["Ventas", money(profile,data.overview.sales_total)],
      ["Cobros", money(profile,data.overview.collections_total)],
      ["Saldo pendiente", money(profile,data.overview.outstanding_total)],
      ["Pedidos", String(data.overview.orders_count)],
      ["Ticket promedio", money(profile,data.overview.average_ticket)],
      ["Clientes activos", String(data.overview.active_clients)],
      ["Ingresos de caja", money(profile,data.overview.cash_income)],
      ["Egresos de caja", money(profile,data.overview.cash_expense)],
      ["Neto de caja", money(profile,data.overview.cash_net)],
      ["Trabajos terminados", String(data.overview.completed_jobs)],
      ["Valor inventario", money(profile,data.overview.inventory_value)],
      ["Stock bajo", String(data.overview.low_stock_count)]
    ],
    theme:"striped",
    headStyles:{fillColor:[rgb.r,rgb.g,rgb.b],textColor:[255,255,255],fontSize:8},
    bodyStyles:{fontSize:8},
    columnStyles:{1:{halign:"right",fontStyle:"bold"}}
  });

  let y=(doc as jsPDF & {lastAutoTable?:{finalY:number}}).lastAutoTable?.finalY ?? 100;
  y+=10;
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(rgb.r,rgb.g,rgb.b); doc.text("Top clientes",margin,y);
  autoTable(doc,{
    startY:y+4,margin:{left:margin,right:margin},
    head:[["Cliente","Pedidos","Ventas","Cobrado","Pendiente"]],
    body:data.topClients.slice(0,8).map(row=>[row.client_name,String(row.orders_count),money(profile,row.sales_total),money(profile,row.paid_total),money(profile,row.outstanding_total)]),
    theme:"plain",headStyles:{fillColor:[245,243,249],textColor:[50,47,58],fontStyle:"bold",fontSize:7.5},bodyStyles:{fontSize:7.5},
    columnStyles:{1:{halign:"right"},2:{halign:"right"},3:{halign:"right"},4:{halign:"right"}}
  });

  y=(doc as jsPDF & {lastAutoTable?:{finalY:number}}).lastAutoTable?.finalY ?? y+30;
  if (y>230){doc.addPage();y=20}else y+=10;
  doc.setFont("helvetica","bold");doc.setFontSize(10);doc.setTextColor(rgb.r,rgb.g,rgb.b);doc.text("Inventario destacado",margin,y);
  autoTable(doc,{
    startY:y+4,margin:{left:margin,right:margin},
    head:[["Material","Stock","Valor","Consumo","Alerta"]],
    body:data.inventory.slice(0,10).map(row=>[row.name,`${new Intl.NumberFormat(profile.locale,{maximumFractionDigits:3}).format(row.current_stock)} ${row.unit}`,money(profile,row.inventory_value),money(profile,row.consumed_value),row.low_stock?"STOCK BAJO":"OK"]),
    theme:"plain",headStyles:{fillColor:[245,243,249],textColor:[50,47,58],fontStyle:"bold",fontSize:7.5},bodyStyles:{fontSize:7.5},
    columnStyles:{1:{halign:"right"},2:{halign:"right"},3:{halign:"right"},4:{halign:"center"}}
  });

  const pages=doc.getNumberOfPages();
  for(let page=1;page<=pages;page++){
    doc.setPage(page); doc.setFontSize(7); setTextColor(doc,145);
    doc.text(`${profile.name} · Reporte ${date(profile,fromDate)} — ${date(profile,toDate)}`,margin,290);
    doc.text(`Página ${page} de ${pages}`,width-margin,290,{align:"right"});
  }
  doc.save(`${profile.name.replace(/[^a-z0-9]+/gi,"-").toLowerCase()}-reporte-${fromDate}-${toDate}.pdf`);
}

export function printReport(
  profile: CompanyDocumentProfile,
  data: ReportBundle,
  fromDate: string,
  toDate: string
) {
  const rows = [
    ["Ventas", money(profile,data.overview.sales_total)],
    ["Cobros", money(profile,data.overview.collections_total)],
    ["Saldo pendiente", money(profile,data.overview.outstanding_total)],
    ["Pedidos", String(data.overview.orders_count)],
    ["Ticket promedio", money(profile,data.overview.average_ticket)],
    ["Ingresos caja", money(profile,data.overview.cash_income)],
    ["Egresos caja", money(profile,data.overview.cash_expense)],
    ["Neto caja", money(profile,data.overview.cash_net)],
    ["Valor inventario", money(profile,data.overview.inventory_value)]
  ];
  const rgb=hexToRgb(profile.primary_color);
  const win=window.open("","_blank","width=980,height=900");
  if(!win) throw new Error("El navegador bloqueó la ventana de impresión.");
  win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte GestArt</title><style>@page{size:A4;margin:15mm}body{font-family:Arial,sans-serif;color:#24212c}.head{display:flex;justify-content:space-between;border-bottom:4px solid rgb(${rgb.r},${rgb.g},${rgb.b});padding-bottom:14px}.head img{max-width:120px;max-height:60px}.head h1{margin:0;font-size:22px}.head h2{margin:0;color:rgb(${rgb.r},${rgb.g},${rgb.b});text-align:right}.muted{color:#777281;font-size:12px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:22px 0}.kpi{border:1px solid #e7e4ec;border-radius:8px;padding:12px}.kpi span{display:block;color:#777281;font-size:10px;text-transform:uppercase}.kpi strong{display:block;margin-top:5px;font-size:16px}table{width:100%;border-collapse:collapse;margin-top:20px}th{background:#f4f2f7;text-align:left;padding:8px}td{padding:8px;border-bottom:1px solid #e7e4ec}td:not(:first-child),th:not(:first-child){text-align:right}.print{position:fixed;right:12px;bottom:12px;background:#17151d;color:white;border:0;padding:10px 14px;border-radius:8px}@media print{.print{display:none}}.brand-mark{margin-top:20px;text-align:center;color:#b7b2c1;font-size:8.5px}</style></head><body><header class="head"><div>${profile.document_settings.show_logo !== false && profile.logo_url?`<img src="${escapeHtml(profile.logo_url)}">`:""}<h1>${escapeHtml(profile.name)}</h1><div class="muted">${escapeHtml(profile.document_settings.show_tax_id !== false && profile.tax_id?`CUIT ${profile.tax_id}`:"")}</div></div><div><h2>REPORTE</h2><div class="muted">${escapeHtml(date(profile,fromDate))} — ${escapeHtml(date(profile,toDate))}</div></div></header><div class="grid">${rows.map(([label,value])=>`<div class="kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div><h3>Top clientes</h3><table><thead><tr><th>Cliente</th><th>Pedidos</th><th>Ventas</th><th>Pendiente</th></tr></thead><tbody>${data.topClients.slice(0,10).map(row=>`<tr><td>${escapeHtml(row.client_name)}</td><td>${row.orders_count}</td><td>${escapeHtml(money(profile,row.sales_total))}</td><td>${escapeHtml(money(profile,row.outstanding_total))}</td></tr>`).join("")}</tbody></table><div class="brand-mark">Sistema de gestión creado por NEOLUZ Studio</div><button class="print" onclick="window.print()">Imprimir</button><script>window.addEventListener('load',()=>{const imgs=[...document.images];Promise.all(imgs.map(img=>img.complete?Promise.resolve():new Promise(r=>{img.onload=r;img.onerror=r}))).then(()=>setTimeout(()=>window.print(),150));});</script></body></html>`);
  win.document.close();
}
