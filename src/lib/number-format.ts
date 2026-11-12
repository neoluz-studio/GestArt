/**
 * Utilidades para campos numéricos con separador de miles mientras se escribe.
 *
 * "Valor crudo" (raw): texto canónico, con punto decimal y sin separadores
 * de miles. Es lo que guarda el estado de la app (por ejemplo "10000.5").
 * "Texto mostrado": el crudo con los separadores del idioma (10.000,5).
 */

export type Separators = { group: string; decimal: string };
export type NumberRules = { decimals: number; allowNegative: boolean };

const MAX_INTEGER_DIGITS = 12;

export function getSeparators(locale: string): Separators {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
    return {
      group: parts.find((p) => p.type === "group")?.value ?? ".",
      decimal: parts.find((p) => p.type === "decimal")?.value ?? ","
    };
  } catch {
    return { group: ".", decimal: "," };
  }
}

/** Número que representa un valor (acepta crudo, texto con coma o número). */
export function numericOf(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null || value === "") return 0;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Deja el crudo en forma canónica: "-" opcional, enteros, un punto y decimales limitados. */
export function sanitizeRaw(raw: string, rules: NumberRules): string {
  const negative = rules.allowNegative && raw.trimStart().startsWith("-");
  const body = raw.replace(/[^0-9.]/g, "");
  const firstDot = body.indexOf(".");

  let integer = firstDot < 0 ? body : body.slice(0, firstDot);
  let decimal: string | null = firstDot < 0 ? null : body.slice(firstDot + 1).replace(/\./g, "");

  if (rules.decimals <= 0) decimal = null;
  else if (decimal !== null) decimal = decimal.slice(0, rules.decimals);

  integer = integer.replace(/^0+(?=\d)/, "").slice(0, MAX_INTEGER_DIGITS);
  if (integer === "" && decimal !== null) integer = "0";

  return `${negative ? "-" : ""}${integer}${decimal !== null ? `.${decimal}` : ""}`;
}

/** Crudo -> texto con separadores (10000.5 -> "10.000,5"). */
export function formatRaw(raw: string, sep: Separators): string {
  if (raw === "" || raw === "-") return raw;
  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  const dot = body.indexOf(".");
  const integer = dot < 0 ? body : body.slice(0, dot);
  const decimal = dot < 0 ? null : body.slice(dot + 1);
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, sep.group);
  return `${negative ? "-" : ""}${grouped}${decimal !== null ? sep.decimal + decimal : ""}`;
}

/** Texto mostrado (con separadores propios) -> crudo sin sanear. */
function cleanDisplayed(text: string, sep: Separators): string {
  let out = text;
  if (sep.group) out = out.split(sep.group).join("");
  if (sep.decimal && sep.decimal !== ".") out = out.split(sep.decimal).join(".");
  return out.replace(/[^0-9.-]/g, "");
}

/** Interpreta un texto pegado, que puede venir de cualquier formato (1.234,56 / 1,234.56 / 10.000). */
export function parseLoose(text: string, sep: Separators): string {
  const t = text.replace(/[^0-9.,-]/g, "");
  const negative = t.startsWith("-");
  const body = t.replace(/-/g, "");
  const lastDot = body.lastIndexOf(".");
  const lastComma = body.lastIndexOf(",");

  let result: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalChar = lastDot > lastComma ? "." : ",";
    const groupChar = decimalChar === "." ? "," : ".";
    result = body.split(groupChar).join("").replace(decimalChar, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const char = lastDot >= 0 ? "." : ",";
    const count = body.split(char).length - 1;
    const after = body.length - body.lastIndexOf(char) - 1;
    const treatAsGroup = count > 1 || (char === sep.group && after === 3);
    result = treatAsGroup ? body.split(char).join("") : body.replace(char, ".");
  } else {
    result = body;
  }
  return (negative ? "-" : "") + result;
}

export type ChangeInfo = {
  text: string;
  caret: number;
  inputType?: string;
  data?: string | null;
};

/**
 * Qué escribió la persona: devuelve el valor crudo nuevo y cuántos caracteres
 * "significativos" (dígitos, coma decimal, signo) quedan a la izquierda del cursor,
 * para poder reponer el cursor luego de volver a dar formato.
 */
export function interpretChange(
  change: ChangeInfo,
  sep: Separators,
  rules: NumberRules
): { raw: string; sig: number } {
  const { text, caret, inputType, data } = change;

  // Se tocó una coma o un punto: se toma como separador decimal
  if (inputType === "insertText" && (data === "." || data === ",")) {
    const index = Math.max(caret - 1, 0);
    const left = cleanDisplayed(text.slice(0, index), sep);
    const right = cleanDisplayed(text.slice(index + 1), sep);
    const alreadyDecimal = (left + right).includes(".");
    if (rules.decimals <= 0 || alreadyDecimal) {
      return {
        raw: sanitizeRaw(left + right, rules),
        sig: sanitizeRaw(left, rules).length
      };
    }
    return {
      raw: sanitizeRaw(`${left}.${right}`, rules),
      sig: sanitizeRaw(`${left}.`, rules).length
    };
  }

  // Pegado: puede venir en cualquier formato
  if (inputType && /^insertFrom(Paste|Drop)/.test(inputType)) {
    const raw = sanitizeRaw(parseLoose(text, sep), rules);
    return { raw, sig: raw.length };
  }

  const raw = sanitizeRaw(cleanDisplayed(text, sep), rules);
  const sig = sanitizeRaw(cleanDisplayed(text.slice(0, caret), sep), rules).length;
  return { raw, sig: Math.min(sig, raw.length) };
}

/** Posición del cursor en el texto mostrado tras `sig` caracteres significativos. */
export function caretFromSig(display: string, sig: number, sep: Separators): number {
  if (sig <= 0) return display.startsWith("-") ? 1 : 0;
  let count = 0;
  for (let i = 0; i < display.length; i += 1) {
    const ch = display[i];
    if ((ch >= "0" && ch <= "9") || ch === sep.decimal || ch === "-") count += 1;
    if (count >= sig) return i + 1;
  }
  return display.length;
}
