"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser, isSupabaseConfigured } from "@/lib/supabase/browser";
import { demoMode } from "@/lib/runtime";
import { useAuth } from "@/contexts/AuthContext";

type Mode = "login" | "signup";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user && !demoMode) {
      router.replace(searchParams.get("next") || "/dashboard");
    }
  }, [user, loading, router, searchParams]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (demoMode) {
      router.push("/dashboard");
      return;
    }

    if (!supabaseBrowser || !isSupabaseConfigured) {
      setError("Falta configurar Supabase en .env.local.");
      return;
    }

    if (!email || !password) {
      setError("Completá email y contraseña.");
      return;
    }

    setBusy(true);

    if (mode === "login") {
      const { error: authError } =
        await supabaseBrowser.auth.signInWithPassword({
          email,
          password
        });

      if (authError) {
        setError(authError.message);
      } else {
        router.replace(searchParams.get("next") || "/dashboard");
      }
    } else {
      if (!fullName.trim()) {
        setError("Ingresá tu nombre.");
        setBusy(false);
        return;
      }

      const { data, error: signupError } = await supabaseBrowser.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName.trim() }
        }
      });

      if (signupError) {
        setError(signupError.message);
      } else if (data.session) {
        router.replace("/onboarding");
      } else {
        setMessage(
          "Cuenta creada. Revisá tu email para confirmar el acceso y luego iniciá sesión."
        );
        setMode("login");
      }
    }

    setBusy(false);
  };

  return (
    <div className="auth-page">
      <section className="auth-visual">
        <div className="auth-brand">
          <div className="brand-symbol">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>GestArt</strong>
            <span>Gestión inteligente</span>
          </div>
        </div>

        <div className="auth-copy">
          <h1>
            Tu negocio, <span>conectado.</span>
          </h1>
          <p>
            Una plataforma integral, visual y configurable para gestionar todo tu negocio desde un solo lugar.
          </p>
        </div>

        
      </section>

      <section className="auth-form-wrap">
        <form className="auth-card" onSubmit={submit}>
          <span className="module-kicker">
            {mode === "login" ? "BIENVENIDO" : "NUEVA CUENTA"}
          </span>

          <h2>{mode === "login" ? "Iniciar sesión" : "Crear cuenta"}</h2>
          <p>
            {mode === "login"
              ? "Accedé al espacio de trabajo de tu empresa."
              : "Creá tu usuario administrador y luego configurá tu empresa."}
          </p>

          {mode === "signup" ? (
            <div className="field">
              <label>Nombre y apellido</label>
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
              />
            </div>
          ) : null}

          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label>Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              minLength={6}
            />
          </div>

          {error ? <div className="form-message error">{error}</div> : null}
          {message ? <div className="form-message success">{message}</div> : null}

          <button className="auth-submit" disabled={busy} type="submit">
            {busy
              ? "PROCESANDO..."
              : mode === "login"
              ? "INGRESAR A GestArt"
              : "CREAR CUENTA"}
          </button>

          <button
            type="button"
            className="auth-secondary"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError(null);
              setMessage(null);
            }}
          >
            {mode === "login"
              ? "¿Primera vez? Crear cuenta"
              : "Ya tengo una cuenta"}
          </button>

          {demoMode ? (
            <div className="demo-note">
              MODO DEMO está activo. El botón ingresar abre el panel sin
              conectarse a Supabase. Cambiá NEXT_PUBLIC_DEMO_MODE=false para
              usar datos reales.
            </div>
          ) : null}
        </form>
      </section>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="auth-page">
      <section className="auth-visual">
        <div className="auth-brand">
          <div className="brand-symbol">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>GestArt</strong>
            <span>Plataforma de gestión multiempresa</span>
          </div>
        </div>

        <div className="auth-copy">
          <h1>
            Tu negocio, <span>conectado.</span>
          </h1>
          <p>Cargando acceso seguro...</p>
        </div>
      </section>

      <section className="auth-form-wrap">
        <div className="auth-card">
          <span className="module-kicker">GESTART</span>
          <h2>Cargando...</h2>
          <p>Preparando tu espacio de trabajo.</p>
        </div>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginContent />
    </Suspense>
  );
}
