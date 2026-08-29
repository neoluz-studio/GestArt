"use client";

import { FormEvent, useState } from "react";
import { Icon } from "@/components/Icon";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { demoMode } from "@/lib/runtime";
import { supabaseBrowser } from "@/lib/supabase/browser";

export function SecuritySettings() {
  const { user } = useAuth();
  const { currentCompany, currentRole } = useTenant();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    if (demoMode) {
      setPassword("");
      setConfirm("");
      setMessage("Cambio simulado en modo demo.");
      return;
    }
    if (!supabaseBrowser) return;

    setBusy(true);
    try {
      const { error: updateError } = await supabaseBrowser.auth.updateUser({
        password
      });
      if (updateError) throw updateError;
      setPassword("");
      setConfirm("");
      setMessage("Contraseña actualizada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar la contraseña.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3>Seguridad</h3>
      <p>
        La separación entre empresas se realiza en PostgreSQL mediante RLS,
        membresías y permisos por rol.
      </p>

      <div className="security-status-grid">
        <div>
          <span className="security-status-icon"><Icon name="shield" size={18} /></span>
          <span>
            <strong>Sesión autenticada</strong>
            <small>{user?.email || "Usuario demo"}</small>
          </span>
        </div>
        <div>
          <span className="security-status-icon"><Icon name="building" size={18} /></span>
          <span>
            <strong>Empresa activa</strong>
            <small>{currentCompany?.name || "Demo"}</small>
          </span>
        </div>
        <div>
          <span className="security-status-icon"><Icon name="users" size={18} /></span>
          <span>
            <strong>Rol</strong>
            <small>{currentRole || "Administrador"}</small>
          </span>
        </div>
      </div>

      <form className="security-password-card" onSubmit={changePassword}>
        <div>
          <strong>Cambiar mi contraseña</strong>
          <span>La nueva contraseña debe tener al menos 8 caracteres.</span>
        </div>

        <div className="settings-grid">
          <div className="field">
            <label>Nueva contraseña</label>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="field">
            <label>Repetir contraseña</label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>
        </div>

        {error && <div className="form-message error">{error}</div>}
        {message && <div className="form-message success">{message}</div>}

        <button className="button button-dark" disabled={busy}>
          {busy ? "Actualizando..." : "Actualizar contraseña"}
        </button>
      </form>

      <div className="security-rls-note">
        <Icon name="database" size={18} />
        <div>
          <strong>Protección multiempresa</strong>
          <p>
            GestArt no depende solamente de filtros de interfaz: las tablas
            operativas usan políticas RLS por `company_id`.
          </p>
        </div>
      </div>
    </>
  );
}
