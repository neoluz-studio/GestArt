"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { Icon } from "@/components/Icon";
import { useTenant } from "@/contexts/TenantContext";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { demoMode } from "@/lib/runtime";
import { company as demoCompany } from "@/lib/demo-data";
import { uploadCompanyLogo } from "@/services/documents";
import { NavigationSettings } from "@/features/settings/NavigationSettings";
import { SystemSettings } from "@/features/settings/SystemSettings";
import { SecuritySettings } from "@/features/settings/SecuritySettings";

type Section =
  | "Empresa"
  | "Apariencia"
  | "Navegación"
  | "Presupuestos"
  | "Pagos"
  | "Sistema"
  | "Seguridad";

const nav: Array<[Section | "Usuarios", Parameters<typeof Icon>[0]["name"]]> = [
  ["Empresa", "building"],
  ["Apariencia", "palette"],
  ["Navegación", "menu"],
  ["Presupuestos", "quote"],
  ["Pagos", "credit"],
  ["Usuarios", "users"],
  ["Sistema", "database"],
  ["Seguridad", "shield"]
];

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export default function ConfiguracionPage() {
  const { currentCompany, settings, reload } = useTenant();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [section, setSection] = useState<Section>("Empresa");
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [industry, setIndustry] = useState("otro");
  const [logoUrl, setLogoUrl] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");

  const [primary, setPrimary] = useState("#6d4aff");
  const [secondary, setSecondary] = useState("#17151d");
  const [accent, setAccent] = useState("#b9ff66");

  const [quoteTemplate, setQuoteTemplate] = useState("modern");
  const [quoteHeader, setQuoteHeader] = useState("");
  const [quoteFooter, setQuoteFooter] = useState("");
  const [orderFooter, setOrderFooter] = useState("");
  const [terms, setTerms] = useState("");

  const [bank, setBank] = useState("");
  const [holder, setHolder] = useState("");
  const [cbu, setCbu] = useState("");
  const [alias, setAlias] = useState("");
  const [account, setAccount] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");

  const [showLogo, setShowLogo] = useState(true);
  const [showTaxId, setShowTaxId] = useState(true);
  const [showContact, setShowContact] = useState(true);
  const [showPayment, setShowPayment] = useState(true);

  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const source = currentCompany;
    const payment =
      settings?.payment_information &&
      !Array.isArray(settings.payment_information) &&
      typeof settings.payment_information === "object"
        ? (settings.payment_information as Record<string, unknown>)
        : {};
    const documentSettings = settings?.document_settings ?? {};

    setName(source?.name ?? demoCompany.name);
    setLegalName(source?.legal_name ?? demoCompany.legalName);
    setTaxId(source?.tax_id ?? demoCompany.taxId);
    setIndustry(source?.industry ?? "grafica");
    setLogoUrl(settings?.logo_url ?? "");
    setPhone(settings?.phone ?? demoCompany.phone);
    setWhatsapp(settings?.whatsapp ?? "");
    setEmail(settings?.email ?? demoCompany.email);
    setWebsite(settings?.website ?? "");
    setAddress(settings?.address ?? "");
    setCity(settings?.city ?? "");
    setProvince(settings?.province ?? "");
    setPrimary(settings?.primary_color ?? "#6d4aff");
    setSecondary(settings?.secondary_color ?? "#17151d");
    setAccent(settings?.accent_color ?? "#b9ff66");
    setQuoteTemplate(settings?.quote_template ?? "modern");
    setQuoteHeader(settings?.quote_header ?? "");
    setQuoteFooter(settings?.quote_footer ?? "");
    setOrderFooter(settings?.order_footer ?? "");
    setTerms(settings?.terms_and_conditions ?? "");
    setBank(stringValue(payment.bank));
    setHolder(stringValue(payment.holder));
    setCbu(stringValue(payment.cbu));
    setAlias(stringValue(payment.alias));
    setAccount(stringValue(payment.account));
    setPaymentNotes(stringValue(payment.notes));
    setShowLogo(documentSettings.show_logo !== false);
    setShowTaxId(documentSettings.show_tax_id !== false);
    setShowContact(documentSettings.show_contact !== false);
    setShowPayment(documentSettings.show_payment_information !== false);
  }, [currentCompany, settings]);

  const addressPreview = useMemo(
    () => [address, city, province].filter(Boolean).join(", "),
    [address, city, province]
  );

  async function handleLogo(file?: File) {
    if (!file) return;
    setMessage(null);
    setError(null);

    if (demoMode) {
      setLogoUrl(URL.createObjectURL(file));
      setMessage("Logo cargado en modo demo.");
      return;
    }
    if (!supabaseBrowser || !currentCompany) return;

    setUploading(true);
    try {
      const publicUrl = await uploadCompanyLogo(
        supabaseBrowser,
        currentCompany.id,
        file
      );
      setLogoUrl(publicUrl);
      setMessage("Logo cargado. Guardá los cambios para aplicarlo a los documentos.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el logo.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (!name.trim()) {
      setError("El nombre comercial es obligatorio.");
      return;
    }

    if (demoMode) {
      setMessage("Cambios simulados en MODO DEMO.");
      return;
    }

    if (!supabaseBrowser || !currentCompany) return;

    setBusy(true);

    const { error: companyError } = await supabaseBrowser
      .from("companies")
      .update({
        name: name.trim(),
        legal_name: legalName.trim() || null,
        tax_id: taxId.trim() || null,
        industry
      })
      .eq("id", currentCompany.id);

    if (companyError) {
      setError(companyError.message);
      setBusy(false);
      return;
    }

    const { error: settingsError } = await supabaseBrowser
      .from("company_settings")
      .upsert({
        company_id: currentCompany.id,
        logo_url: logoUrl.trim() || null,
        phone: phone.trim() || null,
        whatsapp: whatsapp.trim() || null,
        email: email.trim() || null,
        website: website.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        province: province.trim() || null,
        primary_color: primary,
        secondary_color: secondary,
        accent_color: accent,
        quote_template: quoteTemplate,
        quote_header: quoteHeader.trim() || null,
        quote_footer: quoteFooter.trim() || null,
        order_footer: orderFooter.trim() || null,
        terms_and_conditions: terms.trim() || null,
        payment_information: {
          bank: bank.trim(),
          holder: holder.trim(),
          cbu: cbu.trim(),
          alias: alias.trim(),
          account: account.trim(),
          notes: paymentNotes.trim()
        },
        document_settings: {
          show_logo: showLogo,
          show_tax_id: showTaxId,
          show_contact: showContact,
          show_payment_information: showPayment
        }
      });

    if (settingsError) {
      setError(settingsError.message);
    } else {
      setMessage("Configuración guardada. Los próximos PDFs usarán estos datos.");
      await reload();
    }

    setBusy(false);
  };

  return (
    <>
      <Topbar eyebrow="Autogestión" title="Configuración" />

      <div className="page-content page-stack settings-page-stage12">
        <section className="module-intro settings-intro-stage12">
          <div className="module-copy">
            <span className="module-kicker">CONFIGURACIÓN POR EMPRESA</span>
            <h2>
              Hacé que GestArt se sienta <span>tuyo.</span>
            </h2>
            <p>
              Los datos de esta pantalla alimentan la interfaz y también tus
              presupuestos, pedidos e informes impresos.
            </p>
          </div>
        </section>

        <form className="settings-layout" onSubmit={save}>
          <aside className="gestart-card settings-nav">
            {nav.map((item) =>
              item[0] === "Usuarios" ? (
                <Link className="settings-nav-link" href="/usuarios" key={item[0]}>
                  <Icon name={item[1]} size={15} />
                  {item[0]}
                </Link>
              ) : (
                <button
                  key={item[0]}
                  type="button"
                  className={section === item[0] ? "active" : ""}
                  onClick={() => setSection(item[0] as Section)}
                >
                  <Icon name={item[1]} size={15} />
                  {item[0]}
                </button>
              )
            )}
          </aside>

          <article className="gestart-card settings-section settings-stage12-card">
            {section === "Empresa" && (
              <>
                <h3>Empresa e identidad</h3>
                <p>
                  Estos datos aparecen en el encabezado de presupuestos, pedidos
                  y reportes.
                </p>

                <div className="document-logo-editor">
                  <div className="document-logo-preview">
                    {logoUrl ? <img src={logoUrl} alt="Logo de la empresa" /> : <Icon name="building" size={28} />}
                  </div>
                  <div>
                    <strong>Logo principal</strong>
                    <span>PNG, JPG o WEBP · máximo 3 MB.</span>
                    <div className="document-logo-actions">
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        hidden
                        onChange={(event) => void handleLogo(event.target.files?.[0])}
                      />
                      <button
                        className="button modal-secondary"
                        type="button"
                        disabled={uploading}
                        onClick={() => fileRef.current?.click()}
                      >
                        {uploading ? "Subiendo..." : "Subir logo"}
                      </button>
                      {logoUrl && (
                        <button className="button settings-text-button" type="button" onClick={() => setLogoUrl("")}>
                          Quitar
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="settings-grid">
                  <div className="field"><label>Nombre comercial</label><input value={name} onChange={(event) => setName(event.target.value)} /></div>
                  <div className="field"><label>Razón social</label><input value={legalName} onChange={(event) => setLegalName(event.target.value)} /></div>
                  <div className="field"><label>CUIT / identificación fiscal</label><input value={taxId} onChange={(event) => setTaxId(event.target.value)} /></div>
                  <div className="field"><label>Tipo de empresa</label><select value={industry} onChange={(event) => setIndustry(event.target.value)}><option value="grafica">Gráfica</option><option value="transporte">Transporte</option><option value="servicios">Servicios</option><option value="construccion">Construcción</option><option value="comercio">Comercio</option><option value="industria">Industria</option><option value="otro">Otro</option></select></div>
                  <div className="field"><label>Teléfono</label><input value={phone} onChange={(event) => setPhone(event.target.value)} /></div>
                  <div className="field"><label>WhatsApp</label><input value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} /></div>
                  <div className="field"><label>Email</label><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
                  <div className="field"><label>Sitio web</label><input value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="www.miempresa.com" /></div>
                  <div className="field settings-full"><label>Dirección</label><input value={address} onChange={(event) => setAddress(event.target.value)} /></div>
                  <div className="field"><label>Ciudad</label><input value={city} onChange={(event) => setCity(event.target.value)} /></div>
                  <div className="field"><label>Provincia / Estado</label><input value={province} onChange={(event) => setProvince(event.target.value)} /></div>
                </div>
              </>
            )}

            {section === "Apariencia" && (
              <>
                <h3>Identidad visual</h3>
                <p>Los documentos toman el color principal de la empresa.</p>
                <div className="color-row">
                  <label className="color-control"><input className="inline-color-input" type="color" value={primary} onChange={(event) => setPrimary(event.target.value)} /><div><span>Principal</span><strong>{primary.toUpperCase()}</strong></div></label>
                  <label className="color-control"><input className="inline-color-input" type="color" value={secondary} onChange={(event) => setSecondary(event.target.value)} /><div><span>Secundario</span><strong>{secondary.toUpperCase()}</strong></div></label>
                  <label className="color-control"><input className="inline-color-input" type="color" value={accent} onChange={(event) => setAccent(event.target.value)} /><div><span>Acento</span><strong>{accent.toUpperCase()}</strong></div></label>
                </div>

                <h3 className="settings-subtitle">Información visible en documentos</h3>
                <div className="document-toggle-grid">
                  <label><input type="checkbox" checked={showLogo} onChange={(event) => setShowLogo(event.target.checked)} /><span><strong>Mostrar logo</strong><small>Encabezado de PDFs e impresión.</small></span></label>
                  <label><input type="checkbox" checked={showTaxId} onChange={(event) => setShowTaxId(event.target.checked)} /><span><strong>Mostrar CUIT</strong><small>Identificación fiscal de la empresa.</small></span></label>
                  <label><input type="checkbox" checked={showContact} onChange={(event) => setShowContact(event.target.checked)} /><span><strong>Mostrar contacto</strong><small>Dirección, teléfono, email y web.</small></span></label>
                  <label><input type="checkbox" checked={showPayment} onChange={(event) => setShowPayment(event.target.checked)} /><span><strong>Mostrar datos de pago</strong><small>Banco, CBU/CVU, alias y notas.</small></span></label>
                </div>
              </>
            )}

            {section === "Presupuestos" && (
              <>
                <h3>Presupuestos y documentos</h3>
                <p>Definí el contenido comercial que se imprime debajo de tu identidad.</p>
                <div className="settings-grid">
                  <div className="field"><label>Plantilla</label><select value={quoteTemplate} onChange={(event) => setQuoteTemplate(event.target.value)}><option value="modern">Moderna</option><option value="classic">Clásica</option><option value="minimal">Minimal</option></select></div>
                  <div className="field"><label>Vista de dirección</label><input value={addressPreview} readOnly placeholder="Completá Empresa → Dirección" /></div>
                  <div className="field settings-full"><label>Texto de encabezado</label><textarea rows={2} value={quoteHeader} onChange={(event) => setQuoteHeader(event.target.value)} placeholder="Ej.: Gracias por solicitar una cotización." /></div>
                  <div className="field settings-full"><label>Términos y condiciones</label><textarea rows={5} value={terms} onChange={(event) => setTerms(event.target.value)} placeholder="Validez, tiempos de producción, anticipo, condiciones de entrega..." /></div>
                  <div className="field settings-full"><label>Pie del presupuesto</label><textarea rows={3} value={quoteFooter} onChange={(event) => setQuoteFooter(event.target.value)} placeholder="Ej.: Gracias por confiar en nosotros." /></div>
                  <div className="field settings-full"><label>Pie del pedido</label><textarea rows={3} value={orderFooter} onChange={(event) => setOrderFooter(event.target.value)} placeholder="Indicaciones, retiro, entrega o mensaje final." /></div>
                </div>

                <div className="document-header-preview">
                  <span>VISTA PREVIA DEL ENCABEZADO</span>
                  <div>
                    <div className="document-preview-brand">
                      {showLogo && logoUrl ? <img src={logoUrl} alt="Logo" /> : <div className="document-preview-placeholder"><Icon name="building" size={18} /></div>}
                      <div><strong>{name || "Mi empresa"}</strong><small>{showTaxId && taxId ? `CUIT ${taxId}` : ""}</small><small>{showContact ? [phone, email].filter(Boolean).join(" · ") : ""}</small></div>
                    </div>
                    <div className="document-preview-title"><small>PRESUPUESTO</small><strong>P-0001</strong></div>
                  </div>
                </div>
              </>
            )}

            {section === "Pagos" && (
              <>
                <h3>Datos para cobrar</h3>
                <p>Se pueden incluir automáticamente en los PDFs de presupuestos y pedidos.</p>
                <div className="settings-grid">
                  <div className="field"><label>Banco / billetera</label><input value={bank} onChange={(event) => setBank(event.target.value)} /></div>
                  <div className="field"><label>Titular</label><input value={holder} onChange={(event) => setHolder(event.target.value)} /></div>
                  <div className="field"><label>CBU / CVU</label><input value={cbu} onChange={(event) => setCbu(event.target.value)} /></div>
                  <div className="field"><label>Alias</label><input value={alias} onChange={(event) => setAlias(event.target.value)} /></div>
                  <div className="field"><label>Número de cuenta</label><input value={account} onChange={(event) => setAccount(event.target.value)} /></div>
                  <div className="field settings-full"><label>Información adicional</label><textarea rows={4} value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} placeholder="Ej.: Enviar comprobante por WhatsApp. Se requiere 50% de anticipo." /></div>
                </div>
              </>
            )}

            {section === "Navegación" && <NavigationSettings />}

            {section === "Sistema" && <SystemSettings />}

            {section === "Seguridad" && <SecuritySettings />}

            {error ? <div className="form-message error">{error}</div> : null}
            {message ? <div className="form-message success">{message}</div> : null}

            {!(["Navegación", "Sistema", "Seguridad"] as Section[]).includes(section) && (
              <button className="button button-dark" disabled={busy || uploading} style={{ marginTop: 20 }}>
                {busy ? "Guardando..." : "Guardar cambios"}
              </button>
            )}
          </article>
        </form>
      </div>
    </>
  );
}
