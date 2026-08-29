"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { demoMode } from "@/lib/runtime";

const INDUSTRIES = [
  ["grafica", "Gráfica / imprenta"],
  ["transporte", "Transporte"],
  ["construccion", "Construcción"],
  ["servicios", "Servicios"],
  ["comercio", "Comercio"],
  ["industria", "Industria"],
  ["otro", "Otro"]
];

const MODULES = [
  ["clients", "Clientes", true],
  ["quotes", "Presupuestos", true],
  ["orders", "Pedidos", true],
  ["production", "Producción", false],
  ["materials", "Materiales", false],
  ["cash", "Caja y pagos", true],
  ["reports", "Reportes", true],
  ["history", "Historial", true]
] as const;

function makeSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { hasCompanies, reload } = useTenant();

  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [industry, setIndustry] = useState("grafica");
  const [primaryColor, setPrimaryColor] = useState("#6d4aff");
  const [selectedModules, setSelectedModules] = useState<string[]>(
    MODULES.filter((module) => module[2]).map((module) => module[0])
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (demoMode) {
      router.replace("/dashboard");
      return;
    }

    if (!authLoading && !user) router.replace("/login");
    if (!authLoading && user && hasCompanies) router.replace("/dashboard");
  }, [authLoading, user, hasCompanies, router]);

  const progress = useMemo(() => `${step} / 4`, [step]);

  const next = () => {
    setError(null);
    if (step === 1 && !name.trim()) {
      setError("Ingresá el nombre de la empresa.");
      return;
    }
    setStep((current) => Math.min(4, current + 1));
  };

  const back = () => {
    setError(null);
    setStep((current) => Math.max(1, current - 1));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!supabaseBrowser || !user) {
      setError("No hay una sesión válida.");
      return;
    }

    setBusy(true);

    const finalSlug = slug.trim() || makeSlug(name);

    const { data, error: rpcError } = await supabaseBrowser.rpc(
      "create_company_with_admin",
      {
        p_name: name.trim(),
        p_slug: finalSlug,
        p_industry: industry,
        p_primary_color: primaryColor,
        p_module_codes: selectedModules
      }
    );

    if (rpcError) {
      setError(rpcError.message);
      setBusy(false);
      return;
    }

    if (data) {
      window.sessionStorage.setItem("gestart_company_id", data as string);
    }

    await reload();
    router.replace("/dashboard");
    setBusy(false);
  };

  const toggleModule = (code: string) => {
    setSelectedModules((current) =>
      current.includes(code)
        ? current.filter((item) => item !== code)
        : [...current, code]
    );
  };

  return (
    <div className="onboarding-page">
      <section className="onboarding-shell">
        <header className="onboarding-header">
          <div className="auth-brand dark">
            <div className="brand-symbol">
              <span />
              <span />
              <span />
            </div>
            <div>
              <strong>GestArt</strong>
              <span>Configuración inicial</span>
            </div>
          </div>
          <span className="onboarding-progress">PASO {progress}</span>
        </header>

        <form className="onboarding-card" onSubmit={submit}>
          {step === 1 ? (
            <>
              <span className="module-kicker">EMPRESA</span>
              <h1>¿Cómo se llama tu negocio?</h1>
              <p>
                Este nombre será el espacio de trabajo principal dentro de
                GestArt.
              </p>
              <div className="settings-grid">
                <div className="field full">
                  <label>Nombre comercial</label>
                  <input
                    autoFocus
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setSlug(makeSlug(event.target.value));
                    }}
                    placeholder="Ej: Gráfica López"
                  />
                </div>
                <div className="field full">
                  <label>Identificador</label>
                  <input
                    value={slug}
                    onChange={(event) => setSlug(makeSlug(event.target.value))}
                    placeholder="grafica-lopez"
                  />
                </div>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <span className="module-kicker">RUBRO</span>
              <h1>Adaptá GestArt a tu actividad</h1>
              <p>
                Es sólo una configuración inicial. Después podés modificarla.
              </p>
              <div className="industry-grid">
                {INDUSTRIES.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`industry-option ${
                      industry === value ? "selected" : ""
                    }`}
                    onClick={() => setIndustry(value)}
                  >
                    <strong>{label}</strong>
                    <span>{value}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <span className="module-kicker">IDENTIDAD</span>
              <h1>Elegí tu color principal</h1>
              <p>
                GestArt aplicará este color por empresa. El diseño puede
                personalizarse luego desde Configuración.
              </p>
              <div className="color-picker-card">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(event) => setPrimaryColor(event.target.value)}
                />
                <div>
                  <strong>{primaryColor.toUpperCase()}</strong>
                  <span>Color principal de la empresa</span>
                </div>
              </div>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <span className="module-kicker">MÓDULOS</span>
              <h1>¿Qué querés usar?</h1>
              <p>
                Activá solamente lo necesario. Podrás cambiar nombres, orden e
                iconos más adelante.
              </p>
              <div className="module-choice-grid">
                {MODULES.map(([code, label]) => (
                  <label className="module-choice" key={code}>
                    <div>
                      <strong>{label}</strong>
                      <span>{code}</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={selectedModules.includes(code)}
                      onChange={() => toggleModule(code)}
                    />
                  </label>
                ))}
              </div>
            </>
          ) : null}

          {error ? <div className="form-message error">{error}</div> : null}

          <footer className="onboarding-actions">
            {step > 1 ? (
              <button className="button secondary-button" type="button" onClick={back}>
                Atrás
              </button>
            ) : (
              <span />
            )}

            {step < 4 ? (
              <button className="button button-dark" type="button" onClick={next}>
                Continuar
              </button>
            ) : (
              <button className="button button-dark" disabled={busy} type="submit">
                {busy ? "Creando empresa..." : "Crear espacio de trabajo"}
              </button>
            )}
          </footer>
        </form>
      </section>
    </div>
  );
}
