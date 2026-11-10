export function makeMoney(locale: string, currency: string) {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  });
  return (value: number) => formatter.format(value || 0);
}

export function makeQuantity(locale: string) {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  return (value: number) => formatter.format(value || 0);
}

export function makeDateTime(locale: string) {
  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short"
  });
  return (value: string) => formatter.format(new Date(value));
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Error inesperado.");
  }
  return "Ocurrió un error inesperado.";
}

/** YYYY-MM-DD de la fecha local (no UTC). */
export function toLocalISODate(date: Date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseNumber(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
