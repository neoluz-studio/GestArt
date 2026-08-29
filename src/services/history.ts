import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditOverview = {
  events_today: number;
  events_7d: number;
  active_users_7d: number;
  entity_types_7d: number;
};

export type AuditUser = {
  user_id: string;
  full_name: string;
  email: string | null;
  event_count: number;
};

export type AuditEvent = {
  id: number;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  user_id: string | null;
  user_name: string;
  user_email: string | null;
};

export type AuditFilters = {
  search?: string;
  userId?: string;
  entityType?: string;
  actionGroup?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
};

export async function getAuditOverview(
  supabase: SupabaseClient,
  companyId: string
): Promise<AuditOverview> {
  const { data, error } = await supabase.rpc("get_audit_overview", {
    p_company_id: companyId
  });
  if (error) throw error;

  const row = data?.[0] ?? {};
  return {
    events_today: Number(row.events_today ?? 0),
    events_7d: Number(row.events_7d ?? 0),
    active_users_7d: Number(row.active_users_7d ?? 0),
    entity_types_7d: Number(row.entity_types_7d ?? 0)
  };
}

export async function listAuditUsers(
  supabase: SupabaseClient,
  companyId: string
): Promise<AuditUser[]> {
  const { data, error } = await supabase.rpc("get_audit_users", {
    p_company_id: companyId
  });
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    user_id: String(row.user_id ?? ""),
    full_name: String(row.full_name ?? "Usuario"),
    email: row.email == null ? null : String(row.email),
    event_count: Number(row.event_count ?? 0)
  }));
}

export async function listAuditEntityTypes(
  supabase: SupabaseClient,
  companyId: string
): Promise<string[]> {
  const { data, error } = await supabase.rpc("get_audit_entity_types", {
    p_company_id: companyId
  });
  if (error) throw error;
  return (data ?? []).map((row: { entity_type?: string }) => row.entity_type).filter(Boolean) as string[];
}

export async function listAuditEvents(
  supabase: SupabaseClient,
  companyId: string,
  filters: AuditFilters = {}
): Promise<AuditEvent[]> {
  const { data, error } = await supabase.rpc("get_activity_history", {
    p_company_id: companyId,
    p_search: filters.search?.trim() || null,
    p_user_id: filters.userId || null,
    p_entity_type: filters.entityType || null,
    p_action_group: filters.actionGroup || null,
    p_from_date: filters.fromDate || null,
    p_to_date: filters.toDate || null,
    p_limit: filters.limit ?? 100,
    p_offset: filters.offset ?? 0
  });
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: Number(row.id),
    action: String(row.action ?? ""),
    entity_type: row.entity_type == null ? null : String(row.entity_type),
    entity_id: row.entity_id == null ? null : String(row.entity_id),
    description: row.description == null ? null : String(row.description),
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {},
    created_at: String(row.created_at),
    user_id: row.user_id == null ? null : String(row.user_id),
    user_name: String(row.user_name ?? "Sistema"),
    user_email: row.user_email == null ? null : String(row.user_email)
  }));
}
