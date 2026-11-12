"use client";

import {
  ChangeEvent,
  InputHTMLAttributes,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useTenant } from "@/contexts/TenantContext";
import {
  caretFromSig,
  formatRaw,
  getSeparators,
  interpretChange,
  numericOf,
  sanitizeRaw,
  type NumberRules
} from "@/lib/number-format";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "inputMode" | "min" | "max" | "step"
> & {
  /** Valor actual: número o texto (con punto decimal). Vacío = sin valor. */
  value: number | string | null | undefined;
  /**
   * Se llama al escribir. `raw` es el texto con punto decimal y sin separadores
   * (por ejemplo "10000.5"); `numeric` es el número ya convertido.
   */
  onValueChange: (raw: string, numeric: number) => void;
  /** Cantidad máxima de decimales (por defecto 2; usá 0 para enteros y 3 para cantidades). */
  decimals?: number;
  allowNegative?: boolean;
};

function toRaw(value: Props["value"], rules: NumberRules): string {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return sanitizeRaw(String(Number(value.toFixed(6))), { ...rules, decimals: 6 });
  }
  return sanitizeRaw(String(value).replace(",", "."), { ...rules, decimals: 6 });
}

/**
 * Input de números que formatea mientras se escribe: al tipear 10000 se ve 10.000,
 * la coma (o el punto) marca los decimales y el cursor no salta de lugar.
 */
export function NumberInput({
  value,
  onValueChange,
  decimals = 2,
  allowNegative = false,
  onBlur,
  ...rest
}: Props) {
  // Idioma de la empresa (separadores). Fuera del provider se usa es-AR.
  let locale = "es-AR";
  try {
    locale = useTenant().settings?.locale || "es-AR";
  } catch {
    // sin TenantProvider
  }

  const sep = useMemo(() => getSeparators(locale), [locale]);
  const rules = useMemo<NumberRules>(() => ({ decimals, allowNegative }), [decimals, allowNegative]);

  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [raw, setRaw] = useState(() => toRaw(value, rules));

  // Si el valor cambia desde afuera (reset, edición de otro registro), se sincroniza.
  useEffect(() => {
    setRaw((current) => (numericOf(current) === numericOf(value) ? current : toRaw(value, rules)));
  }, [value, rules]);

  const display = useMemo(() => formatRaw(raw, sep), [raw, sep]);

  const applyCaret = useCallback(() => {
    const el = inputRef.current;
    const position = pendingCaret.current;
    if (!el || position === null || document.activeElement !== el) return;
    el.setSelectionRange(position, position);
  }, []);

  useLayoutEffect(() => {
    applyCaret();
  }, [display, applyCaret]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const el = event.target;
    const native = event.nativeEvent as InputEvent;
    const result = interpretChange(
      {
        text: el.value,
        caret: el.selectionStart ?? el.value.length,
        inputType: native.inputType,
        data: native.data
      },
      sep,
      rules
    );

    const nextDisplay = formatRaw(result.raw, sep);
    pendingCaret.current = caretFromSig(nextDisplay, result.sig, sep);

    setRaw(result.raw);
    onValueChange(result.raw, numericOf(result.raw));

    // Si el texto mostrado no cambia, React no vuelve a renderizar: se repone el cursor igual.
    window.requestAnimationFrame(applyCaret);
  }

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode={decimals > 0 ? "decimal" : "numeric"}
      autoComplete="off"
      value={display}
      onChange={handleChange}
      onFocus={(event) => {
        if (raw === "0") event.currentTarget.select();
        rest.onFocus?.(event);
      }}
      onBlur={(event) => {
        // "10," al salir del campo queda "10"
        if (raw.endsWith(".")) setRaw(raw.slice(0, -1));
        onBlur?.(event);
      }}
    />
  );
}
