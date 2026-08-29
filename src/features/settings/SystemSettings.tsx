"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useTenant } from "@/contexts/TenantContext";
import { demoMode } from "@/lib/runtime";
import { supabaseBrowser } from "@/lib/supabase/browser";

const CURRENCIES = [
  ["ARS", "Peso argentino (ARS)"],
  ["USD", "Dólar estadounidense (USD)"],
  ["EUR", "Euro (EUR)"],
  ["UYU", "Peso uruguayo (UYU)"],
  ["CLP", "Peso chileno (CLP)"],
  ["MXN", "Peso mexicano (MXN)"],
  ["BRL", "Real brasileño (BRL)"]
];

const LOCALES = [
  ["es-AR", "Español · Argentina"],
  ["es-UY", "Español · Uruguay"],
  ["es-CL", "Español · Chile"],
  ["es-MX", "Español · México"],
  ["es-ES", "Español · España"]
];

const TIMEZONES = [
  ["America/Argentina/Buenos_Aires", "Argentina · Buenos Aires"],
  ["America/Montevideo", "Uruguay · Montevideo"],
  ["America/Santiago", "Chile · Santiago"],
  ["America/Mexico_City", "México · Ciudad de México"],
  ["America/Sao_Paulo", "Brasil · São Paulo"],
  ["Europe/Madrid", "España · Madrid"]
];

const COUNTRIES = [
  ["AR", "Argentina"],
  ["UY", "Uruguay"],
  ["CL", "Chile"],
  ["MX", "México"],
  ["BR", "Brasil"],
  ["ES", "España"],
  ["US", "Estados Unidos"]
];

export function SystemSettings() {
  const { currentCompany, settings, reload } = useTenant();
  const [country, setCountry] = useState("AR");
  const [currency, setCurrency] = useState("ARS");
  const [locale, setLocale] = useState("es-AR");
  const [timezone, setTimezone] = useState("America/Argentina/Buenos_Aires");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setCountry(currentCompany?.country || "AR");
    setCurrency(settings?.currency || "ARS");
    setLocale(settings?.locale || "es-AR");
    setTimezone(settings?.timezone || "America/Argentina/Buenos_Aires");
  }, [currentCompany, settings]);

  async function save() {
    setMessage("");
    setError("");

    if (demoMode) {
      setMessage("Configuración regional actualizada en modo demo.");
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;

    setBusy(true);
    try {
      const [{ error: companyError }, { error: settingsError }] = await Promise.all([
        supabaseBrowser
          .from("companies")
          .update({ country })
          .eq("id", currentCompany.id),
        supabaseBrowser
          .from("company_settings")
          .upsert({
            company_id: currentCompany.id,
            currency,
            locale,
            timezone
          })
      ]);

      if (companyError) throw companyError;
      if (settingsError) throw settingsError;

      await reload();
      setMessage("Configuración regional guardada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar Sistema.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3>Sistema y región</h3>
      <p>
        Estos valores se usan para monedas, fechas, horarios, reportes y documentos.
      </p>

      <div className="settings-grid">
        <div className="field">
          <label>País</label>
          <select value={country} onChange={(event) => setCountry(event.target.value)}>
            {COUNTRIES.map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Moneda</label>
          <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
            {CURRENCIES.map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Formato regional</label>
          <select value={locale} onChange={(event) => setLocale(event.target.value)}>
            {LOCALES.map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Zona horaria</label>
          <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
            {TIMEZONES.map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </div>

      </div>

      <div className="settings-system-note">
        <Icon name="calendar" size={17} />
        <div>
          <strong>Ejemplo de formato</strong>
          <span>
            {new Intl.NumberFormat(locale, {
              style: "currency",
              currency,
              maximumFractionDigits: 0
            }).format(125000)}
            {" · "}
            {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date())}
          </span>
        </div>
      </div>

      {error && <div className="form-message error">{error}</div>}
      {message && <div className="form-message success">{message}</div>}

      <button
        className="button button-dark"
        type="button"
        disabled={busy}
        onClick={() => void save()}
        style={{ marginTop: 18 }}
      >
        {busy ? "Guardando..." : "Guardar sistema"}
      </button>
    </>
  );
}
