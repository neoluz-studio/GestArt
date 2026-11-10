-- =============================================================
-- GestArt ETAPA 15
-- Módulos: Productos, Ventas (punto de venta) y Recetas / costeo
-- Basado en el sistema "Lo de Fausti", adaptado a multiempresa.
-- Ejecutar después de 0015_order_payment_cash_link.sql
-- Es idempotente: se puede ejecutar más de una vez.
-- =============================================================

create extension if not exists pgcrypto;

-- -------------------------------------------------------------
-- 1) Módulos nuevos (se activan por empresa desde Configuración)
-- -------------------------------------------------------------
insert into public.modules(code, default_label, default_icon, is_core) values
  ('products', 'Productos',         'boxes',    false),
  ('sales',    'Ventas',            'money',    false),
  ('recipes',  'Recetas y costeo',  'database', false)
on conflict (code) do nothing;

-- Empresas existentes: los módulos aparecen DESACTIVADOS.
-- Cada empresa los activa en Configuración > Navegación.
insert into public.company_modules(company_id, module_id, enabled, sort_order)
select
  c.id,
  m.id,
  false,
  coalesce((select max(cm.sort_order) from public.company_modules cm where cm.company_id = c.id), 0)
    + (row_number() over (partition by c.id order by m.code))::int
from public.companies c
cross join public.modules m
where m.code in ('products', 'sales', 'recipes')
on conflict (company_id, module_id) do nothing;

-- -------------------------------------------------------------
-- 2) Permisos nuevos
-- -------------------------------------------------------------
insert into public.permissions(code, description) values
  ('products.read',  'Ver productos'),
  ('products.write', 'Crear y modificar productos y stock'),
  ('sales.read',     'Ver ventas'),
  ('sales.write',    'Registrar y anular ventas'),
  ('recipes.read',   'Ver recetas'),
  ('recipes.write',  'Crear y modificar recetas')
on conflict (code) do nothing;

-- Los administradores existentes reciben los permisos nuevos.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.code = 'admin'
  and p.code in ('products.read','products.write','sales.read','sales.write','recipes.read','recipes.write')
on conflict do nothing;

-- -------------------------------------------------------------
-- 3) Utilidad: updated_at automático
-- -------------------------------------------------------------
create or replace function public.touch_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -------------------------------------------------------------
-- 4) Productos
-- -------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text,
  name text not null,
  category text,
  unit text not null default 'unidad',
  sale_price numeric(14,2) not null default 0 check (sale_price >= 0),
  cost numeric(14,2) not null default 0 check (cost >= 0),
  stock numeric(14,3) not null default 0 check (stock >= 0),
  min_stock numeric(14,3) not null default 0 check (min_stock >= 0),
  track_stock boolean not null default true,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists products_company_name_active_uidx
  on public.products (company_id, lower(name)) where is_active;
create unique index if not exists products_company_code_uidx
  on public.products (company_id, lower(code)) where code is not null and code <> '';
create index if not exists products_company_idx
  on public.products (company_id, is_active, name);

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
for each row execute function public.touch_row_updated_at();

create table if not exists public.product_stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  movement_type text not null check (movement_type in ('in','out','adjustment','sale','return')),
  quantity numeric(14,3) not null check (quantity <> 0),   -- con signo: + entra, - sale
  balance_after numeric(14,3) not null,
  reason text not null,
  sale_id uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists product_stock_movements_idx
  on public.product_stock_movements (company_id, product_id, created_at desc);

-- -------------------------------------------------------------
-- 5) Ventas
-- -------------------------------------------------------------
alter table public.company_counters
  add column if not exists next_sale_number bigint not null default 1;

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sale_number bigint not null,
  sold_at timestamptz not null default now(),
  status text not null default 'completed' check (status in ('completed','cancelled')),
  payment_method_id uuid references public.payment_methods(id),
  client_id uuid references public.clients(id) on delete set null,
  subtotal numeric(14,2) not null default 0,
  item_discount numeric(14,2) not null default 0,
  cart_discount numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  cost_total numeric(14,2) not null default 0,
  profit numeric(14,2) not null default 0,
  notes text,
  created_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancel_reason text,
  unique (company_id, sale_number)
);
create index if not exists sales_company_sold_idx
  on public.sales (company_id, sold_at desc);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  unit_price numeric(14,2) not null,
  unit_cost numeric(14,2) not null default 0,
  quantity numeric(14,3) not null check (quantity > 0),
  discount_type text not null default 'percent' check (discount_type in ('percent','amount')),
  discount_value numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  subtotal numeric(14,2) not null,
  total numeric(14,2) not null
);
create index if not exists sale_items_sale_idx on public.sale_items (sale_id);

-- Vínculo caja <-> venta
alter table public.cash_movements
  add column if not exists sale_id uuid references public.sales(id) on delete set null;
create index if not exists cash_movements_company_sale_idx
  on public.cash_movements (company_id, sale_id);

-- -------------------------------------------------------------
-- 6) Recetas / costeo
-- -------------------------------------------------------------
create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  final_quantity numeric(14,3) not null default 1 check (final_quantity > 0),
  final_unit text not null default 'unidad',
  sale_price numeric(14,2) not null default 0 check (sale_price >= 0),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recipes_company_idx on public.recipes (company_id, name);

drop trigger if exists recipes_touch on public.recipes;
create trigger recipes_touch before update on public.recipes
for each row execute function public.touch_row_updated_at();

create table if not exists public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  name text not null,
  purchase_price numeric(14,2) not null default 0 check (purchase_price >= 0),
  purchase_quantity numeric(14,3) not null default 1 check (purchase_quantity > 0),
  purchase_unit text not null default 'unidad',
  used_quantity numeric(14,3) not null default 0 check (used_quantity >= 0),
  used_unit text not null default 'unidad',
  created_at timestamptz not null default now()
);
create index if not exists recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id);

-- -------------------------------------------------------------
-- 7) RLS
-- -------------------------------------------------------------
alter table public.products               enable row level security;
alter table public.product_stock_movements enable row level security;
alter table public.sales                  enable row level security;
alter table public.sale_items             enable row level security;
alter table public.recipes                enable row level security;
alter table public.recipe_ingredients     enable row level security;

-- Productos: lectura para quien ve productos o vende; escritura sólo products.write
drop policy if exists products_select on public.products;
create policy products_select on public.products for select using (
  public.has_company_permission(company_id,'products.read')
  or public.has_company_permission(company_id,'sales.write')
  or public.has_company_permission(company_id,'sales.read')
);
drop policy if exists products_insert on public.products;
create policy products_insert on public.products for insert
  with check (public.has_company_permission(company_id,'products.write'));
drop policy if exists products_update on public.products;
create policy products_update on public.products for update
  using (public.has_company_permission(company_id,'products.write'))
  with check (public.has_company_permission(company_id,'products.write'));
-- Sin policy de delete: los productos se archivan (is_active = false).

-- Movimientos de stock: sólo lectura; se escriben por RPC
drop policy if exists product_stock_movements_select on public.product_stock_movements;
create policy product_stock_movements_select on public.product_stock_movements for select using (
  public.has_company_permission(company_id,'products.read')
  or public.has_company_permission(company_id,'sales.read')
);

-- Ventas e ítems: sólo lectura; se escriben por RPC
drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales for select
  using (public.has_company_permission(company_id,'sales.read'));
drop policy if exists sale_items_select on public.sale_items;
create policy sale_items_select on public.sale_items for select
  using (public.has_company_permission(company_id,'sales.read'));

-- Recetas
drop policy if exists recipes_select on public.recipes;
create policy recipes_select on public.recipes for select
  using (public.has_company_permission(company_id,'recipes.read'));
drop policy if exists recipes_insert on public.recipes;
create policy recipes_insert on public.recipes for insert
  with check (public.has_company_permission(company_id,'recipes.write'));
drop policy if exists recipes_update on public.recipes;
create policy recipes_update on public.recipes for update
  using (public.has_company_permission(company_id,'recipes.write'))
  with check (public.has_company_permission(company_id,'recipes.write'));
drop policy if exists recipes_delete on public.recipes;
create policy recipes_delete on public.recipes for delete
  using (public.has_company_permission(company_id,'recipes.write'));

drop policy if exists recipe_ingredients_select on public.recipe_ingredients;
create policy recipe_ingredients_select on public.recipe_ingredients for select
  using (public.has_company_permission(company_id,'recipes.read'));
drop policy if exists recipe_ingredients_insert on public.recipe_ingredients;
create policy recipe_ingredients_insert on public.recipe_ingredients for insert
  with check (public.has_company_permission(company_id,'recipes.write'));
drop policy if exists recipe_ingredients_update on public.recipe_ingredients;
create policy recipe_ingredients_update on public.recipe_ingredients for update
  using (public.has_company_permission(company_id,'recipes.write'))
  with check (public.has_company_permission(company_id,'recipes.write'));
drop policy if exists recipe_ingredients_delete on public.recipe_ingredients;
create policy recipe_ingredients_delete on public.recipe_ingredients for delete
  using (public.has_company_permission(company_id,'recipes.write'));

-- -------------------------------------------------------------
-- 8) RPC: ajuste manual de stock de un producto
-- -------------------------------------------------------------
create or replace function public.adjust_product_stock(
  p_company_id uuid,
  p_product_id uuid,
  p_movement_type text,      -- 'in' | 'out' | 'adjustment' (fija el stock en p_quantity)
  p_quantity numeric,
  p_reason text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.products%rowtype;
  v_delta numeric;
  v_new numeric;
begin
  if not public.has_company_permission(p_company_id,'products.write') then
    raise exception 'No tenés permiso para modificar stock';
  end if;
  if p_movement_type not in ('in','out','adjustment') then
    raise exception 'Tipo de movimiento inválido';
  end if;
  if p_quantity is null or p_quantity < 0 or (p_movement_type <> 'adjustment' and p_quantity = 0) then
    raise exception 'Indicá una cantidad válida';
  end if;
  if length(trim(coalesce(p_reason,''))) < 3 then
    raise exception 'Indicá el motivo del movimiento';
  end if;

  select * into v_prod from public.products
  where id = p_product_id and company_id = p_company_id for update;
  if not found then raise exception 'Producto inexistente'; end if;

  v_delta := case p_movement_type
    when 'in' then p_quantity
    when 'out' then -p_quantity
    else p_quantity - v_prod.stock
  end;
  v_new := v_prod.stock + v_delta;
  if v_new < 0 then raise exception 'El stock no puede quedar negativo'; end if;
  if v_delta = 0 then return v_new; end if;

  update public.products set stock = v_new where id = v_prod.id;

  insert into public.product_stock_movements(
    company_id, product_id, movement_type, quantity, balance_after, reason, created_by
  ) values (
    p_company_id, v_prod.id, p_movement_type, v_delta, v_new, trim(p_reason), auth.uid()
  );

  insert into public.activity_logs(company_id,user_id,action,entity_type,entity_id,description,metadata)
  values (p_company_id, auth.uid(), 'product.stock', 'product', v_prod.id::text,
          'Movimiento de stock de producto',
          jsonb_build_object('type',p_movement_type,'delta',v_delta,'balance',v_new,'reason',trim(p_reason)));

  return v_new;
end;
$$;
grant execute on function public.adjust_product_stock(uuid,uuid,text,numeric,text) to authenticated;

-- -------------------------------------------------------------
-- 9) RPC: registrar venta (atómica)
--    Los precios y costos se leen de la base, no del navegador.
--    p_items: [{"product_id","quantity","discount_type","discount_value"}]
-- -------------------------------------------------------------
create or replace function public.create_sale(
  p_company_id uuid,
  p_items jsonb,
  p_payment_method_id uuid,
  p_cart_discount_type text default 'percent',
  p_cart_discount_value numeric default 0,
  p_client_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_number bigint;
  v_item jsonb;
  v_prod public.products%rowtype;
  v_qty numeric;
  v_dtype text;
  v_dval numeric;
  v_line numeric(14,2);
  v_disc numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_item_disc numeric(14,2) := 0;
  v_cost numeric(14,2) := 0;
  v_after_items numeric(14,2);
  v_cart_disc numeric(14,2) := 0;
  v_total numeric(14,2);
  v_new_stock numeric;
begin
  if not public.has_company_permission(p_company_id,'sales.write') then
    raise exception 'No tenés permiso para registrar ventas';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos';
  end if;
  if not exists (
    select 1 from public.payment_methods pm
    where pm.id = p_payment_method_id and pm.company_id = p_company_id and pm.enabled
  ) then
    raise exception 'Método de pago inválido';
  end if;
  if p_client_id is not null and not exists (
    select 1 from public.clients c where c.id = p_client_id and c.company_id = p_company_id
  ) then
    raise exception 'Cliente inválido';
  end if;

  insert into public.company_counters(company_id,next_order_number,next_sale_number)
  values (p_company_id,1,2)
  on conflict (company_id) do update
    set next_sale_number = public.company_counters.next_sale_number + 1,
        updated_at = now()
  returning next_sale_number - 1 into v_number;

  insert into public.sales(company_id,sale_number,payment_method_id,client_id,notes,created_by)
  values (p_company_id,v_number,p_payment_method_id,p_client_id,nullif(trim(coalesce(p_notes,'')),''),auth.uid())
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from public.products
    where id = (v_item->>'product_id')::uuid
      and company_id = p_company_id
      and is_active
    for update;
    if not found then raise exception 'Producto inexistente o archivado'; end if;

    v_qty := (v_item->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Cantidad inválida en %', v_prod.name; end if;
    if v_prod.track_stock and v_prod.stock < v_qty then
      raise exception 'Stock insuficiente de % (disponible: %)', v_prod.name, v_prod.stock;
    end if;

    v_dtype := coalesce(nullif(v_item->>'discount_type',''),'percent');
    if v_dtype not in ('percent','amount') then v_dtype := 'percent'; end if;
    v_dval := greatest(coalesce((v_item->>'discount_value')::numeric,0),0);

    v_line := round(v_prod.sale_price * v_qty, 2);
    v_disc := case when v_dtype = 'percent'
                   then round(v_line * least(v_dval,100) / 100, 2)
                   else least(v_dval, v_line) end;

    insert into public.sale_items(
      company_id,sale_id,product_id,name,unit_price,unit_cost,quantity,
      discount_type,discount_value,discount,subtotal,total
    ) values (
      p_company_id,v_sale_id,v_prod.id,v_prod.name,v_prod.sale_price,v_prod.cost,v_qty,
      v_dtype,v_dval,v_disc,v_line,v_line - v_disc
    );

    if v_prod.track_stock then
      v_new_stock := v_prod.stock - v_qty;
      update public.products set stock = v_new_stock where id = v_prod.id;
      insert into public.product_stock_movements(
        company_id,product_id,movement_type,quantity,balance_after,reason,sale_id,created_by
      ) values (
        p_company_id,v_prod.id,'sale',-v_qty,v_new_stock,'Venta #'||v_number,v_sale_id,auth.uid()
      );
    end if;

    v_subtotal  := v_subtotal  + v_line;
    v_item_disc := v_item_disc + v_disc;
    v_cost      := v_cost      + round(v_prod.cost * v_qty, 2);
  end loop;

  v_after_items := v_subtotal - v_item_disc;
  if p_cart_discount_type = 'amount' then
    v_cart_disc := least(greatest(coalesce(p_cart_discount_value,0),0), v_after_items);
  else
    v_cart_disc := round(v_after_items * least(greatest(coalesce(p_cart_discount_value,0),0),100) / 100, 2);
  end if;
  v_total := v_after_items - v_cart_disc;

  update public.sales set
    subtotal = v_subtotal,
    item_discount = v_item_disc,
    cart_discount = v_cart_disc,
    discount_total = v_item_disc + v_cart_disc,
    total = v_total,
    cost_total = v_cost,
    profit = v_total - v_cost
  where id = v_sale_id;

  if v_total > 0 then
    insert into public.cash_movements(
      company_id,movement_type,category,concept,amount,payment_method_id,
      client_id,reference,occurred_at,source,sale_id,created_by
    ) values (
      p_company_id,'income','sale','Venta #'||v_number,v_total,p_payment_method_id,
      p_client_id,'VTA-'||v_number,now(),'sale',v_sale_id,auth.uid()
    );
  end if;

  insert into public.activity_logs(company_id,user_id,action,entity_type,entity_id,description,metadata)
  values (p_company_id, auth.uid(), 'sale.created', 'sale', v_sale_id::text,
          'Venta #'||v_number||' registrada',
          jsonb_build_object('total',v_total,'items',jsonb_array_length(p_items)));

  return v_sale_id;
end;
$$;
grant execute on function public.create_sale(uuid,jsonb,uuid,text,numeric,uuid,text) to authenticated;

-- -------------------------------------------------------------
-- 10) RPC: anular venta (devuelve stock y revierte la caja)
-- -------------------------------------------------------------
create or replace function public.cancel_sale(
  p_company_id uuid,
  p_sale_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_item record;
  v_prod public.products%rowtype;
  v_new numeric;
  v_mov public.cash_movements%rowtype;
  v_rev uuid;
begin
  if not public.has_company_permission(p_company_id,'sales.write') then
    raise exception 'No tenés permiso para anular ventas';
  end if;
  if length(trim(coalesce(p_reason,''))) < 5 then
    raise exception 'Indicá el motivo de la anulación';
  end if;

  select * into v_sale from public.sales
  where id = p_sale_id and company_id = p_company_id for update;
  if not found then raise exception 'Venta inexistente'; end if;
  if v_sale.status <> 'completed' then raise exception 'La venta ya está anulada'; end if;

  for v_item in
    select si.product_id, si.quantity from public.sale_items si where si.sale_id = v_sale.id
  loop
    continue when v_item.product_id is null;
    select * into v_prod from public.products
    where id = v_item.product_id and company_id = p_company_id for update;
    continue when not found or not v_prod.track_stock;
    v_new := v_prod.stock + v_item.quantity;
    update public.products set stock = v_new where id = v_prod.id;
    insert into public.product_stock_movements(
      company_id,product_id,movement_type,quantity,balance_after,reason,sale_id,created_by
    ) values (
      p_company_id,v_prod.id,'return',v_item.quantity,v_new,
      'Anulación venta #'||v_sale.sale_number,v_sale.id,auth.uid()
    );
  end loop;

  for v_mov in
    select * from public.cash_movements
    where company_id = p_company_id and sale_id = v_sale.id
      and source = 'sale' and reversed_by_id is null
    for update
  loop
    insert into public.cash_movements(
      company_id,movement_type,category,concept,amount,payment_method_id,
      client_id,notes,reference,occurred_at,source,reversal_of_id,sale_id,created_by
    ) values (
      p_company_id,
      case when v_mov.movement_type='income' then 'expense' else 'income' end,
      'reversal','Anulación: '||v_mov.concept,v_mov.amount,v_mov.payment_method_id,
      v_mov.client_id,trim(p_reason),v_mov.reference,now(),'reversal',v_mov.id,v_sale.id,auth.uid()
    )
    returning id into v_rev;
    update public.cash_movements set reversed_by_id = v_rev where id = v_mov.id;
  end loop;

  update public.sales set
    status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
    cancel_reason = trim(p_reason)
  where id = v_sale.id;

  insert into public.activity_logs(company_id,user_id,action,entity_type,entity_id,description,metadata)
  values (p_company_id, auth.uid(), 'sale.cancelled', 'sale', v_sale.id::text,
          'Venta #'||v_sale.sale_number||' anulada',
          jsonb_build_object('reason',trim(p_reason),'total',v_sale.total));
end;
$$;
grant execute on function public.cancel_sale(uuid,uuid,text) to authenticated;
