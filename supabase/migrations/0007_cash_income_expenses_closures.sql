-- =============================================================
-- GestArt ETAPA 8
-- Caja + ingresos + egresos + cierres + reversión auditable
-- + integración compra de materiales -> stock + caja.
-- Ejecutar después de 0006_inventory_materials.sql
-- =============================================================

create extension if not exists pgcrypto;


-- Guard de compatibilidad por si Etapa 7 se reejecuta sobre una base anterior.
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  tax_id text,
  phone text,
  email text,
  address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.suppliers enable row level security;

-- -------------------------------------------------------------
-- Evolución de movimientos de caja
-- -------------------------------------------------------------

alter table public.cash_movements
  add column if not exists category text,
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists notes text,
  add column if not exists reference text,
  add column if not exists occurred_at timestamptz not null default now(),
  add column if not exists source text not null default 'manual',
  add column if not exists stock_movement_id uuid references public.stock_movements(id) on delete set null,
  add column if not exists reversal_of_id uuid references public.cash_movements(id) on delete set null,
  add column if not exists reversed_by_id uuid references public.cash_movements(id) on delete set null;

-- Los movimientos viejos vienen de pagos de pedidos o de starter.
update public.cash_movements
set occurred_at = created_at
where occurred_at is null;

update public.cash_movements
set source = case
  when payment_id is not null then 'order_payment'
  else coalesce(nullif(source,''),'manual')
end;

create index if not exists cash_movements_company_occurred_idx
  on public.cash_movements(company_id, occurred_at desc);

create index if not exists cash_movements_company_method_idx
  on public.cash_movements(company_id, payment_method_id, occurred_at desc);

create index if not exists cash_movements_company_type_idx
  on public.cash_movements(company_id, movement_type, occurred_at desc);

create unique index if not exists cash_movements_reversal_unique
  on public.cash_movements(reversal_of_id)
  where reversal_of_id is not null;

-- -------------------------------------------------------------
-- Cierres de caja
-- -------------------------------------------------------------

create table if not exists public.cash_closures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  opened_at timestamptz not null,
  closed_at timestamptz not null default now(),
  opening_balance numeric(14,2) not null default 0,
  income_total numeric(14,2) not null default 0,
  expense_total numeric(14,2) not null default 0,
  expected_balance numeric(14,2) not null default 0,
  actual_balance numeric(14,2) not null default 0,
  difference numeric(14,2) not null default 0,
  notes text,
  closed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists cash_closures_company_closed_idx
  on public.cash_closures(company_id, closed_at desc);

alter table public.cash_closures enable row level security;

drop policy if exists cash_closures_read on public.cash_closures;
create policy cash_closures_read
on public.cash_closures for select
using (
  public.has_company_permission(company_id,'cash.read')
  or public.has_company_permission(company_id,'cash.write')
);

-- Inserción exclusivamente mediante RPC.

-- -------------------------------------------------------------
-- RLS de caja
-- -------------------------------------------------------------

drop policy if exists cash_movements_permission_select on public.cash_movements;
create policy cash_movements_permission_select
on public.cash_movements for select
using (
  public.has_company_permission(company_id,'cash.read')
  or public.has_company_permission(company_id,'cash.write')
  or public.has_company_permission(company_id,'orders.read')
);

-- No damos UPDATE/DELETE en cash_movements.
-- Correcciones contables se realizan mediante contramovimientos.

-- -------------------------------------------------------------
-- Rol Administración
-- -------------------------------------------------------------

do $$
declare
  v_company uuid;
  v_role uuid;
begin
  for v_company in select id from public.companies loop
    select id into v_role
    from public.roles
    where company_id = v_company and code = 'administration'
    limit 1;

    if v_role is null then
      insert into public.roles(company_id,name,code)
      values(v_company,'Administración','administration')
      on conflict(company_id,name) do update set code = 'administration'
      returning id into v_role;
    end if;

    insert into public.role_permissions(role_id,permission_id)
    select v_role,p.id
    from public.permissions p
    where p.code in (
      'clients.read',
      'orders.read',
      'payments.write',
      'cash.read',
      'cash.write',
      'reports.read'
    )
    on conflict do nothing;
  end loop;
end $$;

create or replace function public.ensure_default_administration_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_role_id uuid;
begin
  insert into public.roles(company_id,name,code)
  values(new.id,'Administración','administration')
  returning id into v_role_id;

  insert into public.role_permissions(role_id,permission_id)
  select v_role_id,p.id
  from public.permissions p
  where p.code in (
    'clients.read',
    'orders.read',
    'payments.write',
    'cash.read',
    'cash.write',
    'reports.read'
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists companies_default_administration_role on public.companies;
create trigger companies_default_administration_role
after insert on public.companies
for each row execute function public.ensure_default_administration_role();

-- -------------------------------------------------------------
-- Utilidad: apertura de período de cierre
-- -------------------------------------------------------------

create or replace function public.cash_period_start(p_company_id uuid)
returns table(opened_at timestamptz, opening_balance numeric)
language sql
stable
security definer
set search_path = public
as $$
  with last_close as (
    select cc.closed_at, cc.actual_balance
    from public.cash_closures cc
    where cc.company_id = p_company_id
    order by cc.closed_at desc
    limit 1
  )
  select
    coalesce(
      (select closed_at from last_close),
      (select min(cm.occurred_at) from public.cash_movements cm where cm.company_id=p_company_id),
      now()
    ) as opened_at,
    coalesce((select actual_balance from last_close),0)::numeric as opening_balance;
$$;

-- -------------------------------------------------------------
-- Overview
-- -------------------------------------------------------------

drop function if exists public.get_cash_overview(uuid);
create or replace function public.get_cash_overview(p_company_id uuid)
returns table(
  current_balance numeric,
  income_today numeric,
  expense_today numeric,
  period_expected numeric,
  last_closed_at timestamptz,
  last_difference numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opened timestamptz;
  v_opening numeric(14,2);
  v_timezone text;
  v_day_start timestamptz;
  v_period_income numeric(14,2);
  v_period_expense numeric(14,2);
begin
  if not (
    public.has_company_permission(p_company_id,'cash.read')
    or public.has_company_permission(p_company_id,'cash.write')
  ) then
    raise exception 'No tenés permiso para ver caja';
  end if;

  select cps.opened_at,cps.opening_balance
  into v_opened,v_opening
  from public.cash_period_start(p_company_id) cps;

  select coalesce(cs.timezone,'America/Argentina/Buenos_Aires')
  into v_timezone
  from public.company_settings cs
  where cs.company_id=p_company_id;

  v_timezone := coalesce(v_timezone,'America/Argentina/Buenos_Aires');
  v_day_start := date_trunc('day', now() at time zone v_timezone) at time zone v_timezone;

  select
    coalesce(sum(case when cm.movement_type='income' then cm.amount else 0 end),0),
    coalesce(sum(case when cm.movement_type='expense' then cm.amount else 0 end),0)
  into v_period_income,v_period_expense
  from public.cash_movements cm
  where cm.company_id=p_company_id
    and cm.occurred_at>=v_opened;

  return query
  select
    (v_opening+v_period_income-v_period_expense)::numeric,
    coalesce(sum(case when cm.movement_type='income' and cm.occurred_at>=v_day_start then cm.amount else 0 end),0)::numeric,
    coalesce(sum(case when cm.movement_type='expense' and cm.occurred_at>=v_day_start then cm.amount else 0 end),0)::numeric,
    (v_opening+v_period_income-v_period_expense)::numeric,
    (select cc.closed_at from public.cash_closures cc where cc.company_id=p_company_id order by cc.closed_at desc limit 1),
    coalesce((select cc.difference from public.cash_closures cc where cc.company_id=p_company_id order by cc.closed_at desc limit 1),0)::numeric
  from public.cash_movements cm
  where cm.company_id=p_company_id;
end;
$$;

grant execute on function public.get_cash_overview(uuid) to authenticated;

-- -------------------------------------------------------------
-- Saldo por medio
-- -------------------------------------------------------------

drop function if exists public.get_cash_method_balances(uuid);
create or replace function public.get_cash_method_balances(p_company_id uuid)
returns table(
  payment_method_id uuid,
  code text,
  name text,
  balance numeric,
  income numeric,
  expense numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_company_permission(p_company_id,'cash.read')
    or public.has_company_permission(p_company_id,'cash.write')
  ) then
    raise exception 'No tenés permiso para ver caja';
  end if;

  return query
  select
    pm.id,
    pm.code,
    pm.name,
    coalesce(sum(case when cm.movement_type='income' then cm.amount else -cm.amount end),0)::numeric,
    coalesce(sum(case when cm.movement_type='income' then cm.amount else 0 end),0)::numeric,
    coalesce(sum(case when cm.movement_type='expense' then cm.amount else 0 end),0)::numeric
  from public.payment_methods pm
  left join public.cash_movements cm
    on cm.company_id=pm.company_id
   and cm.payment_method_id=pm.id
  where pm.company_id=p_company_id
    and pm.enabled=true
  group by pm.id,pm.code,pm.name,pm.sort_order
  order by pm.sort_order,pm.name;
end;
$$;

grant execute on function public.get_cash_method_balances(uuid) to authenticated;

-- -------------------------------------------------------------
-- Listado
-- -------------------------------------------------------------

drop function if exists public.get_cash_movements(uuid,text,text,uuid,date,date);
create or replace function public.get_cash_movements(
  p_company_id uuid,
  p_search text default null,
  p_type text default null,
  p_payment_method_id uuid default null,
  p_from_date date default null,
  p_to_date date default null
)
returns table(
  id uuid,
  movement_type text,
  category text,
  concept text,
  amount numeric,
  payment_method_id uuid,
  payment_method_name text,
  order_id uuid,
  order_number bigint,
  supplier_id uuid,
  supplier_name text,
  notes text,
  reference text,
  occurred_at timestamptz,
  created_by uuid,
  created_by_name text,
  source text,
  reversal_of_id uuid,
  reversed_by_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_company_permission(p_company_id,'cash.read')
    or public.has_company_permission(p_company_id,'cash.write')
  ) then
    raise exception 'No tenés permiso para ver caja';
  end if;

  return query
  select
    cm.id,
    cm.movement_type,
    cm.category,
    cm.concept,
    cm.amount,
    cm.payment_method_id,
    pm.name,
    cm.order_id,
    o.order_number,
    cm.supplier_id,
    s.name,
    cm.notes,
    cm.reference,
    cm.occurred_at,
    cm.created_by,
    coalesce(nullif(trim(pr.full_name),''),'Usuario'),
    cm.source,
    cm.reversal_of_id,
    cm.reversed_by_id
  from public.cash_movements cm
  left join public.payment_methods pm
    on pm.id=cm.payment_method_id and pm.company_id=cm.company_id
  left join public.orders o
    on o.id=cm.order_id and o.company_id=cm.company_id
  left join public.suppliers s
    on s.id=cm.supplier_id and s.company_id=cm.company_id
  left join public.profiles pr
    on pr.user_id=cm.created_by
  where cm.company_id=p_company_id
    and (nullif(trim(p_type),'') is null or cm.movement_type=p_type)
    and (p_payment_method_id is null or cm.payment_method_id=p_payment_method_id)
    and (p_from_date is null or cm.occurred_at>=p_from_date::timestamptz)
    and (p_to_date is null or cm.occurred_at<(p_to_date+1)::timestamptz)
    and (
      nullif(trim(p_search),'') is null
      or cm.concept ilike '%'||trim(p_search)||'%'
      or coalesce(cm.category,'') ilike '%'||trim(p_search)||'%'
      or coalesce(pm.name,'') ilike '%'||trim(p_search)||'%'
      or coalesce(s.name,'') ilike '%'||trim(p_search)||'%'
      or coalesce(pr.full_name,'') ilike '%'||trim(p_search)||'%'
      or coalesce(cm.reference,'') ilike '%'||trim(p_search)||'%'
    )
  order by cm.occurred_at desc,cm.created_at desc
  limit 500;
end;
$$;

grant execute on function public.get_cash_movements(uuid,text,text,uuid,date,date)
to authenticated;

-- -------------------------------------------------------------
-- Movimiento manual
-- -------------------------------------------------------------

drop function if exists public.record_manual_cash_movement(uuid,text,text,text,numeric,uuid,uuid,text,text,timestamptz);
create or replace function public.record_manual_cash_movement(
  p_company_id uuid,
  p_movement_type text,
  p_concept text,
  p_category text,
  p_amount numeric,
  p_payment_method_id uuid,
  p_supplier_id uuid default null,
  p_notes text default null,
  p_reference text default null,
  p_occurred_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_occurred timestamptz;
begin
  if not public.has_company_permission(p_company_id,'cash.write') then
    raise exception 'No tenés permiso para registrar movimientos de caja';
  end if;

  if p_movement_type not in ('income','expense') then
    raise exception 'Tipo de movimiento inválido';
  end if;
  if p_amount is null or p_amount<=0 then
    raise exception 'El monto debe ser mayor a cero';
  end if;
  if nullif(trim(p_concept),'') is null then
    raise exception 'El movimiento necesita un concepto';
  end if;
  if not exists(
    select 1 from public.payment_methods pm
    where pm.id=p_payment_method_id
      and pm.company_id=p_company_id
      and pm.enabled=true
  ) then
    raise exception 'Medio de pago inválido';
  end if;
  if p_supplier_id is not null and not exists(
    select 1 from public.suppliers s
    where s.id=p_supplier_id and s.company_id=p_company_id
  ) then
    raise exception 'Proveedor inválido';
  end if;

  v_occurred := coalesce(p_occurred_at,now());
  if v_occurred > now() + interval '5 minutes' then
    raise exception 'La fecha del movimiento no puede estar en el futuro';
  end if;

  if exists (
    select 1
    from public.cash_closures cc
    where cc.company_id=p_company_id
      and v_occurred <= cc.closed_at
  ) then
    raise exception 'No se puede cargar un movimiento dentro de un período de caja ya cerrado';
  end if;

  insert into public.cash_movements(
    company_id,movement_type,category,concept,amount,
    payment_method_id,supplier_id,notes,reference,
    occurred_at,source,created_by,created_at
  ) values(
    p_company_id,p_movement_type,nullif(trim(coalesce(p_category,'')),''),
    trim(p_concept),p_amount,p_payment_method_id,p_supplier_id,
    nullif(trim(coalesce(p_notes,'')),''),
    nullif(trim(coalesce(p_reference,'')),''),
    v_occurred,'manual',auth.uid(),now()
  )
  returning id into v_id;

  insert into public.activity_logs(
    company_id,user_id,action,entity_type,entity_id,description,metadata
  ) values(
    p_company_id,auth.uid(),
    case when p_movement_type='income' then 'cash.income.created' else 'cash.expense.created' end,
    'cash_movement',v_id::text,
    case when p_movement_type='income' then 'Ingreso registrado: ' else 'Egreso registrado: ' end || trim(p_concept),
    jsonb_build_object(
      'amount',p_amount,
      'payment_method_id',p_payment_method_id,
      'category',p_category,
      'supplier_id',p_supplier_id
    )
  );

  return v_id;
end;
$$;

grant execute on function public.record_manual_cash_movement(uuid,text,text,text,numeric,uuid,uuid,text,text,timestamptz)
to authenticated;

-- -------------------------------------------------------------
-- Reversión por contramovimiento
-- -------------------------------------------------------------

drop function if exists public.reverse_cash_movement(uuid,uuid,text);
create or replace function public.reverse_cash_movement(
  p_company_id uuid,
  p_movement_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.cash_movements%rowtype;
  v_reversal_id uuid;
begin
  if not public.has_company_permission(p_company_id,'cash.write') then
    raise exception 'No tenés permiso para revertir movimientos';
  end if;
  if length(trim(coalesce(p_reason,'')))<5 then
    raise exception 'Indicá el motivo de la reversión';
  end if;

  select *
  into v_original
  from public.cash_movements
  where id=p_movement_id and company_id=p_company_id
  for update;

  if not found then raise exception 'Movimiento inexistente'; end if;
  if v_original.source <> 'manual' then
    raise exception 'Los movimientos automáticos se corrigen desde su módulo de origen';
  end if;
  if v_original.reversal_of_id is not null then
    raise exception 'No se puede revertir un contramovimiento';
  end if;
  if v_original.reversed_by_id is not null then
    raise exception 'El movimiento ya fue revertido';
  end if;

  insert into public.cash_movements(
    company_id,movement_type,category,concept,amount,
    payment_method_id,supplier_id,notes,reference,occurred_at,
    source,reversal_of_id,created_by,created_at
  ) values(
    p_company_id,
    case when v_original.movement_type='income' then 'expense' else 'income' end,
    'reversal',
    'Reversión: '||v_original.concept,
    v_original.amount,
    v_original.payment_method_id,
    v_original.supplier_id,
    trim(p_reason),
    v_original.reference,
    now(),
    'reversal',
    v_original.id,
    auth.uid(),
    now()
  )
  returning id into v_reversal_id;

  update public.cash_movements
  set reversed_by_id=v_reversal_id
  where id=v_original.id and company_id=p_company_id;

  insert into public.activity_logs(
    company_id,user_id,action,entity_type,entity_id,description,metadata
  ) values(
    p_company_id,auth.uid(),'cash.movement.reversed','cash_movement',v_original.id::text,
    'Movimiento de caja revertido mediante contramovimiento',
    jsonb_build_object('reversal_id',v_reversal_id,'reason',trim(p_reason))
  );

  return v_reversal_id;
end;
$$;

grant execute on function public.reverse_cash_movement(uuid,uuid,text) to authenticated;

-- -------------------------------------------------------------
-- Cierre de caja
-- -------------------------------------------------------------

drop function if exists public.preview_cash_closure(uuid);
create or replace function public.preview_cash_closure(p_company_id uuid)
returns table(
  opened_at timestamptz,
  opening_balance numeric,
  income_total numeric,
  expense_total numeric,
  expected_balance numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opened timestamptz;
  v_opening numeric(14,2);
  v_income numeric(14,2);
  v_expense numeric(14,2);
begin
  if not (
    public.has_company_permission(p_company_id,'cash.read')
    or public.has_company_permission(p_company_id,'cash.write')
  ) then
    raise exception 'No tenés permiso para ver caja';
  end if;

  select cps.opened_at,cps.opening_balance
  into v_opened,v_opening
  from public.cash_period_start(p_company_id) cps;

  select
    coalesce(sum(case when cm.movement_type='income' then cm.amount else 0 end),0),
    coalesce(sum(case when cm.movement_type='expense' then cm.amount else 0 end),0)
  into v_income,v_expense
  from public.cash_movements cm
  where cm.company_id=p_company_id
    and cm.occurred_at>=v_opened;

  return query
  select v_opened,v_opening,v_income,v_expense,(v_opening+v_income-v_expense)::numeric;
end;
$$;

grant execute on function public.preview_cash_closure(uuid) to authenticated;

drop function if exists public.close_cash_register(uuid,numeric,text);
create or replace function public.close_cash_register(
  p_company_id uuid,
  p_actual_balance numeric,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opened timestamptz;
  v_opening numeric(14,2);
  v_income numeric(14,2);
  v_expense numeric(14,2);
  v_expected numeric(14,2);
  v_id uuid;
begin
  if not public.has_company_permission(p_company_id,'cash.write') then
    raise exception 'No tenés permiso para cerrar caja';
  end if;
  if p_actual_balance is null then
    raise exception 'Indicá el saldo real';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_company_id::text || ':cash-close'));

  select pc.opened_at,pc.opening_balance,pc.income_total,pc.expense_total,pc.expected_balance
  into v_opened,v_opening,v_income,v_expense,v_expected
  from public.preview_cash_closure(p_company_id) pc;

  if exists(
    select 1 from public.cash_closures cc
    where cc.company_id=p_company_id
      and cc.closed_at>=now()-interval '3 seconds'
  ) then
    raise exception 'Ya se registró un cierre hace unos segundos';
  end if;

  insert into public.cash_closures(
    company_id,opened_at,closed_at,opening_balance,
    income_total,expense_total,expected_balance,actual_balance,
    difference,notes,closed_by
  ) values(
    p_company_id,v_opened,now(),v_opening,
    v_income,v_expense,v_expected,p_actual_balance,
    p_actual_balance-v_expected,
    nullif(trim(coalesce(p_notes,'')),''),
    auth.uid()
  )
  returning id into v_id;

  insert into public.activity_logs(
    company_id,user_id,action,entity_type,entity_id,description,metadata
  ) values(
    p_company_id,auth.uid(),'cash.closed','cash_closure',v_id::text,
    'Cierre de caja realizado',
    jsonb_build_object(
      'opening_balance',v_opening,
      'income_total',v_income,
      'expense_total',v_expense,
      'expected_balance',v_expected,
      'actual_balance',p_actual_balance,
      'difference',p_actual_balance-v_expected
    )
  );

  return v_id;
end;
$$;

grant execute on function public.close_cash_register(uuid,numeric,text) to authenticated;

drop function if exists public.get_cash_closures(uuid);
create or replace function public.get_cash_closures(p_company_id uuid)
returns table(
  id uuid,
  opened_at timestamptz,
  closed_at timestamptz,
  opening_balance numeric,
  income_total numeric,
  expense_total numeric,
  expected_balance numeric,
  actual_balance numeric,
  difference numeric,
  notes text,
  closed_by_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_company_permission(p_company_id,'cash.read')
    or public.has_company_permission(p_company_id,'cash.write')
  ) then
    raise exception 'No tenés permiso para ver cierres';
  end if;

  return query
  select
    cc.id,cc.opened_at,cc.closed_at,cc.opening_balance,
    cc.income_total,cc.expense_total,cc.expected_balance,
    cc.actual_balance,cc.difference,cc.notes,
    coalesce(nullif(trim(pr.full_name),''),'Usuario')
  from public.cash_closures cc
  left join public.profiles pr on pr.user_id=cc.closed_by
  where cc.company_id=p_company_id
  order by cc.closed_at desc
  limit 100;
end;
$$;

grant execute on function public.get_cash_closures(uuid) to authenticated;

-- -------------------------------------------------------------
-- Integración compra material -> stock + egreso de caja
-- -------------------------------------------------------------

drop function if exists public.record_inventory_purchase(uuid,uuid,numeric,text,numeric,uuid,uuid,text);
create or replace function public.record_inventory_purchase(
  p_company_id uuid,
  p_material_id uuid,
  p_quantity numeric,
  p_reason text,
  p_unit_cost numeric,
  p_payment_method_id uuid,
  p_supplier_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock_movement uuid;
  v_cash_movement uuid;
  v_material_name text;
  v_amount numeric(14,2);
begin
  if not public.has_company_permission(p_company_id,'inventory.write') then
    raise exception 'No tenés permiso para modificar inventario';
  end if;
  if not public.has_company_permission(p_company_id,'cash.write') then
    raise exception 'No tenés permiso para registrar el egreso de caja';
  end if;
  if p_unit_cost is null or p_unit_cost<0 then
    raise exception 'Indicá un costo unitario válido';
  end if;
  if p_quantity is null or p_quantity<=0 then
    raise exception 'La cantidad debe ser mayor a cero';
  end if;
  if not exists(
    select 1 from public.payment_methods pm
    where pm.id=p_payment_method_id and pm.company_id=p_company_id and pm.enabled=true
  ) then
    raise exception 'Medio de pago inválido';
  end if;

  select m.name
  into v_material_name
  from public.materials m
  where m.id=p_material_id and m.company_id=p_company_id;

  if v_material_name is null then raise exception 'Material inexistente'; end if;

  -- Todo corre en la misma transacción.
  v_stock_movement := public.record_stock_movement(
    p_company_id,
    p_material_id,
    'in',
    p_quantity,
    p_reason,
    p_unit_cost,
    null,
    p_supplier_id,
    p_notes
  );

  v_amount := round(abs(p_quantity) * p_unit_cost,2);

  insert into public.cash_movements(
    company_id,movement_type,category,concept,amount,
    payment_method_id,supplier_id,notes,occurred_at,source,
    stock_movement_id,created_by,created_at
  ) values(
    p_company_id,'expense','materials',
    'Compra de material: '||v_material_name,
    v_amount,p_payment_method_id,p_supplier_id,
    nullif(trim(coalesce(p_notes,'')),''),
    now(),'inventory_purchase',
    v_stock_movement,auth.uid(),now()
  )
  returning id into v_cash_movement;

  insert into public.activity_logs(
    company_id,user_id,action,entity_type,entity_id,description,metadata
  ) values(
    p_company_id,auth.uid(),'inventory.purchase.registered','material',p_material_id::text,
    'Compra de material impactó inventario y caja',
    jsonb_build_object(
      'stock_movement_id',v_stock_movement,
      'cash_movement_id',v_cash_movement,
      'quantity',p_quantity,
      'unit_cost',p_unit_cost,
      'amount',v_amount
    )
  );

  return v_stock_movement;
end;
$$;

grant execute on function public.record_inventory_purchase(uuid,uuid,numeric,text,numeric,uuid,uuid,text)
to authenticated;

-- -------------------------------------------------------------
-- Marcar mejor el origen de los pagos de pedido existentes/futuros
-- -------------------------------------------------------------

update public.cash_movements
set source='order_payment'
where payment_id is not null;

-- Reemplazamos la RPC de pagos para que marque source explícitamente.
create or replace function public.register_mixed_payment_v2(
  p_company_id uuid,
  p_order_id uuid,
  p_lines jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_line jsonb;
  v_amount numeric(14,2);
  v_total numeric(14,2) := 0;
  v_order_total numeric(14,2);
  v_paid numeric(14,2);
  v_balance numeric(14,2);
  v_method_id uuid;
  v_payment_id uuid;
  v_reference text;
  v_order_number bigint;
begin
  if auth.uid() is null then raise exception 'Debés iniciar sesión'; end if;
  if not public.has_company_permission(p_company_id,'payments.write') then raise exception 'No tenés permiso para registrar pagos'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 then raise exception 'Agregá al menos un medio de pago'; end if;

  select o.total,o.order_number into v_order_total,v_order_number
  from public.orders o
  where o.id=p_order_id and o.company_id=p_company_id and o.status<>'cancelled'
  for update;

  if v_order_total is null then raise exception 'Pedido inexistente o cancelado'; end if;

  select coalesce(sum(p.amount),0)
  into v_paid
  from public.payments p
  where p.company_id=p_company_id and p.order_id=p_order_id;

  v_balance := greatest(v_order_total-v_paid,0);

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_amount := coalesce((v_line->>'amount')::numeric,0);
    v_method_id := nullif(v_line->>'payment_method_id','')::uuid;
    if v_amount<=0 then raise exception 'Todos los montos deben ser mayores a cero'; end if;
    if v_method_id is null or not exists(
      select 1 from public.payment_methods pm
      where pm.id=v_method_id and pm.company_id=p_company_id and pm.enabled=true
    ) then raise exception 'Medio de pago inválido'; end if;
    v_total := v_total+v_amount;
  end loop;

  if v_total>v_balance then
    raise exception 'El pago (%) supera el saldo pendiente (%)',v_total,v_balance;
  end if;

  insert into public.payment_batches(company_id,order_id,total_amount,notes,created_by)
  values(p_company_id,p_order_id,v_total,nullif(trim(coalesce(p_notes,'')),''),auth.uid())
  returning id into v_batch_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_amount := (v_line->>'amount')::numeric;
    v_method_id := (v_line->>'payment_method_id')::uuid;
    v_reference := nullif(trim(coalesce(v_line->>'reference','')),'');

    insert into public.payments(
      company_id,payment_batch_id,order_id,payment_method_id,amount,reference,created_by
    ) values(
      p_company_id,v_batch_id,p_order_id,v_method_id,v_amount,v_reference,auth.uid()
    )
    returning id into v_payment_id;

    insert into public.cash_movements(
      company_id,movement_type,category,concept,amount,
      payment_method_id,order_id,payment_id,reference,
      occurred_at,source,created_by
    ) values(
      p_company_id,'income','order_payment',
      'Pago pedido #'||lpad(v_order_number::text,5,'0'),
      v_amount,v_method_id,p_order_id,v_payment_id,v_reference,
      now(),'order_payment',auth.uid()
    );
  end loop;

  insert into public.activity_logs(
    company_id,user_id,action,entity_type,entity_id,description,metadata
  ) values(
    p_company_id,auth.uid(),'payment.registered','order',p_order_id::text,
    'Pago registrado en pedido #'||lpad(v_order_number::text,5,'0'),
    jsonb_build_object('payment_batch_id',v_batch_id,'amount',v_total,'lines',p_lines)
  );

  return v_batch_id;
end;
$$;

grant execute on function public.register_mixed_payment_v2(uuid,uuid,jsonb,text)
to authenticated;
