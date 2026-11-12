-- =============================================================
-- GestArt ETAPA 18
-- Bar: porciones por botella ("cada 5 vasos se descuenta 1 Fernet")
-- y vasos por proporción (0,75 litros de cerveza tirada).
-- Ejecutar después de 0018_composite_products.sql. Es idempotente.
-- =============================================================

-- Un producto puede declarar cuántas porciones rinde cada unidad (botella, caja, barril).
-- El stock se sigue llevando en unidades enteras; la botella se descuenta recién
-- cuando se consumió la última porción.
alter table public.products
  add column if not exists portions_per_unit numeric(14,3),
  add column if not exists portion_name text,
  add column if not exists portions_used numeric(14,3) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_portions_per_unit_check') then
    alter table public.products
      add constraint products_portions_per_unit_check
      check (portions_per_unit is null or portions_per_unit > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_portions_used_check') then
    alter table public.products
      add constraint products_portions_used_check check (portions_used >= 0);
  end if;
end $$;

-- En cada componente: la cantidad puede ser en unidades enteras o en porciones.
alter table public.product_components
  add column if not exists measure text not null default 'unit';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_components_measure_check') then
    alter table public.product_components
      add constraint product_components_measure_check check (measure in ('unit','portion'));
  end if;
end $$;

-- Registro de porciones consumidas por cada venta (para poder anularla bien)
create table if not exists public.sale_portion_usage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  portions numeric(14,3) not null check (portions > 0),
  bottles_deducted numeric(14,3) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists sale_portion_usage_sale_idx on public.sale_portion_usage (sale_id);

alter table public.sale_portion_usage enable row level security;
drop policy if exists sale_portion_usage_select on public.sale_portion_usage;
create policy sale_portion_usage_select on public.sale_portion_usage for select
  using (public.has_company_permission(company_id,'sales.read'));

-- -------------------------------------------------------------
-- set_product_components: ahora acepta "measure" ('unit' | 'portion')
-- -------------------------------------------------------------
create or replace function public.set_product_components(
  p_company_id uuid,
  p_product_id uuid,
  p_components jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.products%rowtype;
  v_item jsonb;
  v_comp public.products%rowtype;
  v_qty numeric;
  v_measure text;
  v_ids uuid[] := array[]::uuid[];
begin
  if not (
    public.has_company_permission(p_company_id,'recipes.write')
    or public.has_company_permission(p_company_id,'products.write')
  ) then
    raise exception 'No tenés permiso para modificar composiciones';
  end if;

  select * into v_prod from public.products
  where id = p_product_id and company_id = p_company_id for update;
  if not found then raise exception 'Producto inexistente'; end if;

  if p_components is null or jsonb_typeof(p_components) <> 'array' then
    raise exception 'Lista de componentes inválida';
  end if;

  if jsonb_array_length(p_components) > 0 and exists (
    select 1 from public.product_components pc
    where pc.component_id = p_product_id and pc.company_id = p_company_id
  ) then
    raise exception 'Este producto ya es componente de otro; no puede ser compuesto a la vez';
  end if;

  delete from public.product_components
  where product_id = p_product_id and company_id = p_company_id;

  for v_item in select * from jsonb_array_elements(p_components) loop
    select * into v_comp from public.products
    where id = (v_item->>'component_id')::uuid and company_id = p_company_id and is_active;
    if not found then raise exception 'Componente inexistente o archivado'; end if;
    if v_comp.id = p_product_id then raise exception 'Un producto no puede componerse a sí mismo'; end if;
    if v_comp.is_composite then
      raise exception '«%» ya es un producto compuesto y no puede usarse como componente', v_comp.name;
    end if;
    if v_comp.id = any(v_ids) then raise exception '«%» está repetido', v_comp.name; end if;
    v_ids := v_ids || v_comp.id;

    v_measure := coalesce(nullif(v_item->>'measure',''),'unit');
    if v_measure not in ('unit','portion') then v_measure := 'unit'; end if;
    if v_measure = 'portion' and v_comp.portions_per_unit is null then
      raise exception '«%» no tiene definido cuántas porciones rinde. Cargalo en Productos.', v_comp.name;
    end if;

    v_qty := round((v_item->>'quantity')::numeric, 3);
    if v_qty is null or v_qty <= 0 then
      raise exception 'Indicá una cantidad válida para «%» (hasta 3 decimales)', v_comp.name;
    end if;

    insert into public.product_components(company_id, product_id, component_id, quantity, measure)
    values (p_company_id, p_product_id, v_comp.id, v_qty, v_measure);
  end loop;

  update public.products
  set is_composite = (jsonb_array_length(p_components) > 0)
  where id = p_product_id;

  insert into public.activity_logs(company_id,user_id,action,entity_type,entity_id,description,metadata)
  values (p_company_id, auth.uid(), 'product.composition', 'product', p_product_id::text,
          'Composición de producto actualizada',
          jsonb_build_object('components', p_components));
end;
$$;
grant execute on function public.set_product_components(uuid,uuid,jsonb) to authenticated;

-- -------------------------------------------------------------
-- create_sale: suma la lógica de porciones (misma firma)
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
  v_cp public.products%rowtype;
  v_comp record;
  v_qty numeric;
  v_need numeric;
  v_portions numeric;
  v_pending numeric;
  v_bottles numeric;
  v_unit_cost numeric(14,4);
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
    if not v_prod.is_for_sale then
      raise exception '% es un insumo y no se vende directamente', v_prod.name;
    end if;

    v_unit_cost := v_prod.cost;

    if v_prod.is_composite then
      v_unit_cost := 0;
      for v_comp in
        select pc.component_id, pc.quantity, pc.measure
        from public.product_components pc
        where pc.product_id = v_prod.id and pc.company_id = p_company_id
        order by pc.component_id
      loop
        select * into v_cp from public.products
        where id = v_comp.component_id and company_id = p_company_id for update;
        if not found then raise exception 'Falta un componente de %', v_prod.name; end if;

        if v_comp.measure = 'portion' and v_cp.portions_per_unit is not null then
          -- Descuento por porciones: la botella se descuenta al consumir la última porción
          v_unit_cost := v_unit_cost + (v_cp.cost / v_cp.portions_per_unit) * v_comp.quantity;
          v_portions := round(v_comp.quantity * v_qty, 3);
          v_pending := v_cp.portions_used + v_portions;

          if v_cp.track_stock and v_pending > v_cp.stock * v_cp.portions_per_unit then
            raise exception 'Stock insuficiente de % para preparar % (quedan % porciones, necesita %)',
              v_cp.name, v_prod.name,
              round(v_cp.stock * v_cp.portions_per_unit - v_cp.portions_used, 2), v_portions;
          end if;

          v_bottles := floor(v_pending / v_cp.portions_per_unit);
          update public.products
          set portions_used = v_pending - v_bottles * v_cp.portions_per_unit,
              stock = case when track_stock then stock - v_bottles else stock end
          where id = v_cp.id;

          insert into public.sale_portion_usage(company_id,sale_id,product_id,portions,bottles_deducted)
          values (p_company_id, v_sale_id, v_cp.id, v_portions, v_bottles);

          if v_cp.track_stock and v_bottles > 0 then
            insert into public.product_stock_movements(
              company_id,product_id,movement_type,quantity,balance_after,reason,sale_id,created_by
            ) values (
              p_company_id,v_cp.id,'out',-v_bottles,v_cp.stock - v_bottles,
              'Venta #'||v_number||' · '||v_prod.name||' (envase terminado)',v_sale_id,auth.uid()
            );
          end if;
        else
          -- Descuento directo en la unidad del componente
          v_unit_cost := v_unit_cost + (v_cp.cost * v_comp.quantity);
          v_need := round(v_comp.quantity * v_qty, 3);

          if v_cp.track_stock then
            if v_cp.stock < v_need then
              raise exception 'Stock insuficiente de % para preparar % (disponible: %, necesita: %)',
                v_cp.name, v_prod.name, v_cp.stock, v_need;
            end if;
            v_new_stock := v_cp.stock - v_need;
            update public.products set stock = v_new_stock where id = v_cp.id;
            insert into public.product_stock_movements(
              company_id,product_id,movement_type,quantity,balance_after,reason,sale_id,created_by
            ) values (
              p_company_id,v_cp.id,'sale',-v_need,v_new_stock,
              'Venta #'||v_number||' · '||v_prod.name,v_sale_id,auth.uid()
            );
          end if;
        end if;
      end loop;
    elsif v_prod.track_stock then
      if v_prod.stock < v_qty then
        raise exception 'Stock insuficiente de % (disponible: %)', v_prod.name, v_prod.stock;
      end if;
      v_new_stock := v_prod.stock - v_qty;
      update public.products set stock = v_new_stock where id = v_prod.id;
      insert into public.product_stock_movements(
        company_id,product_id,movement_type,quantity,balance_after,reason,sale_id,created_by
      ) values (
        p_company_id,v_prod.id,'sale',-v_qty,v_new_stock,'Venta #'||v_number,v_sale_id,auth.uid()
      );
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
      p_company_id,v_sale_id,v_prod.id,v_prod.name,v_prod.sale_price,round(v_unit_cost,2),v_qty,
      v_dtype,v_dval,v_disc,v_line,v_line - v_disc
    );

    v_subtotal  := v_subtotal  + v_line;
    v_item_disc := v_item_disc + v_disc;
    v_cost      := v_cost      + round(v_unit_cost * v_qty, 2);
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
-- cancel_sale: además devuelve las porciones consumidas (misma firma)
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
  v_mv record;
  v_pu record;
  v_prod public.products%rowtype;
  v_new numeric;
  v_total numeric;
  v_k numeric;
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

  -- 1) Stock descontado directamente (productos simples y componentes por unidad)
  for v_mv in
    select pm.product_id, sum(-pm.quantity) as qty
    from public.product_stock_movements pm
    where pm.company_id = p_company_id
      and pm.sale_id = v_sale.id
      and pm.movement_type = 'sale'
    group by pm.product_id
    order by pm.product_id
  loop
    select * into v_prod from public.products
    where id = v_mv.product_id and company_id = p_company_id for update;
    continue when not found;
    v_new := v_prod.stock + v_mv.qty;
    update public.products set stock = v_new where id = v_prod.id;
    insert into public.product_stock_movements(
      company_id,product_id,movement_type,quantity,balance_after,reason,sale_id,created_by
    ) values (
      p_company_id,v_prod.id,'return',v_mv.qty,v_new,
      'Anulación venta #'||v_sale.sale_number,v_sale.id,auth.uid()
    );
  end loop;

  -- 2) Porciones consumidas: se devuelven y, si hace falta, se recupera un envase entero
  for v_pu in
    select spu.product_id, sum(spu.portions) as portions
    from public.sale_portion_usage spu
    where spu.company_id = p_company_id and spu.sale_id = v_sale.id
    group by spu.product_id
    order by spu.product_id
  loop
    select * into v_prod from public.products
    where id = v_pu.product_id and company_id = p_company_id for update;
    continue when not found or v_prod.portions_per_unit is null;

    v_total := v_prod.portions_used - v_pu.portions;
    if v_total >= 0 then
      update public.products set portions_used = v_total where id = v_prod.id;
    else
      v_k := ceil((-v_total) / v_prod.portions_per_unit);
      update public.products
      set portions_used = v_total + v_k * v_prod.portions_per_unit,
          stock = case when track_stock then stock + v_k else stock end
      where id = v_prod.id;
      if v_prod.track_stock then
        insert into public.product_stock_movements(
          company_id,product_id,movement_type,quantity,balance_after,reason,sale_id,created_by
        ) values (
          p_company_id,v_prod.id,'return',v_k,v_prod.stock + v_k,
          'Anulación venta #'||v_sale.sale_number||' (envase recuperado)',v_sale.id,auth.uid()
        );
      end if;
    end if;
  end loop;

  -- 3) Caja
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
