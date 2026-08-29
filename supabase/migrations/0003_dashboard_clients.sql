-- GestArt ETAPA 3 + 4
-- Dashboard real + CRM de clientes.
-- Ejecutar después de 0001_gestart_core.sql, 0002_auth_onboarding_roles.sql y seed.sql.

alter table public.clients
  add column if not exists instagram text,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_by uuid references auth.users(id);

create index if not exists clients_company_name_idx
  on public.clients(company_id, name);

create index if not exists clients_company_created_idx
  on public.clients(company_id, created_at desc);

create index if not exists orders_company_client_idx
  on public.orders(company_id, client_id);

create index if not exists payments_company_order_idx
  on public.payments(company_id, order_id);

create index if not exists activity_logs_company_created_idx
  on public.activity_logs(company_id, created_at desc);

-- Clientes: lectura y escritura según permisos configurados por empresa.
drop policy if exists clients_tenant_select on public.clients;
drop policy if exists clients_tenant_insert on public.clients;
drop policy if exists clients_tenant_update on public.clients;
drop policy if exists clients_tenant_delete on public.clients;

create policy clients_permission_select
on public.clients for select
using (
  public.has_company_permission(company_id, 'clients.read')
  or public.has_company_permission(company_id, 'clients.write')
);

create policy clients_permission_insert
on public.clients for insert
with check (public.has_company_permission(company_id, 'clients.write'));

create policy clients_permission_update
on public.clients for update
using (public.has_company_permission(company_id, 'clients.write'))
with check (public.has_company_permission(company_id, 'clients.write'));

create policy clients_permission_delete
on public.clients for delete
using (public.has_company_permission(company_id, 'clients.write'));

-- Actualización y auditoría automática de clientes.
create or replace function public.touch_client()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists clients_touch_before_update on public.clients;
create trigger clients_touch_before_update
before update on public.clients
for each row execute function public.touch_client();

create or replace function public.log_client_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_company_id uuid;
  v_client_id uuid;
  v_name text;
  v_action text;
  v_description text;
begin
  if tg_op = 'DELETE' then
    v_company_id := old.company_id;
    v_client_id := old.id;
    v_name := old.name;
    v_action := 'client.deleted';
    v_description := 'Cliente eliminado: ' || old.name;
  elsif tg_op = 'UPDATE' then
    v_company_id := new.company_id;
    v_client_id := new.id;
    v_name := new.name;
    v_action := 'client.updated';
    v_description := 'Cliente actualizado: ' || new.name;
  else
    v_company_id := new.company_id;
    v_client_id := new.id;
    v_name := new.name;
    v_action := 'client.created';
    v_description := 'Cliente creado: ' || new.name;
  end if;

  insert into public.activity_logs(
    company_id,
    user_id,
    action,
    entity_type,
    entity_id,
    description,
    metadata
  ) values (
    v_company_id,
    auth.uid(),
    v_action,
    'client',
    v_client_id::text,
    v_description,
    jsonb_build_object('client_name', v_name)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_audit_after_change on public.clients;
create trigger clients_audit_after_change
after insert or update or delete on public.clients
for each row execute function public.log_client_change();

-- Listado escalable con métricas comerciales por cliente.
create or replace function public.get_client_summaries(
  p_company_id uuid,
  p_search text default null
)
returns table (
  id uuid,
  name text,
  company_name text,
  tax_id text,
  phone text,
  email text,
  address text,
  instagram text,
  notes text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  order_count bigint,
  quote_count bigint,
  total_purchased numeric,
  total_paid numeric,
  balance numeric,
  last_order_date date
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not (
    public.has_company_permission(p_company_id, 'clients.read')
    or public.has_company_permission(p_company_id, 'clients.write')
  ) then
    raise exception 'No tenés permiso para ver clientes';
  end if;

  return query
  select
    c.id,
    c.name,
    c.company_name,
    c.tax_id,
    c.phone,
    c.email,
    c.address,
    c.instagram,
    c.notes,
    c.is_active,
    c.created_at,
    c.updated_at,
    coalesce(os.order_count, 0)::bigint,
    coalesce(qs.quote_count, 0)::bigint,
    coalesce(os.total_purchased, 0)::numeric,
    coalesce(ps.total_paid, 0)::numeric,
    greatest(coalesce(os.total_purchased, 0) - coalesce(ps.total_paid, 0), 0)::numeric,
    os.last_order_date
  from public.clients c
  left join lateral (
    select
      count(*) as order_count,
      coalesce(sum(o.total), 0) as total_purchased,
      max(o.order_date) as last_order_date
    from public.orders o
    where o.company_id = c.company_id
      and o.client_id = c.id
      and lower(o.status) not in ('cancelled','canceled','cancelado')
  ) os on true
  left join lateral (
    select count(*) as quote_count
    from public.quotes q
    where q.company_id = c.company_id
      and q.client_id = c.id
  ) qs on true
  left join lateral (
    select coalesce(sum(p.amount), 0) as total_paid
    from public.payments p
    join public.orders o
      on o.id = p.order_id
     and o.company_id = p.company_id
    where p.company_id = c.company_id
      and o.client_id = c.id
  ) ps on true
  where c.company_id = p_company_id
    and (
      nullif(trim(p_search), '') is null
      or c.name ilike '%' || trim(p_search) || '%'
      or coalesce(c.company_name, '') ilike '%' || trim(p_search) || '%'
      or coalesce(c.tax_id, '') ilike '%' || trim(p_search) || '%'
      or coalesce(c.phone, '') ilike '%' || trim(p_search) || '%'
      or coalesce(c.email, '') ilike '%' || trim(p_search) || '%'
    )
  order by c.updated_at desc, c.created_at desc
  limit 500;
end;
$$;

grant execute on function public.get_client_summaries(uuid,text) to authenticated;

-- Borrado con validación explícita para evitar eliminar información relacionada.
create or replace function public.delete_client_safe(
  p_company_id uuid,
  p_client_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.has_company_permission(p_company_id, 'clients.write') then
    raise exception 'No tenés permiso para eliminar clientes';
  end if;

  if exists (
    select 1 from public.orders
    where company_id = p_company_id and client_id = p_client_id
  ) or exists (
    select 1 from public.quotes
    where company_id = p_company_id and client_id = p_client_id
  ) then
    raise exception 'No se puede eliminar el cliente porque tiene pedidos o presupuestos relacionados. Podés marcarlo como inactivo.';
  end if;

  delete from public.clients
  where id = p_client_id
    and company_id = p_company_id;
end;
$$;

grant execute on function public.delete_client_safe(uuid,uuid) to authenticated;

-- Métricas consolidadas para el dashboard de la empresa.
create or replace function public.get_dashboard_overview(p_company_id uuid)
returns table (
  active_orders bigint,
  in_production bigint,
  ready_orders bigint,
  income_today numeric,
  receivable numeric,
  low_stock bigint,
  client_count bigint,
  open_quotes bigint
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_timezone text;
  v_day_start timestamptz;
  v_day_end timestamptz;
begin
  if not public.is_company_member(p_company_id) then
    raise exception 'No pertenecés a esta empresa';
  end if;

  select coalesce(cs.timezone, 'America/Argentina/Buenos_Aires')
  into v_timezone
  from public.company_settings cs
  where cs.company_id = p_company_id;

  v_timezone := coalesce(v_timezone, 'America/Argentina/Buenos_Aires');
  v_day_start := date_trunc('day', now() at time zone v_timezone) at time zone v_timezone;
  v_day_end := v_day_start + interval '1 day';

  return query
  select
    (
      select count(*) from public.orders o
      where o.company_id = p_company_id
        and lower(o.status) not in ('delivered','entregado','cancelled','canceled','cancelado')
    )::bigint,
    (
      select count(*) from public.production_jobs pj
      where pj.company_id = p_company_id
        and lower(pj.status) not in ('completed','complete','done','finished','terminado','listo')
    )::bigint,
    (
      select count(*) from public.orders o
      where o.company_id = p_company_id
        and lower(o.status) in ('ready','listo','pending_delivery','pendiente de entrega')
    )::bigint,
    (
      select coalesce(sum(cm.amount),0)
      from public.cash_movements cm
      where cm.company_id = p_company_id
        and cm.movement_type = 'income'
        and cm.created_at >= v_day_start
        and cm.created_at < v_day_end
    )::numeric,
    (
      select coalesce(sum(greatest(o.total - coalesce(pp.paid,0),0)),0)
      from public.orders o
      left join lateral (
        select coalesce(sum(p.amount),0) paid
        from public.payments p
        where p.company_id = p_company_id
          and p.order_id = o.id
      ) pp on true
      where o.company_id = p_company_id
        and lower(o.status) not in ('cancelled','canceled','cancelado')
    )::numeric,
    (
      select count(*) from public.materials m
      where m.company_id = p_company_id
        and m.current_stock <= m.minimum_stock
    )::bigint,
    (
      select count(*) from public.clients c
      where c.company_id = p_company_id
        and c.is_active = true
    )::bigint,
    (
      select count(*) from public.quotes q
      where q.company_id = p_company_id
        and lower(q.status) not in ('approved','aprobado','rejected','rechazado','expired','vencido')
    )::bigint;
end;
$$;

grant execute on function public.get_dashboard_overview(uuid) to authenticated;
