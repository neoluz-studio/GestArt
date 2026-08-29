-- =============================================================
-- GestArt ETAPA 5
-- Pedidos + ítems + pagos parciales y mixtos + caja + auditoría
-- Ejecutar después de 0003_dashboard_clients.sql
-- =============================================================

create extension if not exists pgcrypto;

-- -------------------------------------------------------------
-- Evolución de tablas
-- -------------------------------------------------------------
alter table public.orders add column if not exists subtotal numeric(14,2) not null default 0;
alter table public.orders add column if not exists discount numeric(14,2) not null default 0;
alter table public.orders add column if not exists assigned_user_id uuid references auth.users(id);
alter table public.orders add column if not exists designer_user_id uuid references auth.users(id);
alter table public.orders add column if not exists updated_by uuid references auth.users(id);

alter table public.order_items add column if not exists sort_order integer not null default 0;
alter table public.order_items add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.payment_methods add column if not exists sort_order integer not null default 0;
alter table public.payment_methods add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.payment_batches add column if not exists notes text;
alter table public.payments add column if not exists reference text;

create index if not exists order_items_company_order_idx on public.order_items(company_id, order_id, sort_order);
create index if not exists orders_company_status_priority_idx on public.orders(company_id, status, priority);
create index if not exists payment_methods_company_enabled_idx on public.payment_methods(company_id, enabled, sort_order);
create index if not exists payment_batches_company_order_idx on public.payment_batches(company_id, order_id, created_at desc);
create index if not exists cash_movements_company_order_created_idx on public.cash_movements(company_id, order_id, created_at desc);

-- Corregir importes históricos si ya existían pedidos del starter.
update public.orders o
set subtotal = coalesce((select sum(oi.total) from public.order_items oi where oi.order_id = o.id and oi.company_id = o.company_id), o.total),
    discount = greatest(coalesce((select sum(oi.total) from public.order_items oi where oi.order_id = o.id and oi.company_id = o.company_id), o.total) - o.total, 0)
where o.subtotal = 0 and o.total > 0;

-- Métodos por defecto también para empresas creadas antes de esta etapa.
insert into public.payment_methods(company_id, code, name, enabled, sort_order)
select c.id, x.code, x.name, true, x.sort_order
from public.companies c
cross join (values
  ('cash','Efectivo',10),
  ('transfer','Transferencia',20),
  ('mercadopago','Mercado Pago',30),
  ('debit','Tarjeta de débito',40),
  ('credit','Tarjeta de crédito',50),
  ('other','Otro',60)
) as x(code,name,sort_order)
on conflict(company_id, code) do update set
  name = excluded.name,
  sort_order = excluded.sort_order;

-- -------------------------------------------------------------
-- Permisos y RLS específico
-- -------------------------------------------------------------
insert into public.permissions(code, description)
values
  ('orders.read','Ver pedidos'),
  ('orders.write','Crear y modificar pedidos'),
  ('payments.write','Registrar pagos de pedidos'),
  ('cash.read','Ver caja'),
  ('cash.write','Registrar movimientos de caja')
on conflict(code) do update set description = excluded.description;

-- Administradores existentes reciben cualquier permiso nuevo.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('orders.read','orders.write','payments.write','cash.read','cash.write')
where r.code = 'admin' or lower(r.name) = 'administrador'
on conflict do nothing;

-- Pedidos
drop policy if exists orders_tenant_select on public.orders;
drop policy if exists orders_tenant_insert on public.orders;
drop policy if exists orders_tenant_update on public.orders;
drop policy if exists orders_tenant_delete on public.orders;
drop policy if exists orders_permission_select on public.orders;
drop policy if exists orders_permission_insert on public.orders;
drop policy if exists orders_permission_update on public.orders;

create policy orders_permission_select on public.orders for select
using (public.has_company_permission(company_id,'orders.read') or public.has_company_permission(company_id,'orders.write'));
create policy orders_permission_insert on public.orders for insert
with check (public.has_company_permission(company_id,'orders.write'));
create policy orders_permission_update on public.orders for update
using (public.has_company_permission(company_id,'orders.write'))
with check (public.has_company_permission(company_id,'orders.write'));

-- Ítems
drop policy if exists order_items_tenant_select on public.order_items;
drop policy if exists order_items_tenant_insert on public.order_items;
drop policy if exists order_items_tenant_update on public.order_items;
drop policy if exists order_items_tenant_delete on public.order_items;
drop policy if exists order_items_permission_select on public.order_items;
drop policy if exists order_items_permission_insert on public.order_items;
drop policy if exists order_items_permission_update on public.order_items;
drop policy if exists order_items_permission_delete on public.order_items;

create policy order_items_permission_select on public.order_items for select
using (public.has_company_permission(company_id,'orders.read') or public.has_company_permission(company_id,'orders.write'));
create policy order_items_permission_insert on public.order_items for insert
with check (public.has_company_permission(company_id,'orders.write'));
create policy order_items_permission_update on public.order_items for update
using (public.has_company_permission(company_id,'orders.write'))
with check (public.has_company_permission(company_id,'orders.write'));
create policy order_items_permission_delete on public.order_items for delete
using (public.has_company_permission(company_id,'orders.write'));

-- Métodos de pago: lectura a miembros con pedidos/caja, escritura reservada a administración de empresa.
drop policy if exists payment_methods_tenant_select on public.payment_methods;
drop policy if exists payment_methods_tenant_insert on public.payment_methods;
drop policy if exists payment_methods_tenant_update on public.payment_methods;
drop policy if exists payment_methods_tenant_delete on public.payment_methods;
drop policy if exists payment_methods_permission_select on public.payment_methods;
create policy payment_methods_permission_select on public.payment_methods for select
using (
  public.has_company_permission(company_id,'payments.write')
  or public.has_company_permission(company_id,'cash.read')
  or public.has_company_permission(company_id,'company.manage')
);

-- Pagos y lotes
drop policy if exists payment_batches_tenant_select on public.payment_batches;
drop policy if exists payment_batches_tenant_insert on public.payment_batches;
drop policy if exists payments_tenant_select on public.payments;
drop policy if exists payments_tenant_insert on public.payments;
drop policy if exists payment_batches_permission_select on public.payment_batches;
drop policy if exists payments_permission_select on public.payments;
create policy payment_batches_permission_select on public.payment_batches for select
using (public.has_company_permission(company_id,'orders.read') or public.has_company_permission(company_id,'payments.write') or public.has_company_permission(company_id,'cash.read'));
create policy payments_permission_select on public.payments for select
using (public.has_company_permission(company_id,'orders.read') or public.has_company_permission(company_id,'payments.write') or public.has_company_permission(company_id,'cash.read'));

-- Caja: lectura para caja y lectura de pedidos, inserción mediante RPC segura.
drop policy if exists cash_movements_tenant_select on public.cash_movements;
drop policy if exists cash_movements_tenant_insert on public.cash_movements;
drop policy if exists cash_movements_permission_select on public.cash_movements;
create policy cash_movements_permission_select on public.cash_movements for select
using (public.has_company_permission(company_id,'cash.read') or public.has_company_permission(company_id,'orders.read'));

-- -------------------------------------------------------------
-- Contador transaccional por empresa
-- -------------------------------------------------------------
create table if not exists public.company_counters (
  company_id uuid primary key references public.companies(id) on delete cascade,
  next_order_number bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.company_counters enable row level security;
drop policy if exists company_counters_admin_read on public.company_counters;
create policy company_counters_admin_read on public.company_counters for select
using (public.has_company_permission(company_id,'company.manage'));

insert into public.company_counters(company_id, next_order_number)
select c.id, coalesce((select max(o.order_number) + 1 from public.orders o where o.company_id = c.id), 1)
from public.companies c
on conflict(company_id) do update
set next_order_number = greatest(public.company_counters.next_order_number, excluded.next_order_number);

create or replace function public.take_next_order_number(p_company_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_number bigint;
begin
  if not public.has_company_permission(p_company_id,'orders.write') then
    raise exception 'No tenés permiso para crear pedidos';
  end if;

  insert into public.company_counters(company_id,next_order_number)
  values(p_company_id,2)
  on conflict(company_id) do update
  set next_order_number = public.company_counters.next_order_number + 1,
      updated_at = now()
  returning next_order_number - 1 into v_number;

  return v_number;
end;
$$;

-- -------------------------------------------------------------
-- Listado consolidado
-- -------------------------------------------------------------
drop function if exists public.get_order_summaries(uuid,text,text,text);
drop function if exists public.get_order_summaries(uuid,text,text,text,uuid);
create or replace function public.get_order_summaries(
  p_company_id uuid,
  p_search text default null,
  p_status text default null,
  p_priority text default null,
  p_order_id uuid default null
)
returns table (
  id uuid,
  order_number bigint,
  client_id uuid,
  client_name text,
  client_company text,
  client_phone text,
  order_date date,
  delivery_date date,
  priority text,
  status text,
  subtotal numeric,
  discount numeric,
  total numeric,
  paid numeric,
  balance numeric,
  item_count bigint,
  first_item text,
  notes text,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not (
    public.has_company_permission(p_company_id,'orders.read')
    or public.has_company_permission(p_company_id,'orders.write')
  ) then
    raise exception 'No tenés permiso para ver pedidos';
  end if;

  return query
  select
    o.id,
    o.order_number,
    o.client_id,
    c.name,
    c.company_name,
    c.phone,
    o.order_date,
    o.delivery_date,
    o.priority,
    o.status,
    o.subtotal,
    o.discount,
    o.total,
    coalesce(pay.paid,0)::numeric,
    greatest(o.total - coalesce(pay.paid,0),0)::numeric,
    coalesce(items.item_count,0)::bigint,
    items.first_item,
    o.notes,
    o.created_at
  from public.orders o
  join public.clients c on c.id = o.client_id and c.company_id = o.company_id
  left join lateral (
    select count(*) item_count, min(oi.description) first_item
    from public.order_items oi
    where oi.company_id = o.company_id and oi.order_id = o.id
  ) items on true
  left join lateral (
    select coalesce(sum(p.amount),0) paid
    from public.payments p
    where p.company_id = o.company_id and p.order_id = o.id
  ) pay on true
  where o.company_id = p_company_id
    and (p_order_id is null or o.id = p_order_id)
    and (nullif(p_status,'') is null or o.status = p_status)
    and (nullif(p_priority,'') is null or o.priority = p_priority)
    and (
      nullif(trim(p_search),'') is null
      or o.order_number::text ilike '%' || trim(p_search) || '%'
      or c.name ilike '%' || trim(p_search) || '%'
      or coalesce(c.company_name,'') ilike '%' || trim(p_search) || '%'
      or coalesce(c.phone,'') ilike '%' || trim(p_search) || '%'
      or coalesce(items.first_item,'') ilike '%' || trim(p_search) || '%'
    )
  order by o.created_at desc
  limit 500;
end;
$$;

grant execute on function public.get_order_summaries(uuid,text,text,text,uuid) to authenticated;

-- -------------------------------------------------------------
-- Crear pedido de forma atómica
-- -------------------------------------------------------------
create or replace function public.create_order(
  p_company_id uuid,
  p_client_id uuid,
  p_order_date date,
  p_delivery_date date,
  p_priority text,
  p_status text,
  p_discount numeric,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_order_number bigint;
  v_subtotal numeric(14,2) := 0;
  v_total numeric(14,2);
  v_item jsonb;
  v_qty numeric(14,3);
  v_unit numeric(14,2);
  v_description text;
  v_sort integer := 0;
begin
  if auth.uid() is null then raise exception 'Debés iniciar sesión'; end if;
  if not public.has_company_permission(p_company_id,'orders.write') then raise exception 'No tenés permiso para crear pedidos'; end if;
  if not exists(select 1 from public.clients c where c.id=p_client_id and c.company_id=p_company_id and c.is_active=true) then raise exception 'El cliente no pertenece a la empresa o está inactivo'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'El pedido debe tener al menos un ítem'; end if;
  if coalesce(p_discount,0) < 0 then raise exception 'El descuento no puede ser negativo'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_description := trim(coalesce(v_item->>'description',''));
    v_qty := coalesce((v_item->>'quantity')::numeric,0);
    v_unit := coalesce((v_item->>'unit_price')::numeric,0);
    if v_description='' then raise exception 'Todos los ítems deben tener descripción'; end if;
    if v_qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
    if v_unit < 0 then raise exception 'El precio no puede ser negativo'; end if;
    v_subtotal := v_subtotal + round(v_qty * v_unit,2);
  end loop;

  if coalesce(p_discount,0) > v_subtotal then raise exception 'El descuento no puede superar el subtotal'; end if;
  v_total := v_subtotal - coalesce(p_discount,0);
  v_order_number := public.take_next_order_number(p_company_id);

  insert into public.orders(
    company_id,client_id,order_number,order_date,delivery_date,priority,status,
    subtotal,discount,total,notes,created_by,updated_by
  ) values (
    p_company_id,p_client_id,v_order_number,coalesce(p_order_date,current_date),p_delivery_date,
    coalesce(nullif(p_priority,''),'normal'),coalesce(nullif(p_status,''),'confirmed'),
    v_subtotal,coalesce(p_discount,0),v_total,nullif(trim(coalesce(p_notes,'')),''),auth.uid(),auth.uid()
  ) returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_sort := v_sort + 1;
    v_description := trim(v_item->>'description');
    v_qty := (v_item->>'quantity')::numeric;
    v_unit := (v_item->>'unit_price')::numeric;
    insert into public.order_items(company_id,order_id,description,quantity,unit_price,total,sort_order)
    values(p_company_id,v_order_id,v_description,v_qty,v_unit,round(v_qty*v_unit,2),v_sort);
  end loop;

  insert into public.activity_logs(company_id,user_id,action,entity_type,entity_id,description,metadata)
  values(p_company_id,auth.uid(),'order.created','order',v_order_id::text,'Pedido #'||lpad(v_order_number::text,5,'0')||' creado',jsonb_build_object('order_number',v_order_number,'total',v_total));

  return v_order_id;
end;
$$;

grant execute on function public.create_order(uuid,uuid,date,date,text,text,numeric,text,jsonb) to authenticated;

-- -------------------------------------------------------------
-- Editar pedido e ítems de forma atómica
-- -------------------------------------------------------------
create or replace function public.update_order(
  p_company_id uuid,
  p_order_id uuid,
  p_client_id uuid,
  p_order_date date,
  p_delivery_date date,
  p_priority text,
  p_status text,
  p_discount numeric,
  p_notes text,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal numeric(14,2) := 0;
  v_total numeric(14,2);
  v_paid numeric(14,2);
  v_item jsonb;
  v_qty numeric(14,3);
  v_unit numeric(14,2);
  v_description text;
  v_sort integer := 0;
  v_number bigint;
begin
  if not public.has_company_permission(p_company_id,'orders.write') then raise exception 'No tenés permiso para modificar pedidos'; end if;
  select o.order_number into v_number from public.orders o where o.id=p_order_id and o.company_id=p_company_id for update;
  if v_number is null then raise exception 'Pedido inexistente'; end if;
  if not exists(select 1 from public.clients c where c.id=p_client_id and c.company_id=p_company_id and c.is_active=true) then raise exception 'Cliente inválido'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'El pedido debe tener al menos un ítem'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_description := trim(coalesce(v_item->>'description',''));
    v_qty := coalesce((v_item->>'quantity')::numeric,0);
    v_unit := coalesce((v_item->>'unit_price')::numeric,0);
    if v_description='' or v_qty<=0 or v_unit<0 then raise exception 'Revisá los ítems del pedido'; end if;
    v_subtotal := v_subtotal + round(v_qty*v_unit,2);
  end loop;

  if coalesce(p_discount,0)<0 or coalesce(p_discount,0)>v_subtotal then raise exception 'Descuento inválido'; end if;
  v_total := v_subtotal - coalesce(p_discount,0);
  select coalesce(sum(p.amount),0) into v_paid from public.payments p where p.company_id=p_company_id and p.order_id=p_order_id;
  if v_total < v_paid then raise exception 'El nuevo total no puede ser menor al monto ya pagado (%)', v_paid; end if;

  update public.orders set
    client_id=p_client_id, order_date=coalesce(p_order_date,current_date), delivery_date=p_delivery_date,
    priority=coalesce(nullif(p_priority,''),'normal'), status=coalesce(nullif(p_status,''),'confirmed'),
    subtotal=v_subtotal, discount=coalesce(p_discount,0), total=v_total,
    notes=nullif(trim(coalesce(p_notes,'')),''), updated_by=auth.uid(), updated_at=now()
  where id=p_order_id and company_id=p_company_id;

  delete from public.order_items where company_id=p_company_id and order_id=p_order_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_sort := v_sort + 1;
    v_description := trim(v_item->>'description');
    v_qty := (v_item->>'quantity')::numeric;
    v_unit := (v_item->>'unit_price')::numeric;
    insert into public.order_items(company_id,order_id,description,quantity,unit_price,total,sort_order)
    values(p_company_id,p_order_id,v_description,v_qty,v_unit,round(v_qty*v_unit,2),v_sort);
  end loop;

  insert into public.activity_logs(company_id,user_id,action,entity_type,entity_id,description,metadata)
  values(p_company_id,auth.uid(),'order.updated','order',p_order_id::text,'Pedido #'||lpad(v_number::text,5,'0')||' actualizado',jsonb_build_object('total',v_total));
end;
$$;

grant execute on function public.update_order(uuid,uuid,uuid,date,date,text,text,numeric,text,jsonb) to authenticated;

-- -------------------------------------------------------------
-- Cambiar estado
-- -------------------------------------------------------------
create or replace function public.change_order_status(p_company_id uuid,p_order_id uuid,p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_number bigint; v_balance numeric;
begin
  if not public.has_company_permission(p_company_id,'orders.write') then raise exception 'No tenés permiso para modificar pedidos'; end if;
  select o.order_number, greatest(o.total-coalesce((select sum(p.amount) from public.payments p where p.company_id=o.company_id and p.order_id=o.id),0),0)
  into v_number,v_balance from public.orders o where o.company_id=p_company_id and o.id=p_order_id for update;
  if v_number is null then raise exception 'Pedido inexistente'; end if;
  if p_status='cancelled' then raise exception 'Usá la acción de cancelar pedido'; end if;
  update public.orders set status=p_status,updated_by=auth.uid(),updated_at=now() where company_id=p_company_id and id=p_order_id;
  insert into public.activity_logs(company_id,user_id,action,entity_type,entity_id,description,metadata)
  values(p_company_id,auth.uid(),'order.status_changed','order',p_order_id::text,'Estado del pedido #'||lpad(v_number::text,5,'0')||' actualizado',jsonb_build_object('status',p_status,'balance',v_balance));
end;
$$;
grant execute on function public.change_order_status(uuid,uuid,text) to authenticated;

-- -------------------------------------------------------------
-- Pago parcial / mixto transaccional
-- -------------------------------------------------------------
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
  from public.orders o where o.id=p_order_id and o.company_id=p_company_id and o.status<>'cancelled' for update;
  if v_order_total is null then raise exception 'Pedido inexistente o cancelado'; end if;

  select coalesce(sum(p.amount),0) into v_paid from public.payments p where p.company_id=p_company_id and p.order_id=p_order_id;
  v_balance := greatest(v_order_total-v_paid,0);

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_amount := coalesce((v_line->>'amount')::numeric,0);
    v_method_id := nullif(v_line->>'payment_method_id','')::uuid;
    if v_amount<=0 then raise exception 'Todos los montos deben ser mayores a cero'; end if;
    if v_method_id is null or not exists(select 1 from public.payment_methods pm where pm.id=v_method_id and pm.company_id=p_company_id and pm.enabled=true) then raise exception 'Medio de pago inválido'; end if;
    v_total := v_total + v_amount;
  end loop;

  if v_total > v_balance then raise exception 'El pago (%) supera el saldo pendiente (%)',v_total,v_balance; end if;

  insert into public.payment_batches(company_id,order_id,total_amount,notes,created_by)
  values(p_company_id,p_order_id,v_total,nullif(trim(coalesce(p_notes,'')),''),auth.uid()) returning id into v_batch_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_amount := (v_line->>'amount')::numeric;
    v_method_id := (v_line->>'payment_method_id')::uuid;
    v_reference := nullif(trim(coalesce(v_line->>'reference','')),'');

    insert into public.payments(company_id,payment_batch_id,order_id,payment_method_id,amount,reference,created_by)
    values(p_company_id,v_batch_id,p_order_id,v_method_id,v_amount,v_reference,auth.uid()) returning id into v_payment_id;

    insert into public.cash_movements(company_id,movement_type,concept,amount,payment_method_id,order_id,payment_id,created_by)
    values(p_company_id,'income','Pago pedido #'||lpad(v_order_number::text,5,'0'),v_amount,v_method_id,p_order_id,v_payment_id,auth.uid());
  end loop;

  insert into public.activity_logs(company_id,user_id,action,entity_type,entity_id,description,metadata)
  values(p_company_id,auth.uid(),'payment.registered','order',p_order_id::text,'Pago registrado en pedido #'||lpad(v_order_number::text,5,'0'),jsonb_build_object('payment_batch_id',v_batch_id,'amount',v_total,'lines',p_lines));

  return v_batch_id;
end;
$$;
grant execute on function public.register_mixed_payment_v2(uuid,uuid,jsonb,text) to authenticated;

-- -------------------------------------------------------------
-- Cancelación segura
-- -------------------------------------------------------------
create or replace function public.cancel_order_safe(p_company_id uuid,p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_paid numeric; v_number bigint;
begin
  if not public.has_company_permission(p_company_id,'orders.write') then raise exception 'No tenés permiso para cancelar pedidos'; end if;
  select o.order_number into v_number from public.orders o where o.company_id=p_company_id and o.id=p_order_id for update;
  if v_number is null then raise exception 'Pedido inexistente'; end if;
  select coalesce(sum(p.amount),0) into v_paid from public.payments p where p.company_id=p_company_id and p.order_id=p_order_id;
  if v_paid>0 then raise exception 'El pedido tiene pagos registrados. Antes de cancelarlo se debe gestionar la devolución/ajuste de caja.'; end if;
  update public.orders set status='cancelled',updated_by=auth.uid(),updated_at=now() where company_id=p_company_id and id=p_order_id;
  insert into public.activity_logs(company_id,user_id,action,entity_type,entity_id,description)
  values(p_company_id,auth.uid(),'order.cancelled','order',p_order_id::text,'Pedido #'||lpad(v_number::text,5,'0')||' cancelado');
end;
$$;
grant execute on function public.cancel_order_safe(uuid,uuid) to authenticated;
