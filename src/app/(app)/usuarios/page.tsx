"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { Icon } from "@/components/Icon";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { demoMode } from "@/lib/runtime";

type Role = { id: string; name: string };
type Member = {
  id: string;
  user_id: string;
  role_id: string | null;
  status: string;
  roles: Role | null;
};
type Profile = { user_id: string; full_name: string | null };

const DEMO_MEMBERS = [
  { name: "Administrador Demo", email: "admin@gestart.local", role: "Administrador", status: "Activo" },
  { name: "María Ventas", email: "ventas@gestart.local", role: "Ventas", status: "Activo" },
  { name: "Tomás Producción", email: "produccion@gestart.local", role: "Producción", status: "Activo" }
];

export default function UsuariosPage() {
  const { session } = useAuth();
  const { currentCompany } = useTenant();

  const [roles, setRoles] = useState<Role[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (demoMode || !supabaseBrowser || !currentCompany) return;

    const [{ data: roleData }, { data: memberData }] = await Promise.all([
      supabaseBrowser
        .from("roles")
        .select("id,name")
        .eq("company_id", currentCompany.id)
        .order("name"),
      supabaseBrowser
        .from("company_memberships")
        .select("id,user_id,role_id,status,roles(id,name)")
        .eq("company_id", currentCompany.id)
        .order("status")
    ]);

    const nextRoles = (roleData ?? []) as Role[];
    const nextMembers = (memberData ?? []) as unknown as Member[];
    setRoles(nextRoles);
    setMembers(nextMembers);
    if (!roleId && nextRoles[0]) setRoleId(nextRoles[0].id);

    const userIds = nextMembers.map((item) => item.user_id);
    if (userIds.length) {
      const { data: profileData } = await supabaseBrowser
        .from("profiles")
        .select("user_id,full_name")
        .in("user_id", userIds);
      setProfiles((profileData ?? []) as Profile[]);
    } else {
      setProfiles([]);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id]);

  const profileMap = useMemo(
    () => new Map(profiles.map((profile) => [profile.user_id, profile])),
    [profiles]
  );

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (demoMode) {
      setMessage("En MODO DEMO la invitación no se envía.");
      return;
    }

    if (!session?.access_token || !currentCompany || !roleId) {
      setError("Faltan datos para invitar al usuario.");
      return;
    }

    setBusy(true);

    const response = await fetch("/api/users/invite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        companyId: currentCompany.id,
        roleId,
        email,
        fullName
      })
    });

    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error || "No se pudo enviar la invitación.");
    } else {
      setMessage("Invitación creada correctamente.");
      setEmail("");
      setFullName("");
      await load();
    }

    setBusy(false);
  };

  const createRole = async () => {
    setError(null);
    setMessage(null);

    if (demoMode) {
      setMessage("En MODO DEMO los roles no se guardan.");
      return;
    }

    if (!supabaseBrowser || !currentCompany || !newRoleName.trim()) return;

    setBusy(true);
    const { error: rpcError } = await supabaseBrowser.rpc("create_company_role", {
      p_company_id: currentCompany.id,
      p_name: newRoleName.trim(),
      p_permission_codes: [
        "clients.read",
        "orders.read",
        "quotes.read"
      ]
    });

    if (rpcError) setError(rpcError.message);
    else {
      setMessage("Rol creado.");
      setNewRoleName("");
      await load();
    }
    setBusy(false);
  };

  return (
    <>
      <Topbar eyebrow="Administración" title="Usuarios y roles" />

      <div className="page-content page-stack">
        <section className="module-intro">
          <div className="module-copy">
            <span className="module-kicker">ACCESOS POR EMPRESA</span>
            <h2>
              Cada persona ve <span>solamente lo permitido.</span>
            </h2>
            <p>
              Las membresías, roles y permisos pertenecen al tenant actual y no
              se comparten con otras empresas.
            </p>
          </div>
        </section>

        <section className="users-grid">
          <article className="gestart-card">
            <div className="gestart-card-body">
              <div className="gestart-card-title">
                <div>
                  <h3>Invitar usuario</h3>
                  <p>El usuario recibirá una invitación de Supabase Auth.</p>
                </div>
                <Icon name="users" size={18} />
              </div>

              <form onSubmit={invite}>
                <div className="field">
                  <label>Nombre</label>
                  <input
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Nombre y apellido"
                  />
                </div>

                <div className="field" style={{ marginTop: 12 }}>
                  <label>Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="persona@empresa.com"
                  />
                </div>

                <div className="field" style={{ marginTop: 12 }}>
                  <label>Rol</label>
                  <select
                    value={roleId}
                    onChange={(event) => setRoleId(event.target.value)}
                  >
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </div>

                <button className="button button-dark" disabled={busy} style={{ marginTop: 16 }}>
                  {busy ? "Procesando..." : "Enviar invitación"}
                </button>
              </form>
            </div>
          </article>

          <article className="gestart-card">
            <div className="gestart-card-body">
              <div className="gestart-card-title">
                <div>
                  <h3>Crear rol</h3>
                  <p>Base inicial de permisos editable luego.</p>
                </div>
                <Icon name="shield" size={18} />
              </div>

              <div className="field">
                <label>Nombre del rol</label>
                <input
                  value={newRoleName}
                  onChange={(event) => setNewRoleName(event.target.value)}
                  placeholder="Ej: Ventas"
                />
              </div>

              <div className="permission-preview">
                <span>Permisos iniciales</span>
                <strong>Clientes: ver · Pedidos: ver · Presupuestos: ver</strong>
              </div>

              <button
                className="button secondary-button"
                type="button"
                disabled={busy}
                onClick={createRole}
              >
                Crear rol
              </button>
            </div>
          </article>
        </section>

        {error ? <div className="form-message error">{error}</div> : null}
        {message ? <div className="form-message success">{message}</div> : null}

        <section className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Empresa</th>
              </tr>
            </thead>
            <tbody>
              {demoMode
                ? DEMO_MEMBERS.map((member) => (
                    <tr key={member.email}>
                      <td>
                        <strong>{member.name}</strong>
                        <div>{member.email}</div>
                      </td>
                      <td>{member.role}</td>
                      <td>
                        <span className="status-pill status-green">
                          {member.status}
                        </span>
                      </td>
                      <td>{currentCompany?.name}</td>
                    </tr>
                  ))
                : members.map((member) => {
                    const profile = profileMap.get(member.user_id);
                    return (
                      <tr key={member.id}>
                        <td>
                          <strong>{profile?.full_name || "Usuario"}</strong>
                          <div className="code-muted">{member.user_id}</div>
                        </td>
                        <td>{member.roles?.name ?? "Sin rol"}</td>
                        <td>
                          <span
                            className={`status-pill ${
                              member.status === "active"
                                ? "status-green"
                                : "status-orange"
                            }`}
                          >
                            {member.status}
                          </span>
                        </td>
                        <td>{currentCompany?.name}</td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
