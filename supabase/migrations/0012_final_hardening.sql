-- =============================================================
-- GestArt 1.0 — ETAPA 14
-- Hardening final + navegación configurable transaccional
-- Ejecutar después de 0011_documents_pdf_print.sql
-- =============================================================

-- -------------------------------------------------------------
-- Navegación por empresa
-- -------------------------------------------------------------

drop function if exists public.save_company_navigation(uuid,jsonb);

create or replace function public.save_company_navigation(
  p_company_id uuid,
  p_modules jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_module_id uuid;
  v_enabled boolean;
  v_label text;
  v_icon text;
  v_sort integer;
  v_is_core boolean;
begin
  if auth.uid() is null then
    raise exception 'Debés iniciar sesión';
  end if;

  if not public.has_company_permission(p_company_id, 'company.manage') then
    raise exception 'No tenés permiso para configurar la navegación';
  end if;

  if jsonb_typeof(p_modules) <> 'array' then
    raise exception 'Configuración de navegación inválida';
  end if;

  for v_item in select * from jsonb_array_elements(p_modules)
  loop
    v_module_id := nullif(v_item ->> 'module_id', '')::uuid;
    v_enabled := coalesce((v_item ->> 'enabled')::boolean, true);
    v_label := nullif(trim(coalesce(v_item ->> 'custom_label', '')), '');
    v_icon := nullif(trim(coalesce(v_item ->> 'custom_icon', '')), '');
    v_sort := greatest(coalesce((v_item ->> 'sort_order')::integer, 0), 0);

    select m.is_core
    into v_is_core
    from public.company_modules cm
    join public.modules m on m.id = cm.module_id
    where cm.company_id = p_company_id
      and cm.module_id = v_module_id;

    if not found then
      raise exception 'Módulo inválido para esta empresa';
    end if;

    if v_is_core then
      v_enabled := true;
    end if;

    update public.company_modules
    set
      enabled = v_enabled,
      custom_label = v_label,
      custom_icon = v_icon,
      sort_order = v_sort
    where company_id = p_company_id
      and module_id = v_module_id;
  end loop;
end;
$$;

grant execute on function public.save_company_navigation(uuid,jsonb)
to authenticated;

-- -------------------------------------------------------------
-- Auditoría append-only más estricta
-- -------------------------------------------------------------
-- En versiones anteriores dos escritores legítimos eran SECURITY INVOKER.
-- Los convertimos a SECURITY DEFINER antes de quitar INSERT directo al cliente.

alter function public.log_client_change()
security definer;

alter function public.record_stock_movement(
  uuid,uuid,text,numeric,text,numeric,uuid,uuid,text
)
security definer;

drop policy if exists activity_logs_internal_insert
on public.activity_logs;

drop policy if exists activity_logs_tenant_insert
on public.activity_logs;

revoke insert, update, delete
on public.activity_logs
from authenticated;

-- Las funciones/triggers internos SECURITY DEFINER conservan la capacidad
-- de registrar eventos, pero un cliente autenticado ya no puede falsificar
-- filas del historial mediante INSERT directo.

-- -------------------------------------------------------------
-- Índices finales de navegación / auditoría
-- -------------------------------------------------------------

create index if not exists company_modules_company_sort_idx
  on public.company_modules(company_id, sort_order);

create index if not exists activity_logs_company_created_final_idx
  on public.activity_logs(company_id, created_at desc);
