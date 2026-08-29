-- =============================================================
-- GestArt ETAPA 9
-- Historial + Auditoría General
-- Ejecutar después de 0007_cash_income_expenses_closures.sql
-- =============================================================

-- -------------------------------------------------------------
-- Permiso específico
-- -------------------------------------------------------------

insert into public.permissions(code, description)
values ('history.read', 'Consultar historial y auditoría de la empresa')
on conflict(code) do update
set description = excluded.description;

-- Administradores
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'history.read'
where r.code = 'admin'
   or lower(r.name) = 'administrador'
on conflict do nothing;

-- Administración
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'history.read'
where r.code = 'administration'
   or lower(r.name) = 'administración'
on conflict do nothing;

-- -------------------------------------------------------------
-- Índices
-- -------------------------------------------------------------

create index if not exists activity_logs_company_user_created_idx
  on public.activity_logs(company_id, user_id, created_at desc);

create index if not exists activity_logs_company_entity_created_idx
  on public.activity_logs(company_id, entity_type, created_at desc);

create index if not exists activity_logs_company_action_created_idx
  on public.activity_logs(company_id, action, created_at desc);

-- -------------------------------------------------------------
-- RLS: historial consultable pero no editable/borrable
-- -------------------------------------------------------------

drop policy if exists activity_logs_tenant_select on public.activity_logs;
drop policy if exists activity_logs_tenant_insert on public.activity_logs;
drop policy if exists activity_logs_tenant_update on public.activity_logs;
drop policy if exists activity_logs_tenant_delete on public.activity_logs;

drop policy if exists activity_logs_history_select on public.activity_logs;
create policy activity_logs_history_select
on public.activity_logs for select
using (
  public.has_company_permission(company_id, 'history.read')
  or public.has_company_permission(company_id, 'company.manage')
);

-- La inserción queda permitida para miembros de la empresa porque algunos
-- triggers históricos anteriores son SECURITY INVOKER.
-- UPDATE y DELETE no tienen política: la app no puede alterar auditoría.
drop policy if exists activity_logs_internal_insert on public.activity_logs;
create policy activity_logs_internal_insert
on public.activity_logs for insert
with check (public.is_company_member(company_id));

-- -------------------------------------------------------------
-- Overview de auditoría
-- -------------------------------------------------------------

drop function if exists public.get_audit_overview(uuid);

create or replace function public.get_audit_overview(p_company_id uuid)
returns table(
  events_today bigint,
  events_7d bigint,
  active_users_7d bigint,
  entity_types_7d bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timezone text;
  v_day_start timestamptz;
begin
  if not (
    public.has_company_permission(p_company_id, 'history.read')
    or public.has_company_permission(p_company_id, 'company.manage')
  ) then
    raise exception 'No tenés permiso para consultar el historial';
  end if;

  select coalesce(cs.timezone, 'America/Argentina/Buenos_Aires')
  into v_timezone
  from public.company_settings cs
  where cs.company_id = p_company_id;

  v_timezone := coalesce(v_timezone, 'America/Argentina/Buenos_Aires');
  v_day_start :=
    date_trunc('day', now() at time zone v_timezone)
    at time zone v_timezone;

  return query
  select
    count(*) filter (where al.created_at >= v_day_start),
    count(*) filter (where al.created_at >= now() - interval '7 days'),
    count(distinct al.user_id) filter (
      where al.created_at >= now() - interval '7 days'
        and al.user_id is not null
    ),
    count(distinct al.entity_type) filter (
      where al.created_at >= now() - interval '7 days'
        and al.entity_type is not null
    )
  from public.activity_logs al
  where al.company_id = p_company_id;
end;
$$;

grant execute on function public.get_audit_overview(uuid)
to authenticated;

-- -------------------------------------------------------------
-- Usuarios con actividad
-- -------------------------------------------------------------

drop function if exists public.get_audit_users(uuid);

create or replace function public.get_audit_users(p_company_id uuid)
returns table(
  user_id uuid,
  full_name text,
  email text,
  event_count bigint
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not (
    public.has_company_permission(p_company_id, 'history.read')
    or public.has_company_permission(p_company_id, 'company.manage')
  ) then
    raise exception 'No tenés permiso para consultar el historial';
  end if;

  return query
  select
    al.user_id,
    coalesce(
      nullif(trim(pr.full_name), ''),
      nullif(trim(au.raw_user_meta_data ->> 'full_name'), ''),
      split_part(au.email, '@', 1),
      'Usuario'
    ) as full_name,
    au.email::text,
    count(*)::bigint
  from public.activity_logs al
  left join public.profiles pr
    on pr.user_id = al.user_id
  left join auth.users au
    on au.id = al.user_id
  where al.company_id = p_company_id
    and al.user_id is not null
  group by
    al.user_id,
    pr.full_name,
    au.raw_user_meta_data,
    au.email
  order by count(*) desc, 2;
end;
$$;

grant execute on function public.get_audit_users(uuid)
to authenticated;

-- -------------------------------------------------------------
-- Tipos de entidad disponibles
-- -------------------------------------------------------------

drop function if exists public.get_audit_entity_types(uuid);

create or replace function public.get_audit_entity_types(p_company_id uuid)
returns table(entity_type text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_company_permission(p_company_id, 'history.read')
    or public.has_company_permission(p_company_id, 'company.manage')
  ) then
    raise exception 'No tenés permiso para consultar el historial';
  end if;

  return query
  select distinct al.entity_type
  from public.activity_logs al
  where al.company_id = p_company_id
    and nullif(trim(al.entity_type), '') is not null
  order by al.entity_type;
end;
$$;

grant execute on function public.get_audit_entity_types(uuid)
to authenticated;

-- -------------------------------------------------------------
-- Historial filtrable
-- -------------------------------------------------------------

drop function if exists public.get_activity_history(
  uuid,text,uuid,text,text,date,date,integer,integer
);

create or replace function public.get_activity_history(
  p_company_id uuid,
  p_search text default null,
  p_user_id uuid default null,
  p_entity_type text default null,
  p_action_group text default null,
  p_from_date date default null,
  p_to_date date default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table(
  id bigint,
  action text,
  entity_type text,
  entity_id text,
  description text,
  metadata jsonb,
  created_at timestamptz,
  user_id uuid,
  user_name text,
  user_email text
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not (
    public.has_company_permission(p_company_id, 'history.read')
    or public.has_company_permission(p_company_id, 'company.manage')
  ) then
    raise exception 'No tenés permiso para consultar el historial';
  end if;

  p_limit := greatest(1, least(coalesce(p_limit, 100), 500));
  p_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  select
    al.id,
    al.action,
    al.entity_type,
    al.entity_id,
    al.description,
    al.metadata,
    al.created_at,
    al.user_id,
    coalesce(
      nullif(trim(pr.full_name), ''),
      nullif(trim(au.raw_user_meta_data ->> 'full_name'), ''),
      split_part(au.email, '@', 1),
      case when al.user_id is null then 'Sistema' else 'Usuario' end
    ) as user_name,
    au.email::text as user_email
  from public.activity_logs al
  left join public.profiles pr
    on pr.user_id = al.user_id
  left join auth.users au
    on au.id = al.user_id
  where al.company_id = p_company_id
    and (p_user_id is null or al.user_id = p_user_id)
    and (
      nullif(trim(p_entity_type), '') is null
      or al.entity_type = trim(p_entity_type)
    )
    and (
      p_from_date is null
      or al.created_at >= p_from_date::timestamptz
    )
    and (
      p_to_date is null
      or al.created_at < (p_to_date + 1)::timestamptz
    )
    and (
      nullif(trim(p_search), '') is null
      or al.action ilike '%' || trim(p_search) || '%'
      or coalesce(al.entity_type, '') ilike '%' || trim(p_search) || '%'
      or coalesce(al.entity_id, '') ilike '%' || trim(p_search) || '%'
      or coalesce(al.description, '') ilike '%' || trim(p_search) || '%'
      or coalesce(pr.full_name, '') ilike '%' || trim(p_search) || '%'
      or coalesce(au.email, '') ilike '%' || trim(p_search) || '%'
      or al.metadata::text ilike '%' || trim(p_search) || '%'
    )
    and (
      nullif(trim(p_action_group), '') is null

      or (
        p_action_group = 'clients'
        and (
          al.action ilike '%client%'
          or coalesce(al.entity_type, '') ilike '%client%'
        )
      )

      or (
        p_action_group = 'orders'
        and (
          al.action ilike '%order%'
          or coalesce(al.entity_type, '') in ('order','orders')
        )
      )

      or (
        p_action_group = 'payments'
        and (
          al.action ilike '%payment%'
          or coalesce(al.entity_type, '') ilike '%payment%'
        )
      )

      or (
        p_action_group = 'production'
        and (
          al.action ilike '%production%'
          or coalesce(al.entity_type, '') ilike '%production%'
        )
      )

      or (
        p_action_group = 'inventory'
        and (
          al.action ilike '%stock%'
          or al.action ilike '%material%'
          or al.action ilike '%inventory%'
          or coalesce(al.entity_type, '') ilike '%material%'
          or coalesce(al.entity_type, '') ilike '%stock%'
        )
      )

      or (
        p_action_group = 'cash'
        and (
          al.action ilike '%cash%'
          or coalesce(al.entity_type, '') ilike '%cash%'
        )
      )

      or (
        p_action_group = 'security'
        and (
          al.action ilike '%membership%'
          or al.action ilike '%role%'
          or al.action ilike '%user%'
          or al.action ilike '%security%'
          or coalesce(al.entity_type, '') in ('company_membership','role','user')
        )
      )

      or (
        p_action_group = 'settings'
        and (
          al.action ilike '%settings%'
          or al.action ilike '%module%'
          or al.action ilike 'company.%'
          or coalesce(al.entity_type, '') in ('company','company_settings','company_module')
        )
      )
    )
  order by al.created_at desc, al.id desc
  limit p_limit
  offset p_offset;
end;
$$;

grant execute on function public.get_activity_history(
  uuid,text,uuid,text,text,date,date,integer,integer
) to authenticated;

-- -------------------------------------------------------------
-- Auditoría de configuración de empresa
-- -------------------------------------------------------------

create or replace function public.audit_company_settings_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed text[];
begin
  v_changed := array_remove(array[
    case when old.logo_url is distinct from new.logo_url then 'logo_url' end,
    case when old.sidebar_logo_url is distinct from new.sidebar_logo_url then 'sidebar_logo_url' end,
    case when old.phone is distinct from new.phone then 'phone' end,
    case when old.whatsapp is distinct from new.whatsapp then 'whatsapp' end,
    case when old.email is distinct from new.email then 'email' end,
    case when old.website is distinct from new.website then 'website' end,
    case when old.address is distinct from new.address then 'address' end,
    case when old.city is distinct from new.city then 'city' end,
    case when old.province is distinct from new.province then 'province' end,
    case when old.primary_color is distinct from new.primary_color then 'primary_color' end,
    case when old.secondary_color is distinct from new.secondary_color then 'secondary_color' end,
    case when old.accent_color is distinct from new.accent_color then 'accent_color' end,
    case when old.theme is distinct from new.theme then 'theme' end,
    case when old.currency is distinct from new.currency then 'currency' end,
    case when old.locale is distinct from new.locale then 'locale' end,
    case when old.timezone is distinct from new.timezone then 'timezone' end,
    case when old.quote_template is distinct from new.quote_template then 'quote_template' end,
    case when old.quote_footer is distinct from new.quote_footer then 'quote_footer' end,
    case when old.terms_and_conditions is distinct from new.terms_and_conditions then 'terms_and_conditions' end,
    case when old.payment_information is distinct from new.payment_information then 'payment_information' end,
    case when old.dashboard_options is distinct from new.dashboard_options then 'dashboard_options' end
  ], null);

  if coalesce(array_length(v_changed, 1), 0) > 0 then
    insert into public.activity_logs(
      company_id,
      user_id,
      action,
      entity_type,
      entity_id,
      description,
      metadata
    )
    values(
      new.company_id,
      auth.uid(),
      'company.settings.updated',
      'company_settings',
      new.company_id::text,
      'Configuración de empresa actualizada',
      jsonb_build_object('changed_fields', to_jsonb(v_changed))
    );
  end if;

  return new;
end;
$$;

drop trigger if exists company_settings_audit_update
on public.company_settings;

create trigger company_settings_audit_update
after update on public.company_settings
for each row
execute function public.audit_company_settings_change();

-- -------------------------------------------------------------
-- Auditoría de membresías / usuarios
-- -------------------------------------------------------------

create or replace function public.audit_membership_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_entity_id text;
  v_action text;
  v_description text;
  v_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    v_company_id := new.company_id;
    v_entity_id := new.id::text;
    v_action := 'company.membership.created';
    v_description := 'Usuario agregado a la empresa';
    v_metadata := jsonb_build_object(
      'member_user_id', new.user_id,
      'role_id', new.role_id,
      'status', new.status
    );

  elsif tg_op = 'DELETE' then
    v_company_id := old.company_id;
    v_entity_id := old.id::text;
    v_action := 'company.membership.deleted';
    v_description := 'Usuario eliminado de la empresa';
    v_metadata := jsonb_build_object(
      'member_user_id', old.user_id,
      'role_id', old.role_id,
      'status', old.status
    );

  else
    if old.role_id is not distinct from new.role_id
       and old.status is not distinct from new.status then
      return new;
    end if;

    v_company_id := new.company_id;
    v_entity_id := new.id::text;
    v_action := 'company.membership.updated';
    v_description := 'Acceso de usuario actualizado';
    v_metadata := jsonb_build_object(
      'member_user_id', new.user_id,
      'old_role_id', old.role_id,
      'new_role_id', new.role_id,
      'old_status', old.status,
      'new_status', new.status
    );
  end if;

  insert into public.activity_logs(
    company_id,
    user_id,
    action,
    entity_type,
    entity_id,
    description,
    metadata
  )
  values(
    v_company_id,
    auth.uid(),
    v_action,
    'company_membership',
    v_entity_id,
    v_description,
    v_metadata
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists company_memberships_audit_change
on public.company_memberships;

create trigger company_memberships_audit_change
after insert or update or delete on public.company_memberships
for each row
execute function public.audit_membership_change();

-- -------------------------------------------------------------
-- Auditoría del menú/módulos configurables
-- -------------------------------------------------------------

create or replace function public.audit_company_module_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_module_code text;
begin
  if old.enabled is not distinct from new.enabled
     and old.custom_label is not distinct from new.custom_label
     and old.custom_icon is not distinct from new.custom_icon
     and old.sort_order is not distinct from new.sort_order then
    return new;
  end if;

  select m.code
  into v_module_code
  from public.modules m
  where m.id = new.module_id;

  insert into public.activity_logs(
    company_id,
    user_id,
    action,
    entity_type,
    entity_id,
    description,
    metadata
  )
  values(
    new.company_id,
    auth.uid(),
    'company.module.updated',
    'company_module',
    new.module_id::text,
    'Navegación de empresa actualizada',
    jsonb_build_object(
      'module', v_module_code,
      'enabled', new.enabled,
      'custom_label', new.custom_label,
      'custom_icon', new.custom_icon,
      'sort_order', new.sort_order
    )
  );

  return new;
end;
$$;

drop trigger if exists company_modules_audit_update
on public.company_modules;

create trigger company_modules_audit_update
after update on public.company_modules
for each row
execute function public.audit_company_module_change();

-- -------------------------------------------------------------
-- Integridad: activity_logs no se modifica desde clientes autenticados
-- -------------------------------------------------------------

revoke update, delete on public.activity_logs from authenticated;

-- SELECT se resuelve por RLS / RPC.
-- INSERT permanece disponible para compatibilidad con triggers SECURITY INVOKER.
