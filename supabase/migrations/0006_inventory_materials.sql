-- GestArt ETAPA 7
-- Materiales, inventario, stock transaccional y trazabilidad por pedido.

-- =========================================================
-- PERMISOS
-- =========================================================

insert into public.permissions(code, description) values
  ('inventory.read', 'Ver materiales e inventario'),
  ('inventory.write', 'Crear materiales y registrar movimientos de stock')
on conflict(code) do update set description = excluded.description;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('inventory.read','inventory.write')
where r.code = 'admin' or lower(r.name) = 'administrador'
on conflict do nothing;

-- Producción puede consultar y consumir materiales.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('inventory.read','inventory.write')
where r.code = 'production'
on conflict do nothing;



-- Actualizamos el rol automático de Producción para empresas creadas después
-- de esta etapa: también podrá registrar consumos de materiales.
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
  where p.code in (
    'orders.read',
    'clients.read',
    'production.read',
    'production.write',
    'inventory.read',
    'inventory.write'
  )
  on conflict do nothing;

  return new;
end;
$$;


-- =========================================================
-- ESTRUCTURA BASE FALTANTE PARA INVENTARIO
-- =========================================================

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

alter table public.company_settings
  add column if not exists allow_negative_stock boolean not null default false;

alter table public.materials
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists location text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.stock_movements
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;

-- =========================================================
-- AMPLIACIÓN DE MATERIALES Y MOVIMIENTOS
-- =========================================================

alter table public.materials
  add column if not exists is_active boolean not null default true;

alter table public.stock_movements
  add column if not exists unit_cost numeric(14,2),
  add column if not exists balance_after numeric(14,3),
  add column if not exists notes text;

create index if not exists materials_company_active_idx
  on public.materials(company_id, is_active, name);

create index if not exists materials_company_stock_idx
  on public.materials(company_id, current_stock, minimum_stock);

create index if not exists stock_movements_material_created_idx
  on public.stock_movements(company_id, material_id, created_at desc);

-- Consumo productivo: una salida de stock vinculada a un pedido puede
-- quedar relacionada con el job de producción correspondiente.
create table if not exists public.production_material_usage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  production_job_id uuid references public.production_jobs(id) on delete set null,
  order_id uuid not null references public.orders(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  stock_movement_id uuid not null unique references public.stock_movements(id) on delete cascade,
  quantity numeric(14,3) not null check (quantity > 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists production_material_usage_order_idx
  on public.production_material_usage(company_id, order_id, created_at desc);

alter table public.production_material_usage enable row level security;

drop policy if exists production_material_usage_select on public.production_material_usage;
create policy production_material_usage_select
on public.production_material_usage for select
using (
  public.has_company_permission(company_id,'inventory.read')
  or public.has_company_permission(company_id,'production.read')
);

drop policy if exists production_material_usage_insert on public.production_material_usage;
create policy production_material_usage_insert
on public.production_material_usage for insert
with check (
  public.has_company_permission(company_id,'inventory.write')
  or public.has_company_permission(company_id,'production.write')
);

-- =========================================================
-- RLS ENDURECIDO
-- =========================================================

drop policy if exists materials_tenant_select on public.materials;
drop policy if exists materials_tenant_insert on public.materials;
drop policy if exists materials_tenant_update on public.materials;
drop policy if exists materials_tenant_delete on public.materials;

drop policy if exists materials_inventory_select on public.materials;
create policy materials_inventory_select
on public.materials for select
using (
  public.has_company_permission(company_id,'inventory.read')
  or public.has_company_permission(company_id,'inventory.write')
);

drop policy if exists materials_inventory_insert on public.materials;
create policy materials_inventory_insert
on public.materials for insert
with check (public.has_company_permission(company_id,'inventory.write'));

drop policy if exists materials_inventory_update on public.materials;
create policy materials_inventory_update
on public.materials for update
using (public.has_company_permission(company_id,'inventory.write'))
with check (public.has_company_permission(company_id,'inventory.write'));

drop policy if exists materials_inventory_delete on public.materials;
create policy materials_inventory_delete
on public.materials for delete
using (public.has_company_permission(company_id,'inventory.write'));

drop policy if exists stock_movements_tenant_select on public.stock_movements;
drop policy if exists stock_movements_tenant_insert on public.stock_movements;
drop policy if exists stock_movements_tenant_update on public.stock_movements;
drop policy if exists stock_movements_tenant_delete on public.stock_movements;

drop policy if exists stock_movements_inventory_select on public.stock_movements;
create policy stock_movements_inventory_select
on public.stock_movements for select
using (
  public.has_company_permission(company_id,'inventory.read')
  or public.has_company_permission(company_id,'inventory.write')
);

-- Los movimientos se insertan mediante RPC transaccional.
drop policy if exists stock_movements_inventory_insert on public.stock_movements;
create policy stock_movements_inventory_insert
on public.stock_movements for insert
with check (public.has_company_permission(company_id,'inventory.write'));

-- No se editan ni borran movimientos históricos desde la app.

-- Suppliers: lectura para cualquier miembro operativo, escritura por inventario.
drop policy if exists suppliers_tenant_select on public.suppliers;
drop policy if exists suppliers_tenant_insert on public.suppliers;
drop policy if exists suppliers_tenant_update on public.suppliers;
drop policy if exists suppliers_tenant_delete on public.suppliers;

drop policy if exists suppliers_inventory_select on public.suppliers;
create policy suppliers_inventory_select
on public.suppliers for select
using (public.is_company_member(company_id));

drop policy if exists suppliers_inventory_insert on public.suppliers;
create policy suppliers_inventory_insert
on public.suppliers for insert
with check (
  public.has_company_permission(company_id,'inventory.write')
  or public.has_company_permission(company_id,'company.manage')
);

drop policy if exists suppliers_inventory_update on public.suppliers;
create policy suppliers_inventory_update
on public.suppliers for update
using (
  public.has_company_permission(company_id,'inventory.write')
  or public.has_company_permission(company_id,'company.manage')
)
with check (
  public.has_company_permission(company_id,'inventory.write')
  or public.has_company_permission(company_id,'company.manage')
);

-- =========================================================
-- VISTA / RPC DE INVENTARIO
-- =========================================================

drop function if exists public.get_inventory_overview(uuid);
create or replace function public.get_inventory_overview(p_company_id uuid)
returns table (
  material_count bigint,
  low_stock_count bigint,
  inventory_value numeric,
  movements_today bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_company_permission(p_company_id,'inventory.read')
    or public.has_company_permission(p_company_id,'inventory.write')
  ) then
    raise exception 'No tenés permiso para ver inventario';
  end if;

  return query
  select
    (select count(*) from public.materials m
      where m.company_id = p_company_id and m.is_active = true),
    (select count(*) from public.materials m
      where m.company_id = p_company_id
        and m.is_active = true
        and m.current_stock <= m.minimum_stock),
    (select coalesce(sum(m.current_stock * m.unit_cost),0)
      from public.materials m
      where m.company_id = p_company_id and m.is_active = true),
    (select count(*) from public.stock_movements sm
      where sm.company_id = p_company_id
        and sm.created_at >= date_trunc('day', now()));
end;
$$;

grant execute on function public.get_inventory_overview(uuid) to authenticated;

drop function if exists public.get_inventory_materials(uuid,text,text,text);
create or replace function public.get_inventory_materials(
  p_company_id uuid,
  p_search text default null,
  p_category text default null,
  p_stock_status text default null
)
returns table (
  id uuid,
  code text,
  name text,
  category text,
  unit text,
  current_stock numeric,
  minimum_stock numeric,
  unit_cost numeric,
  inventory_value numeric,
  location text,
  notes text,
  supplier_id uuid,
  supplier_name text,
  is_active boolean,
  stock_status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_company_permission(p_company_id,'inventory.read')
    or public.has_company_permission(p_company_id,'inventory.write')
  ) then
    raise exception 'No tenés permiso para ver inventario';
  end if;

  return query
  select
    m.id,
    m.code,
    m.name,
    m.category,
    m.unit,
    m.current_stock,
    m.minimum_stock,
    m.unit_cost,
    (m.current_stock * m.unit_cost) as inventory_value,
    m.location,
    m.notes,
    m.supplier_id,
    s.name,
    m.is_active,
    case when m.current_stock <= m.minimum_stock then 'low' else 'ok' end,
    m.updated_at
  from public.materials m
  left join public.suppliers s
    on s.id = m.supplier_id and s.company_id = m.company_id
  where m.company_id = p_company_id
    and (
      p_stock_status = 'inactive'
      or m.is_active = true
    )
    and (
      nullif(trim(p_search),'') is null
      or m.name ilike '%' || trim(p_search) || '%'
      or coalesce(m.code,'') ilike '%' || trim(p_search) || '%'
      or coalesce(m.category,'') ilike '%' || trim(p_search) || '%'
      or coalesce(s.name,'') ilike '%' || trim(p_search) || '%'
      or coalesce(m.location,'') ilike '%' || trim(p_search) || '%'
    )
    and (nullif(trim(p_category),'') is null or m.category = p_category)
    and (
      nullif(trim(p_stock_status),'') is null
      or (p_stock_status = 'low' and m.is_active = true and m.current_stock <= m.minimum_stock)
      or (p_stock_status = 'ok' and m.is_active = true and m.current_stock > m.minimum_stock)
      or (p_stock_status = 'inactive' and m.is_active = false)
    )
  order by
    case when m.is_active and m.current_stock <= m.minimum_stock then 0 else 1 end,
    m.is_active desc,
    m.name;
end;
$$;

grant execute on function public.get_inventory_materials(uuid,text,text,text)
to authenticated;

drop function if exists public.get_material_movements(uuid,uuid);
create or replace function public.get_material_movements(
  p_company_id uuid,
  p_material_id uuid
)
returns table (
  id uuid,
  movement_type text,
  quantity numeric,
  reason text,
  unit_cost numeric,
  balance_after numeric,
  notes text,
  order_id uuid,
  order_number bigint,
  supplier_id uuid,
  supplier_name text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_company_permission(p_company_id,'inventory.read')
    or public.has_company_permission(p_company_id,'inventory.write')
  ) then
    raise exception 'No tenés permiso para ver inventario';
  end if;

  if not exists (
    select 1 from public.materials m
    where m.id = p_material_id and m.company_id = p_company_id
  ) then
    raise exception 'Material inexistente o fuera de la empresa';
  end if;

  return query
  select
    sm.id,
    sm.movement_type,
    sm.quantity,
    sm.reason,
    sm.unit_cost,
    sm.balance_after,
    sm.notes,
    sm.order_id,
    o.order_number,
    sm.supplier_id,
    s.name,
    sm.created_by,
    coalesce(nullif(trim(pr.full_name),''), 'Usuario'),
    sm.created_at
  from public.stock_movements sm
  left join public.orders o
    on o.id = sm.order_id and o.company_id = sm.company_id
  left join public.suppliers s
    on s.id = sm.supplier_id and s.company_id = sm.company_id
  left join public.profiles pr
    on pr.user_id = sm.created_by
  where sm.company_id = p_company_id
    and sm.material_id = p_material_id
  order by sm.created_at desc
  limit 200;
end;
$$;

grant execute on function public.get_material_movements(uuid,uuid)
to authenticated;

-- =========================================================
-- MOVIMIENTO TRANSACCIONAL
-- =========================================================

drop function if exists public.record_stock_movement(uuid,uuid,text,numeric,text,numeric,uuid,uuid,text);
create or replace function public.record_stock_movement(
  p_company_id uuid,
  p_material_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_reason text,
  p_unit_cost numeric default null,
  p_order_id uuid default null,
  p_supplier_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_material public.materials%rowtype;
  v_delta numeric(14,3);
  v_new_stock numeric(14,3);
  v_allow_negative boolean := false;
  v_movement_id uuid;
  v_job_id uuid;
begin
  if not public.has_company_permission(p_company_id,'inventory.write') then
    raise exception 'No tenés permiso para modificar inventario';
  end if;

  if p_movement_type not in ('in','out','adjustment') then
    raise exception 'Tipo de movimiento inválido';
  end if;

  if p_quantity is null or p_quantity = 0 then
    raise exception 'La cantidad no puede ser cero';
  end if;

  if nullif(trim(p_reason),'') is null then
    raise exception 'El movimiento necesita un motivo';
  end if;

  select *
  into v_material
  from public.materials
  where id = p_material_id
    and company_id = p_company_id
  for update;

  if not found then
    raise exception 'Material inexistente o fuera de la empresa';
  end if;

  if not v_material.is_active then
    raise exception 'El material está archivado';
  end if;

  if p_order_id is not null and not exists (
    select 1 from public.orders o
    where o.id = p_order_id and o.company_id = p_company_id
  ) then
    raise exception 'El pedido no pertenece a esta empresa';
  end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers s
    where s.id = p_supplier_id and s.company_id = p_company_id
  ) then
    raise exception 'El proveedor no pertenece a esta empresa';
  end if;

  v_delta := case
    when p_movement_type = 'in' then abs(p_quantity)
    when p_movement_type = 'out' then -abs(p_quantity)
    else p_quantity
  end;

  v_new_stock := v_material.current_stock + v_delta;

  select coalesce(cs.allow_negative_stock,false)
  into v_allow_negative
  from public.company_settings cs
  where cs.company_id = p_company_id;

  if v_new_stock < 0 and not v_allow_negative then
    raise exception 'Stock insuficiente. Disponible: % %', v_material.current_stock, v_material.unit;
  end if;

  update public.materials
  set current_stock = v_new_stock,
      unit_cost = case
        when p_movement_type = 'in' and p_unit_cost is not null and p_unit_cost >= 0
          then p_unit_cost
        else unit_cost
      end,
      supplier_id = case
        when p_movement_type = 'in' and p_supplier_id is not null
          then p_supplier_id
        else supplier_id
      end,
      updated_at = now()
  where id = p_material_id and company_id = p_company_id;

  insert into public.stock_movements(
    company_id,
    material_id,
    movement_type,
    quantity,
    reason,
    order_id,
    supplier_id,
    unit_cost,
    balance_after,
    notes,
    created_by,
    created_at
  )
  values(
    p_company_id,
    p_material_id,
    p_movement_type,
    v_delta,
    trim(p_reason),
    p_order_id,
    p_supplier_id,
    coalesce(p_unit_cost, v_material.unit_cost),
    v_new_stock,
    nullif(trim(coalesce(p_notes,'')),''),
    auth.uid(),
    now()
  )
  returning id into v_movement_id;

  if v_delta < 0 and p_order_id is not null then
    select pj.id
    into v_job_id
    from public.production_jobs pj
    where pj.company_id = p_company_id
      and pj.order_id = p_order_id
    limit 1;

    insert into public.production_material_usage(
      company_id,
      production_job_id,
      order_id,
      material_id,
      stock_movement_id,
      quantity,
      created_by
    )
    values(
      p_company_id,
      v_job_id,
      p_order_id,
      p_material_id,
      v_movement_id,
      abs(v_delta),
      auth.uid()
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
    p_company_id,
    auth.uid(),
    'stock.movement',
    'material',
    p_material_id::text,
    case
      when v_delta > 0 then 'Entrada de stock: ' || v_material.name
      else 'Salida de stock: ' || v_material.name
    end,
    jsonb_build_object(
      'movement_id', v_movement_id,
      'movement_type', p_movement_type,
      'quantity', v_delta,
      'balance_after', v_new_stock,
      'reason', trim(p_reason),
      'order_id', p_order_id
    )
  );

  return v_movement_id;
end;
$$;

grant execute on function public.record_stock_movement(uuid,uuid,text,numeric,text,numeric,uuid,uuid,text)
to authenticated;

-- =========================================================
-- AUDITORÍA DE ALTA / EDICIÓN DE MATERIAL
-- =========================================================

create or replace function public.audit_material_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs(
      company_id,user_id,action,entity_type,entity_id,description,metadata
    ) values (
      new.company_id,auth.uid(),'material.created','material',new.id::text,
      'Material creado: ' || new.name,
      jsonb_build_object('code',new.code,'unit',new.unit)
    );
    return new;
  end if;

  insert into public.activity_logs(
    company_id,user_id,action,entity_type,entity_id,description,metadata
  ) values (
    new.company_id,auth.uid(),
    case when old.is_active = true and new.is_active = false then 'material.archived'
         when old.is_active = false and new.is_active = true then 'material.restored'
         else 'material.updated' end,
    'material',new.id::text,
    case when old.is_active = true and new.is_active = false then 'Material archivado: ' || new.name
         when old.is_active = false and new.is_active = true then 'Material restaurado: ' || new.name
         else 'Material actualizado: ' || new.name end,
    '{}'::jsonb
  );
  return new;
end;
$$;

drop trigger if exists materials_audit_change on public.materials;
create trigger materials_audit_change
after insert or update on public.materials
for each row execute function public.audit_material_change();

-- Backfill balance_after para movimientos viejos: se deja null si no puede
-- reconstruirse con certeza. Los nuevos movimientos siempre guardan saldo.
