import { createClient } from "@supabase/supabase-js";

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) return jsonError("Sesión requerida.", 401);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !publicKey || !serviceKey) {
    return jsonError("Supabase no está configurado en el servidor.", 500);
  }

  const body = await request.json();
  const {
    companyId,
    roleId,
    email,
    fullName
  }: {
    companyId?: string;
    roleId?: string;
    email?: string;
    fullName?: string;
  } = body;

  if (!companyId || !roleId || !email) {
    return jsonError("companyId, roleId y email son obligatorios.");
  }

  const userClient = createClient(url, publicKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const {
    data: { user },
    error: userError
  } = await userClient.auth.getUser(token);

  if (userError || !user) return jsonError("Sesión inválida.", 401);

  const { data: allowed, error: permissionError } = await userClient.rpc(
    "has_company_permission",
    {
      target_company_id: companyId,
      permission_code: "users.manage"
    }
  );

  if (permissionError || !allowed) {
    return jsonError("No tenés permiso para administrar usuarios.", 403);
  }

  const service = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const { data: role } = await service
    .from("roles")
    .select("id")
    .eq("id", roleId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!role) return jsonError("El rol no pertenece a esta empresa.");

  const { data: invite, error: inviteError } =
    await service.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: fullName?.trim() || email.split("@")[0]
      }
    });

  if (inviteError || !invite.user) {
    return jsonError(inviteError?.message || "No se pudo crear el usuario.");
  }

  const { error: membershipError } = await service
    .from("company_memberships")
    .upsert(
      {
        company_id: companyId,
        user_id: invite.user.id,
        role_id: roleId,
        status: "active"
      },
      {
        onConflict: "company_id,user_id"
      }
    );

  if (membershipError) return jsonError(membershipError.message);

  return Response.json({
    ok: true,
    userId: invite.user.id
  });
}
