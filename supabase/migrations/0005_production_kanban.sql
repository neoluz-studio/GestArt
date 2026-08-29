-- GestArt ETAPA 6
-- Producción Kanban real, responsables, estados y auditoría por tenant.

-- -------------------------------------------------------------
-- Permisos
-- -------------------------------------------------------------
insert into public.permissions(code, description) values
  ('production.read', 'Ver producción'),
  ('production.write', 'Modificar producción')
on conflict(code) do update set description = excluded.description;

-- Si la empresa ya existía antes de esta migración, el rol Administrador
-- recibe automáticamente los permisos de producción.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('production.read','production.write')
where r.code = 'admin' or lower(r.name) = 'administrador'
on conflict do nothing;

-- Rol inicial de Producción para empresas existentes.
insert into public.roles(company_id, name, code)
select c.id, 'Producción', 'production'
from public.companies c
where not exists (
  select 1 from public.roles r
  where r.company_id = c.id
    and (r.code = 'production' or lower(r.name) = 'producción')
);

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in (
  'orders.read','clients.read','production.read','production.write','inventory.read'
)
where r.code = 'production'
on conflict do nothing;

-- Y para empresas que se creen después de esta migración.
create or replace function public.ensure_default_production_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_id uuid;
begin
  insert into public.roles(company_id, name, code)
  values (new.id, 'Producción', 'production')
  returning id into v_role_id;

  insert into public.role_permissions(role_id, permission_id)
  select v_role_id, p.id
  from public.permissions p
  where p.code in ('orders.read','clients.read','production.read','production.write','inventory.read')
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists companies_default_production_role on public.companies;
create trigger companies_default_production_role
after insert on public.companies
for each row execute function public.ensure_default_production_role();

-- -------------------------------------------------------------
-- Ampliación del trabajo de producción
-- -------------------------------------------------------------
alter table public.production_jobs
  add column if not exists notes text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Eliminamos duplicados heredados antes de aplicar la unicidad por pedido.
delete from public.production_jobs a
using public.production_jobs b
where a.company_id = b.company_id
  and a.order_id = b.order_id
  and a.id > b.id;

create unique index if not exists production_jobs_company_order_uidx
  on public.production_jobs(company_id, order_id);

create index if not exists production_jobs_company_status_idx
  on public.production_jobs(company_id, status, sort_order, updated_at desc);

create index if not exists production_jobs_responsible_idx
  on public.production_jobs(company_id, responsible_user_id);

-- -------------------------------------------------------------
-- RLS endurecido por permiso
-- -------------------------------------------------------------
drop policy if exists production_jobs_tenant_select on public.production_jobs;
drop policy if exists production_jobs_tenant_insert on public.production_jobs;
drop policy if exists production_jobs_tenant_update on public.production_jobs;
drop policy if exists production_jobs_tenant_delete on public.production_jobs;

drop policy if exists production_jobs_permission_select on public.production_jobs;
create policy production_jobs_permission_select
on public.production_jobs for select
using (
  public.has_company_permission(company_id,'production.read')
  or public.has_company_permission(company_id,'production.write')
);

drop policy if exists production_jobs_permission_insert on public.production_jobs;
create policy production_jobs_permission_insert
on public.production_jobs for insert
with check (public.has_company_permission(company_id,'production.write'));

drop policy if exists production_jobs_permission_update on public.production_jobs;
create policy production_jobs_permission_update
on public.production_jobs for update
using (public.has_company_permission(company_id,'production.write'))
with check (public.has_company_permission(company_id,'production.write'));

drop policy if exists production_jobs_permission_delete on public.production_jobs;
create policy production_jobs_permission_delete
on public.production_jobs for delete
using (public.has_company_permission(company_id,'production.write'));

-- -------------------------------------------------------------
-- Mapeo entre estados del pedido y columnas de producción
-- -------------------------------------------------------------
create or replace function public.production_stage_from_order_status(p_status text)
returns text
language sql
immutable
as $$
  select case lower(coalesce(p_status,''))
    when 'design' then 'design'
    when 'waiting_approval' then 'waiting_approval'
    when 'in_production' then 'production'
    when 'ready' then 'finished'
    when 'pending_delivery' then 'delivery'
    when 'delivered' then 'delivery'
    else 'pending'
  end;
$$;

create or replace function public.order_status_from_production_stage(p_stage text)
returns text
language sql
immutable
as $$
  select case lower(coalesce(p_stage,''))
    when 'pending' then 'pending_production'
    when 'design' then 'design'
    when 'waiting_approval' then 'waiting_approval'
    when 'production' then 'in_production'
    when 'finished' then 'ready'
    when 'delivery' then 'pending_delivery'
    else 'pending_production'
  end;
$$;

-- -------------------------------------------------------------
-- Sincronización automática Pedido -> Producción
-- -------------------------------------------------------------
create or replace function public.sync_order_production_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage text;
begin
  if new.status in ('budget','pending_payment','cancelled') then
    delete from public.production_jobs
    where company_id = new.company_id and order_id = new.id;
    return new;
  end if;

  v_stage := public.production_stage_from_order_status(new.status);

  insert into public.production_jobs(
    company_id, order_id, status, started_at, completed_at, created_at, updated_at
  )
  values(
    new.company_id,
    new.id,
    v_stage,
    case when v_stage = 'production' then now() else null end,
    case when v_stage in ('finished','delivery') then now() else null end,
    now(),
    now()
  )
  on conflict(company_id, order_id) do update
  set status = excluded.status,
      started_at = case
        when excluded.status = 'production' then coalesce(public.production_jobs.started_at, now())
        else public.production_jobs.started_at
      end,
      completed_at = case
        when excluded.status in ('finished','delivery') then coalesce(public.production_jobs.completed_at, now())
        when excluded.status in ('pending','design','waiting_approval','production') then null
        else public.production_jobs.completed_at
      end,
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists orders_sync_production_job on public.orders;
create trigger orders_sync_production_job
after insert or update of status on public.orders
for each row execute function public.sync_order_production_job();

-- Backfill para pedidos existentes.
insert into public.production_jobs(
  company_id, order_id, status, started_at, completed_at, created_at, updated_at
)
select
  o.company_id,
  o.id,
  public.production_stage_from_order_status(o.status),
  case when o.status = 'in_production' then coalesce(o.updated_at, now()) else null end,
  case when o.status in ('ready','pending_delivery','delivered') then coalesce(o.updated_at, now()) else null end,
  coalesce(o.created_at, now()),
  coalesce(o.updated_at, now())
from public.orders o
where o.status not in ('budget','pending_payment','cancelled')
on conflict(company_id, order_id) do nothing;

-- Normalizamos trabajos que pudieran existir de etapas anteriores.
update public.production_jobs pj
set status = public.production_stage_from_order_status(o.status),
    started_at = case
      when o.status = 'in_production' then coalesce(pj.started_at, o.updated_at, now())
      else pj.started_at
    end,
    completed_at = case
      when o.status in ('ready','pending_delivery','delivered') then coalesce(pj.completed_at, o.updated_at, now())
      else null
    end,
    updated_at = now()
from public.orders o
where o.id = pj.order_id
  and o.company_id = pj.company_id
  and o.status not in ('budget','pending_payment','cancelled');

-- -------------------------------------------------------------
-- Board consolidado
-- -------------------------------------------------------------
drop function if exists public.get_production_board(uuid,text,text,uuid);
create or replace function public.get_production_board(
  p_company_id uuid,
  p_search text default null,
  p_priority text default null,
  p_responsible_user_id uuid default null
)
returns table (
  job_id uuid,
  order_id uuid,
  order_number bigint,
  client_id uuid,
  client_name text,
  first_item text,
  item_count bigint,
  priority text,
  order_status text,
  production_status text,
  delivery_date date,
  responsible_user_id uuid,
  responsible_name text,
  notes text,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz,
  is_overdue boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_company_permission(p_company_id,'production.read')
    or public.has_company_permission(p_company_id,'production.write')
  ) then
    raise exception 'No tenés permiso para ver producción';
  end if;

  return query
  select
    pj.id,
    o.id,
    o.order_number,
    o.client_id,
    c.name,
    items.first_item,
    coalesce(items.item_count,0)::bigint,
    o.priority,
    o.status,
    pj.status,
    o.delivery_date,
    pj.responsible_user_id,
    coalesce(nullif(trim(pr.full_name),''), 'Sin asignar'),
    pj.notes,
    pj.started_at,
    pj.completed_at,
    pj.updated_at,
    (
      o.delivery_date is not null
      and o.delivery_date < current_date
      and pj.status not in ('finished','delivery')
    )
  from public.production_jobs pj
  join public.orders o
    on o.id = pj.order_id and o.company_id = pj.company_id
  join public.clients c
    on c.id = o.client_id and c.company_id = o.company_id
  left join public.profiles pr
    on pr.user_id = pj.responsible_user_id
  left join lateral (
    select
      count(*) as item_count,
      (array_agg(oi.description order by oi.sort_order, oi.id))[1] as first_item
    from public.order_items oi
    where oi.company_id = o.company_id and oi.order_id = o.id
  ) items on true
  where pj.company_id = p_company_id
    and o.status <> 'cancelled'
    and (nullif(trim(p_priority),'') is null or o.priority = p_priority)
    and (p_responsible_user_id is null or pj.responsible_user_id = p_responsible_user_id)
    and (
      nullif(trim(p_search),'') is null
      or o.order_number::text ilike '%' || trim(p_search) || '%'
      or c.name ilike '%' || trim(p_search) || '%'
      or coalesce(items.first_item,'') ilike '%' || trim(p_search) || '%'
    )
  order by
    case o.priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
    o.delivery_date nulls last,
    pj.sort_order,
    pj.updated_at desc;
end;
$$;

grant execute on function public.get_production_board(uuid,text,text,uuid)
to authenticated;

-- -------------------------------------------------------------
-- Integrantes que pueden ser responsables
-- -------------------------------------------------------------
drop function if exists public.get_production_members(uuid);
create or replace function public.get_production_members(p_company_id uuid)
returns table (
  user_id uuid,
  full_name text,
  role_name text
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not (
    public.has_company_permission(p_company_id,'production.read')
    or public.has_company_permission(p_company_id,'production.write')
  ) then
    raise exception 'No tenés permiso para ver el equipo';
  end if;

  return query
  select
    m.user_id,
    coalesce(nullif(trim(p.full_name),''), 'Usuario') as full_name,
    coalesce(r.name,'Sin rol') as role_name
  from public.company_memberships m
  left join public.profiles p on p.user_id = m.user_id
  left join public.roles r on r.id = m.role_id
  where m.company_id = p_company_id
    and m.status = 'active'
  order by full_name;
end;
$$;

grant execute on function public.get_production_members(uuid) to authenticated;

-- -------------------------------------------------------------
-- Mover tarjeta / cambiar etapa
-- -------------------------------------------------------------
create or replace function public.move_production_job(
  p_company_id uuid,
  p_job_id uuid,
  p_stage text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_order_number bigint;
  v_old_stage text;
  v_order_status text;
begin
  if auth.uid() is null then raise exception 'Debés iniciar sesión'; end if;
  if not public.has_company_permission(p_company_id,'production.write') then
    raise exception 'No tenés permiso para modificar producción';
  end if;
  if p_stage not in ('pending','design','waiting_approval','production','finished','delivery') then
    raise exception 'Etapa de producción inválida';
  end if;

  select pj.order_id, pj.status, o.order_number
  into v_order_id, v_old_stage, v_order_number
  from public.production_jobs pj
  join public.orders o on o.id = pj.order_id and o.company_id = pj.company_id
  where pj.id = p_job_id and pj.company_id = p_company_id
  for update;

  if v_order_id is null then raise exception 'Trabajo de producción inexistente'; end if;

  update public.production_jobs
  set status = p_stage,
      started_at = case
        when p_stage = 'production' then coalesce(started_at, now())
        else started_at
      end,
      completed_at = case
        when p_stage in ('finished','delivery') then coalesce(completed_at, now())
        else null
      end,
      updated_at = now()
  where id = p_job_id and company_id = p_company_id;

  v_order_status := public.order_status_from_production_stage(p_stage);
  update public.orders
  set status = v_order_status,
      updated_by = auth.uid(),
      updated_at = now()
  where id = v_order_id and company_id = p_company_id;

  insert into public.activity_logs(
    company_id,user_id,action,entity_type,entity_id,description,metadata
  ) values (
    p_company_id,
    auth.uid(),
    'production.moved',
    'order',
    v_order_id::text,
    'Pedido #' || lpad(v_order_number::text,5,'0') || ' movido de ' || v_old_stage || ' a ' || p_stage,
    jsonb_build_object('job_id',p_job_id,'from',v_old_stage,'to',p_stage)
  );
end;
$$;

grant execute on function public.move_production_job(uuid,uuid,text) to authenticated;

-- -------------------------------------------------------------
-- Responsable
-- -------------------------------------------------------------
create or replace function public.assign_production_job(
  p_company_id uuid,
  p_job_id uuid,
  p_responsible_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_order_number bigint;
  v_name text;
begin
  if auth.uid() is null then raise exception 'Debés iniciar sesión'; end if;
  if not public.has_company_permission(p_company_id,'production.write') then
    raise exception 'No tenés permiso para asignar producción';
  end if;

  if p_responsible_user_id is not null and not exists(
    select 1 from public.company_memberships m
    where m.company_id = p_company_id
      and m.user_id = p_responsible_user_id
      and m.status = 'active'
  ) then
    raise exception 'El responsable no pertenece a esta empresa';
  end if;

  select pj.order_id, o.order_number
  into v_order_id, v_order_number
  from public.production_jobs pj
  join public.orders o on o.id = pj.order_id and o.company_id = pj.company_id
  where pj.id = p_job_id and pj.company_id = p_company_id;

  if v_order_id is null then raise exception 'Trabajo de producción inexistente'; end if;

  update public.production_jobs
  set responsible_user_id = p_responsible_user_id,
      updated_at = now()
  where id = p_job_id and company_id = p_company_id;

  select coalesce(p.full_name,'Sin asignar') into v_name
  from public.profiles p where p.user_id = p_responsible_user_id;
  if p_responsible_user_id is null then v_name := 'Sin asignar'; end if;

  insert into public.activity_logs(
    company_id,user_id,action,entity_type,entity_id,description,metadata
  ) values (
    p_company_id,
    auth.uid(),
    'production.assigned',
    'order',
    v_order_id::text,
    'Responsable de pedido #' || lpad(v_order_number::text,5,'0') || ': ' || coalesce(v_name,'Usuario'),
    jsonb_build_object('job_id',p_job_id,'responsible_user_id',p_responsible_user_id)
  );
end;
$$;

grant execute on function public.assign_production_job(uuid,uuid,uuid) to authenticated;

-- -------------------------------------------------------------
-- Notas de producción
-- -------------------------------------------------------------
create or replace function public.update_production_job_notes(
  p_company_id uuid,
  p_job_id uuid,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  if auth.uid() is null then raise exception 'Debés iniciar sesión'; end if;
  if not public.has_company_permission(p_company_id,'production.write') then
    raise exception 'No tenés permiso para modificar producción';
  end if;

  update public.production_jobs
  set notes = nullif(trim(p_notes),''), updated_at = now()
  where id = p_job_id and company_id = p_company_id
  returning order_id into v_order_id;

  if v_order_id is null then raise exception 'Trabajo de producción inexistente'; end if;

  insert into public.activity_logs(
    company_id,user_id,action,entity_type,entity_id,description,metadata
  ) values (
    p_company_id,auth.uid(),'production.notes_updated','order',v_order_id::text,
    'Notas de producción actualizadas',jsonb_build_object('job_id',p_job_id)
  );
end;
$$;

grant execute on function public.update_production_job_notes(uuid,uuid,text) to authenticated;
