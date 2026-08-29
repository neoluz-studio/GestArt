import type { SupabaseClient } from "@supabase/supabase-js";

export type ProductionStage =
  | "pending"
  | "design"
  | "waiting_approval"
  | "production"
  | "finished"
  | "delivery";

export type ProductionJob = {
  job_id: string;
  order_id: string;
  order_number: number;
  client_id: string;
  client_name: string;
  first_item: string | null;
  item_count: number;
  priority: string;
  order_status: string;
  production_status: ProductionStage;
  delivery_date: string | null;
  responsible_user_id: string | null;
  responsible_name: string;
  notes: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  is_overdue: boolean;
};

export type ProductionMember = {
  user_id: string;
  full_name: string;
  role_name: string;
};

export async function listProductionBoard(
  supabase: SupabaseClient,
  companyId: string,
  filters: {
    search?: string;
    priority?: string;
    responsibleUserId?: string;
  } = {}
): Promise<ProductionJob[]> {
  const { data, error } = await supabase.rpc("get_production_board", {
    p_company_id: companyId,
    p_search: filters.search?.trim() || null,
    p_priority: filters.priority || null,
    p_responsible_user_id: filters.responsibleUserId || null
  });

  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    order_number: Number(row.order_number ?? 0),
    item_count: Number(row.item_count ?? 0),
    is_overdue: Boolean(row.is_overdue)
  })) as ProductionJob[];
}

export async function listProductionMembers(
  supabase: SupabaseClient,
  companyId: string
): Promise<ProductionMember[]> {
  const { data, error } = await supabase.rpc("get_production_members", {
    p_company_id: companyId
  });
  if (error) throw error;
  return (data ?? []) as ProductionMember[];
}

export async function moveProductionJob(
  supabase: SupabaseClient,
  companyId: string,
  jobId: string,
  stage: ProductionStage
) {
  const { error } = await supabase.rpc("move_production_job", {
    p_company_id: companyId,
    p_job_id: jobId,
    p_stage: stage
  });
  if (error) throw error;
}

export async function assignProductionJob(
  supabase: SupabaseClient,
  companyId: string,
  jobId: string,
  responsibleUserId: string | null
) {
  const { error } = await supabase.rpc("assign_production_job", {
    p_company_id: companyId,
    p_job_id: jobId,
    p_responsible_user_id: responsibleUserId
  });
  if (error) throw error;
}

export async function updateProductionNotes(
  supabase: SupabaseClient,
  companyId: string,
  jobId: string,
  notes: string
) {
  const { error } = await supabase.rpc("update_production_job_notes", {
    p_company_id: companyId,
    p_job_id: jobId,
    p_notes: notes
  });
  if (error) throw error;
}
