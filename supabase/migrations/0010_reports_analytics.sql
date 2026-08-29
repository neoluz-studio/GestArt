-- =============================================================
-- GestArt ETAPA 11
-- Reportes reales: ventas, cobros, clientes, producción,
-- caja e inventario por tenant.
-- Ejecutar después de 0009_quotes_conversion.sql
-- =============================================================

-- -------------------------------------------------------------
-- Permiso
-- -------------------------------------------------------------

insert into public.permissions(code, description)
values ('reports.read', 'Ver reportes e indicadores de la empresa')
on conflict(code) do update
set description = excluded.description;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'reports.read'
where r.code in ('admin', 'administration')
   or lower(r.name) in ('administrador', 'administración')
on conflict do nothing;

-- Índices analíticos
create index if not exists orders_company_order_date_idx
  on public.orders(company_id, order_date desc);

create index if not exists payments_company_created_report_idx
  on public.payments(company_id, created_at desc);

create index if not exists production_jobs_company_completed_idx
  on public.production_jobs(company_id, completed_at desc);

create index if not exists stock_movements_company_created_report_idx
  on public.stock_movements(company_id, created_at desc);

-- -------------------------------------------------------------
-- Helpers de período
-- -------------------------------------------------------------

create or replace function public.report_timezone(p_company_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select nullif(trim(cs.timezone), '')
      from public.company_settings cs
      where cs.company_id = p_company_id
      limit 1
    ),
    'America/Argentina/Buenos_Aires'
  );
$$;

create or replace function public.report_start_ts(
  p_company_id uuid,
  p_date date
)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select p_date::timestamp
    at time zone public.report_timezone(p_company_id);
$$;

create or replace function public.report_end_ts(
  p_company_id uuid,
  p_date date
)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select (p_date + 1)::timestamp
    at time zone public.report_timezone(p_company_id);
$$;

-- -------------------------------------------------------------
-- Overview general
-- -------------------------------------------------------------

drop function if exists public.get_report_overview(uuid,date,date);

create or replace function public.get_report_overview(
  p_company_id uuid,
  p_from_date date,
  p_to_date date
)
returns table(
  sales_total numeric,
  collections_total numeric,
  outstanding_total numeric,
  orders_count bigint,
  average_ticket numeric,
  active_clients bigint,
  cash_income numeric,
  cash_expense numeric,
  cash_net numeric,
  completed_jobs bigint,
  average_production_hours numeric,
  inventory_value numeric,
  low_stock_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  if not public.has_company_permission(p_company_id, 'reports.read') then
    raise exception 'No tenés permiso para consultar reportes';
  end if;

  if p_from_date is null or p_to_date is null or p_from_date > p_to_date then
    raise exception 'Rango de fechas inválido';
  end if;

  v_start := public.report_start_ts(p_company_id, p_from_date);
  v_end := public.report_end_ts(p_company_id, p_to_date);

  return query
  with period_orders as (
    select
      o.id,
      o.client_id,
      o.total
    from public.orders o
    where o.company_id = p_company_id
      and o.status <> 'cancelled'
      and o.order_date between p_from_date and p_to_date
  ),
  period_payments as (
    select
      p.order_id,
      sum(p.amount)::numeric as paid
    from public.payments p
    where p.company_id = p_company_id
      and p.created_at >= v_start
      and p.created_at < v_end
    group by p.order_id
  ),
  period_cash as (
    select
      coalesce(sum(case when cm.movement_type = 'income' then cm.amount else 0 end),0)::numeric as income,
      coalesce(sum(case when cm.movement_type = 'expense' then cm.amount else 0 end),0)::numeric as expense
    from public.cash_movements cm
    where cm.company_id = p_company_id
      and cm.occurred_at >= v_start
      and cm.occurred_at < v_end
  ),
  production_stats as (
    select
      count(*) filter (
        where pj.completed_at >= v_start and pj.completed_at < v_end
      )::bigint as completed,
      coalesce(
        avg(
          extract(epoch from (pj.completed_at - pj.started_at)) / 3600.0
        ) filter (
          where pj.completed_at >= v_start
            and pj.completed_at < v_end
            and pj.started_at is not null
            and pj.completed_at >= pj.started_at
        ),
        0
      )::numeric as avg_hours
    from public.production_jobs pj
    where pj.company_id = p_company_id
  ),
  inventory_stats as (
    select
      coalesce(sum(m.current_stock * m.unit_cost),0)::numeric as value,
      count(*) filter (
        where m.is_active = true
          and m.current_stock <= m.minimum_stock
      )::bigint as low_stock
    from public.materials m
    where m.company_id = p_company_id
      and m.is_active = true
  )
  select
    coalesce((select sum(po.total) from period_orders po),0)::numeric as sales_total,
    coalesce((
      select sum(p.amount)
      from public.payments p
      where p.company_id = p_company_id
        and p.created_at >= v_start
        and p.created_at < v_end
    ),0)::numeric as collections_total,
    coalesce((
      select sum(
        greatest(
          po.total - coalesce((
            select sum(p2.amount)
            from public.payments p2
            where p2.company_id = p_company_id
              and p2.order_id = po.id
          ),0),
          0
        )
      )
      from period_orders po
    ),0)::numeric as outstanding_total,
    coalesce((select count(*) from period_orders),0)::bigint as orders_count,
    coalesce((
      select avg(po.total)
      from period_orders po
    ),0)::numeric as average_ticket,
    coalesce((
      select count(distinct po.client_id)
      from period_orders po
    ),0)::bigint as active_clients,
    (select pc.income from period_cash pc)::numeric as cash_income,
    (select pc.expense from period_cash pc)::numeric as cash_expense,
    (
      (select pc.income from period_cash pc)
      - (select pc.expense from period_cash pc)
    )::numeric as cash_net,
    (select ps.completed from production_stats ps)::bigint as completed_jobs,
    (select ps.avg_hours from production_stats ps)::numeric as average_production_hours,
    (select i.value from inventory_stats i)::numeric as inventory_value,
    (select i.low_stock from inventory_stats i)::bigint as low_stock_count;
end;
$$;

grant execute on function public.get_report_overview(uuid,date,date)
to authenticated;

-- -------------------------------------------------------------
-- Evolución diaria
-- -------------------------------------------------------------

drop function if exists public.get_report_series(uuid,date,date);

create or replace function public.get_report_series(
  p_company_id uuid,
  p_from_date date,
  p_to_date date
)
returns table(
  period_date date,
  sales numeric,
  collections numeric,
  cash_income numeric,
  cash_expense numeric,
  orders_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timezone text;
begin
  if not public.has_company_permission(p_company_id, 'reports.read') then
    raise exception 'No tenés permiso para consultar reportes';
  end if;

  if p_from_date is null or p_to_date is null or p_from_date > p_to_date then
    raise exception 'Rango de fechas inválido';
  end if;

  v_timezone := public.report_timezone(p_company_id);

  return query
  with days as (
    select generate_series(
      p_from_date::timestamp,
      p_to_date::timestamp,
      interval '1 day'
    )::date as day
  ),
  sales_by_day as (
    select
      o.order_date as day,
      sum(o.total)::numeric as sales,
      count(*)::bigint as orders_count
    from public.orders o
    where o.company_id = p_company_id
      and o.status <> 'cancelled'
      and o.order_date between p_from_date and p_to_date
    group by o.order_date
  ),
  payments_by_day as (
    select
      (p.created_at at time zone v_timezone)::date as day,
      sum(p.amount)::numeric as collections
    from public.payments p
    where p.company_id = p_company_id
      and p.created_at >= public.report_start_ts(p_company_id, p_from_date)
      and p.created_at < public.report_end_ts(p_company_id, p_to_date)
    group by 1
  ),
  cash_by_day as (
    select
      (cm.occurred_at at time zone v_timezone)::date as day,
      sum(case when cm.movement_type = 'income' then cm.amount else 0 end)::numeric as income,
      sum(case when cm.movement_type = 'expense' then cm.amount else 0 end)::numeric as expense
    from public.cash_movements cm
    where cm.company_id = p_company_id
      and cm.occurred_at >= public.report_start_ts(p_company_id, p_from_date)
      and cm.occurred_at < public.report_end_ts(p_company_id, p_to_date)
    group by 1
  )
  select
    d.day,
    coalesce(s.sales,0)::numeric,
    coalesce(p.collections,0)::numeric,
    coalesce(c.income,0)::numeric,
    coalesce(c.expense,0)::numeric,
    coalesce(s.orders_count,0)::bigint
  from days d
  left join sales_by_day s on s.day = d.day
  left join payments_by_day p on p.day = d.day
  left join cash_by_day c on c.day = d.day
  order by d.day;
end;
$$;

grant execute on function public.get_report_series(uuid,date,date)
to authenticated;

-- -------------------------------------------------------------
-- Top clientes
-- -------------------------------------------------------------

drop function if exists public.get_report_top_clients(uuid,date,date,integer);

create or replace function public.get_report_top_clients(
  p_company_id uuid,
  p_from_date date,
  p_to_date date,
  p_limit integer default 10
)
returns table(
  client_id uuid,
  client_name text,
  company_name text,
  orders_count bigint,
  sales_total numeric,
  paid_total numeric,
  outstanding_total numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_company_permission(p_company_id, 'reports.read') then
    raise exception 'No tenés permiso para consultar reportes';
  end if;

  return query
  with period_orders as (
    select
      o.id,
      o.client_id,
      o.total
    from public.orders o
    where o.company_id = p_company_id
      and o.status <> 'cancelled'
      and o.order_date between p_from_date and p_to_date
  ),
  paid_by_order as (
    select
      po.id as order_id,
      coalesce(sum(p.amount),0)::numeric as paid
    from period_orders po
    left join public.payments p
      on p.company_id = p_company_id
     and p.order_id = po.id
    group by po.id
  )
  select
    c.id,
    c.name,
    c.company_name,
    count(po.id)::bigint,
    coalesce(sum(po.total),0)::numeric,
    coalesce(sum(pbo.paid),0)::numeric,
    coalesce(sum(greatest(po.total - pbo.paid,0)),0)::numeric
  from period_orders po
  join public.clients c
    on c.id = po.client_id
   and c.company_id = p_company_id
  join paid_by_order pbo
    on pbo.order_id = po.id
  group by c.id, c.name, c.company_name
  order by sum(po.total) desc, c.name
  limit greatest(1, least(coalesce(p_limit,10),100));
end;
$$;

grant execute on function public.get_report_top_clients(uuid,date,date,integer)
to authenticated;

-- -------------------------------------------------------------
-- Pedidos por estado
-- -------------------------------------------------------------

drop function if exists public.get_report_order_statuses(uuid,date,date);

create or replace function public.get_report_order_statuses(
  p_company_id uuid,
  p_from_date date,
  p_to_date date
)
returns table(
  status text,
  orders_count bigint,
  sales_total numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_company_permission(p_company_id, 'reports.read') then
    raise exception 'No tenés permiso para consultar reportes';
  end if;

  return query
  select
    o.status,
    count(*)::bigint,
    coalesce(sum(o.total),0)::numeric
  from public.orders o
  where o.company_id = p_company_id
    and o.status <> 'cancelled'
    and o.order_date between p_from_date and p_to_date
  group by o.status
  order by count(*) desc, o.status;
end;
$$;

grant execute on function public.get_report_order_statuses(uuid,date,date)
to authenticated;

-- -------------------------------------------------------------
-- Cobros por método de pago
-- -------------------------------------------------------------

drop function if exists public.get_report_payment_methods(uuid,date,date);

create or replace function public.get_report_payment_methods(
  p_company_id uuid,
  p_from_date date,
  p_to_date date
)
returns table(
  payment_method_id uuid,
  code text,
  name text,
  payments_count bigint,
  amount numeric,
  share_pct numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  if not public.has_company_permission(p_company_id, 'reports.read') then
    raise exception 'No tenés permiso para consultar reportes';
  end if;

  v_start := public.report_start_ts(p_company_id, p_from_date);
  v_end := public.report_end_ts(p_company_id, p_to_date);

  return query
  with grouped as (
    select
      pm.id,
      pm.code,
      pm.name,
      count(p.id)::bigint as payments_count,
      coalesce(sum(p.amount),0)::numeric as amount
    from public.payments p
    join public.payment_methods pm
      on pm.id = p.payment_method_id
     and pm.company_id = p.company_id
    where p.company_id = p_company_id
      and p.created_at >= v_start
      and p.created_at < v_end
    group by pm.id, pm.code, pm.name
  ),
  totals as (
    select coalesce(sum(g.amount),0)::numeric as total
    from grouped g
  )
  select
    g.id,
    g.code,
    g.name,
    g.payments_count,
    g.amount,
    case
      when t.total > 0 then round((g.amount / t.total) * 100, 2)
      else 0
    end::numeric
  from grouped g
  cross join totals t
  order by g.amount desc, g.name;
end;
$$;

grant execute on function public.get_report_payment_methods(uuid,date,date)
to authenticated;

-- -------------------------------------------------------------
-- Producción
-- -------------------------------------------------------------

drop function if exists public.get_report_production(uuid,date,date);

create or replace function public.get_report_production(
  p_company_id uuid,
  p_from_date date,
  p_to_date date
)
returns table(
  status text,
  jobs_count bigint,
  overdue_count bigint,
  completed_count bigint,
  average_hours numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  if not public.has_company_permission(p_company_id, 'reports.read') then
    raise exception 'No tenés permiso para consultar reportes';
  end if;

  v_start := public.report_start_ts(p_company_id, p_from_date);
  v_end := public.report_end_ts(p_company_id, p_to_date);

  return query
  select
    pj.status,
    count(*)::bigint as jobs_count,
    count(*) filter (
      where o.delivery_date is not null
        and o.delivery_date < current_date
        and pj.status not in ('finished','delivery')
    )::bigint as overdue_count,
    count(*) filter (
      where pj.completed_at >= v_start
        and pj.completed_at < v_end
    )::bigint as completed_count,
    coalesce(
      avg(
        extract(epoch from (pj.completed_at - pj.started_at)) / 3600.0
      ) filter (
        where pj.completed_at >= v_start
          and pj.completed_at < v_end
          and pj.started_at is not null
          and pj.completed_at >= pj.started_at
      ),
      0
    )::numeric as average_hours
  from public.production_jobs pj
  join public.orders o
    on o.id = pj.order_id
   and o.company_id = pj.company_id
  where pj.company_id = p_company_id
    and o.status <> 'cancelled'
  group by pj.status
  order by case pj.status
    when 'pending' then 1
    when 'design' then 2
    when 'waiting_approval' then 3
    when 'production' then 4
    when 'finished' then 5
    when 'delivery' then 6
    else 99
  end;
end;
$$;

grant execute on function public.get_report_production(uuid,date,date)
to authenticated;

-- -------------------------------------------------------------
-- Inventario / consumo
-- -------------------------------------------------------------

drop function if exists public.get_report_inventory(uuid,date,date,integer);

create or replace function public.get_report_inventory(
  p_company_id uuid,
  p_from_date date,
  p_to_date date,
  p_limit integer default 20
)
returns table(
  material_id uuid,
  code text,
  name text,
  category text,
  unit text,
  current_stock numeric,
  minimum_stock numeric,
  unit_cost numeric,
  inventory_value numeric,
  consumed_quantity numeric,
  consumed_value numeric,
  low_stock boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  if not public.has_company_permission(p_company_id, 'reports.read') then
    raise exception 'No tenés permiso para consultar reportes';
  end if;

  v_start := public.report_start_ts(p_company_id, p_from_date);
  v_end := public.report_end_ts(p_company_id, p_to_date);

  return query
  with consumption as (
    select
      sm.material_id,
      coalesce(
        sum(abs(sm.quantity)) filter (where sm.movement_type = 'out'),
        0
      )::numeric as qty,
      coalesce(
        sum(
          abs(sm.quantity) * coalesce(sm.unit_cost, m.unit_cost)
        ) filter (where sm.movement_type = 'out'),
        0
      )::numeric as value
    from public.stock_movements sm
    join public.materials m
      on m.id = sm.material_id
     and m.company_id = sm.company_id
    where sm.company_id = p_company_id
      and sm.created_at >= v_start
      and sm.created_at < v_end
    group by sm.material_id
  )
  select
    m.id,
    m.code,
    m.name,
    m.category,
    m.unit,
    m.current_stock,
    m.minimum_stock,
    m.unit_cost,
    (m.current_stock * m.unit_cost)::numeric,
    coalesce(c.qty,0)::numeric,
    coalesce(c.value,0)::numeric,
    (m.current_stock <= m.minimum_stock) as low_stock
  from public.materials m
  left join consumption c
    on c.material_id = m.id
  where m.company_id = p_company_id
    and m.is_active = true
  order by
    coalesce(c.value,0) desc,
    (m.current_stock <= m.minimum_stock) desc,
    m.name
  limit greatest(1, least(coalesce(p_limit,20),100));
end;
$$;

grant execute on function public.get_report_inventory(uuid,date,date,integer)
to authenticated;
