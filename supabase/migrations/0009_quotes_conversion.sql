-- =============================================================
-- GestArt ETAPA 10
-- Presupuestos + conversión transaccional Presupuesto -> Pedido
-- Ejecutar después de 0008_history_audit.sql
-- =============================================================

-- -------------------------------------------------------------
-- Estructura
-- -------------------------------------------------------------

alter table public.quotes
  add column if not exists notes text,
  add column if not exists sent_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists converted_at timestamptz,
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

alter table public.quote_items
  add column if not exists sort_order integer not null default 0;

create index if not exists quotes_company_status_issue_idx
  on public.quotes(company_id, status, issue_date desc);

create index if not exists quotes_company_client_issue_idx
  on public.quotes(company_id, client_id, issue_date desc);

create index if not exists quote_items_company_quote_sort_idx
  on public.quote_items(company_id, quote_id, sort_order);

create unique index if not exists orders_company_source_quote_uidx
  on public.orders(company_id, source_quote_id)
  where source_quote_id is not null;

-- Normalizar timestamps conocidos de presupuestos históricos.
update public.quotes
set approved_at = coalesce(approved_at, created_at)
where status = 'approved' and approved_at is null;

update public.quotes
set sent_at = coalesce(sent_at, created_at)
where status = 'sent' and sent_at is null;

-- -------------------------------------------------------------
-- Permisos
-- -------------------------------------------------------------

insert into public.permissions(code, description)
values
  ('quotes.read', 'Ver presupuestos'),
  ('quotes.write', 'Crear y modificar presupuestos'),
  ('quotes.convert', 'Convertir presupuestos aprobados en pedidos')
on conflict(code) do update
set description = excluded.description;

-- Administradores existentes.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p
  on p.code in ('quotes.read', 'quotes.write', 'quotes.convert')
where r.code = 'admin'
   or lower(r.name) = 'administrador'
on conflict do nothing;

-- Administración existente.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p
  on p.code in ('quotes.read', 'quotes.write', 'quotes.convert')
where r.code = 'administration'
   or lower(r.name) = 'administración'
on conflict do nothing;

-- Empresas futuras: actualizar el rol Administración creado por Etapa 8.
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
    'reports.read',
    'history.read',
    'quotes.read',
    'quotes.write',
    'quotes.convert'
  )
  on conflict do nothing;

  return new;
end;
$$;

-- -------------------------------------------------------------
-- RLS de Presupuestos
-- -------------------------------------------------------------

drop policy if exists quotes_tenant_select on public.quotes;
drop policy if exists quotes_tenant_insert on public.quotes;
drop policy if exists quotes_tenant_update on public.quotes;
drop policy if exists quotes_tenant_delete on public.quotes;

drop policy if exists quotes_permission_select on public.quotes;
create policy quotes_permission_select
on public.quotes for select
using (
  public.has_company_permission(company_id, 'quotes.read')
  or public.has_company_permission(company_id, 'quotes.write')
);

drop policy if exists quotes_permission_insert on public.quotes;
create policy quotes_permission_insert
on public.quotes for insert
with check (public.has_company_permission(company_id, 'quotes.write'));

drop policy if exists quotes_permission_update on public.quotes;
create policy quotes_permission_update
on public.quotes for update
using (public.has_company_permission(company_id, 'quotes.write'))
with check (public.has_company_permission(company_id, 'quotes.write'));

-- Sin DELETE desde la app: los presupuestos se cancelan.

drop policy if exists quote_items_tenant_select on public.quote_items;
drop policy if exists quote_items_tenant_insert on public.quote_items;
drop policy if exists quote_items_tenant_update on public.quote_items;
drop policy if exists quote_items_tenant_delete on public.quote_items;

drop policy if exists quote_items_permission_select on public.quote_items;
create policy quote_items_permission_select
on public.quote_items for select
using (
  public.has_company_permission(company_id, 'quotes.read')
  or public.has_company_permission(company_id, 'quotes.write')
);

drop policy if exists quote_items_permission_insert on public.quote_items;
create policy quote_items_permission_insert
on public.quote_items for insert
with check (public.has_company_permission(company_id, 'quotes.write'));

drop policy if exists quote_items_permission_update on public.quote_items;
create policy quote_items_permission_update
on public.quote_items for update
using (public.has_company_permission(company_id, 'quotes.write'))
with check (public.has_company_permission(company_id, 'quotes.write'));

drop policy if exists quote_items_permission_delete on public.quote_items;
create policy quote_items_permission_delete
on public.quote_items for delete
using (public.has_company_permission(company_id, 'quotes.write'));

-- -------------------------------------------------------------
-- Contador de presupuestos por tenant
-- -------------------------------------------------------------

alter table public.company_counters
  add column if not exists next_quote_number bigint not null default 1;

update public.company_counters cc
set next_quote_number = greatest(
  cc.next_quote_number,
  coalesce(
    (
      select max(q.quote_number) + 1
      from public.quotes q
      where q.company_id = cc.company_id
    ),
    1
  )
);

insert into public.company_counters(company_id, next_order_number, next_quote_number)
select
  c.id,
  coalesce(
    (select max(o.order_number) + 1 from public.orders o where o.company_id = c.id),
    1
  ),
  coalesce(
    (select max(q.quote_number) + 1 from public.quotes q where q.company_id = c.id),
    1
  )
from public.companies c
on conflict(company_id) do update
set next_quote_number = greatest(
  public.company_counters.next_quote_number,
  excluded.next_quote_number
);

create or replace function public.take_next_quote_number(p_company_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number bigint;
begin
  if not public.has_company_permission(p_company_id, 'quotes.write') then
    raise exception 'No tenés permiso para crear presupuestos';
  end if;

  insert into public.company_counters(
    company_id,
    next_order_number,
    next_quote_number
  )
  values(
    p_company_id,
    1,
    2
  )
  on conflict(company_id) do update
  set next_quote_number = public.company_counters.next_quote_number + 1,
      updated_at = now()
  returning next_quote_number - 1
  into v_number;

  return v_number;
end;
$$;

grant execute on function public.take_next_quote_number(uuid)
to authenticated;

-- -------------------------------------------------------------
-- Overview
-- -------------------------------------------------------------

drop function if exists public.get_quote_overview(uuid);

create or replace function public.get_quote_overview(p_company_id uuid)
returns table(
  total_quotes bigint,
  open_quotes bigint,
  approved_quotes bigint,
  converted_quotes bigint,
  quoted_total numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_company_permission(p_company_id, 'quotes.read')
    or public.has_company_permission(p_company_id, 'quotes.write')
  ) then
    raise exception 'No tenés permiso para ver presupuestos';
  end if;

  return query
  select
    count(*)::bigint,
    count(*) filter (
      where q.status in ('draft','sent')
        and (q.valid_until is null or q.valid_until >= current_date)
    )::bigint,
    count(*) filter (where q.status = 'approved')::bigint,
    count(*) filter (where q.status = 'converted')::bigint,
    coalesce(
      sum(q.total) filter (
        where q.status not in ('rejected','cancelled')
      ),
      0
    )::numeric
  from public.quotes q
  where q.company_id = p_company_id;
end;
$$;

grant execute on function public.get_quote_overview(uuid)
to authenticated;

-- -------------------------------------------------------------
-- Listado consolidado
-- -------------------------------------------------------------

drop function if exists public.get_quote_summaries(uuid,text,text,integer,uuid);

create or replace function public.get_quote_summaries(
  p_company_id uuid,
  p_search text default null,
  p_status text default null,
  p_days integer default null,
  p_quote_id uuid default null
)
returns table(
  id uuid,
  quote_number bigint,
  client_id uuid,
  client_name text,
  client_company text,
  client_phone text,
  client_email text,
  status text,
  stored_status text,
  issue_date date,
  valid_until date,
  subtotal numeric,
  discount numeric,
  total numeric,
  item_count bigint,
  first_item text,
  notes text,
  sent_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  converted_at timestamptz,
  converted_order_id uuid,
  converted_order_number bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_company_permission(p_company_id, 'quotes.read')
    or public.has_company_permission(p_company_id, 'quotes.write')
  ) then
    raise exception 'No tenés permiso para ver presupuestos';
  end if;

  return query
  select
    q.id,
    q.quote_number,
    q.client_id,
    c.name,
    c.company_name,
    c.phone,
    c.email,
    case
      when q.status in ('draft','sent')
        and q.valid_until is not null
        and q.valid_until < current_date
      then 'expired'
      else q.status
    end as effective_status,
    q.status as stored_status,
    q.issue_date,
    q.valid_until,
    q.subtotal,
    q.discount,
    q.total,
    coalesce(items.item_count, 0)::bigint,
    items.first_item,
    q.notes,
    q.sent_at,
    q.approved_at,
    q.rejected_at,
    q.converted_at,
    converted.id,
    converted.order_number,
    q.created_at,
    q.updated_at
  from public.quotes q
  join public.clients c
    on c.id = q.client_id
   and c.company_id = q.company_id
  left join lateral (
    select
      count(*) as item_count,
      (
        select qi2.description
        from public.quote_items qi2
        where qi2.company_id = q.company_id
          and qi2.quote_id = q.id
        order by qi2.sort_order, qi2.id
        limit 1
      ) as first_item
    from public.quote_items qi
    where qi.company_id = q.company_id
      and qi.quote_id = q.id
  ) items on true
  left join lateral (
    select o.id, o.order_number
    from public.orders o
    where o.company_id = q.company_id
      and o.source_quote_id = q.id
    order by o.created_at
    limit 1
  ) converted on true
  where q.company_id = p_company_id
    and (p_quote_id is null or q.id = p_quote_id)
    and (
      p_days is null
      or p_days <= 0
      or q.issue_date >= current_date - p_days
    )
    and (
      nullif(trim(p_search), '') is null
      or q.quote_number::text ilike '%' || trim(p_search) || '%'
      or c.name ilike '%' || trim(p_search) || '%'
      or coalesce(c.company_name, '') ilike '%' || trim(p_search) || '%'
      or coalesce(c.phone, '') ilike '%' || trim(p_search) || '%'
      or coalesce(c.email, '') ilike '%' || trim(p_search) || '%'
      or coalesce(items.first_item, '') ilike '%' || trim(p_search) || '%'
    )
    and (
      nullif(trim(p_status), '') is null
      or (
        p_status = 'expired'
        and q.status in ('draft','sent')
        and q.valid_until is not null
        and q.valid_until < current_date
      )
      or (
        p_status <> 'expired'
        and q.status = p_status
        and not (
          q.status in ('draft','sent')
          and q.valid_until is not null
          and q.valid_until < current_date
        )
      )
    )
  order by q.issue_date desc, q.quote_number desc
  limit 500;
end;
$$;

grant execute on function public.get_quote_summaries(uuid,text,text,integer,uuid)
to authenticated;

-- -------------------------------------------------------------
-- Crear presupuesto
-- -------------------------------------------------------------

drop function if exists public.create_quote(uuid,uuid,date,date,text,numeric,text,jsonb);

create or replace function public.create_quote(
  p_company_id uuid,
  p_client_id uuid,
  p_issue_date date,
  p_valid_until date,
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
  v_quote_id uuid;
  v_quote_number bigint;
  v_subtotal numeric(14,2) := 0;
  v_total numeric(14,2);
  v_item jsonb;
  v_qty numeric(14,3);
  v_unit numeric(14,2);
  v_description text;
  v_sort integer := 0;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Debés iniciar sesión';
  end if;

  if not public.has_company_permission(p_company_id, 'quotes.write') then
    raise exception 'No tenés permiso para crear presupuestos';
  end if;

  if not exists(
    select 1
    from public.clients c
    where c.id = p_client_id
      and c.company_id = p_company_id
      and c.is_active = true
  ) then
    raise exception 'El cliente no pertenece a la empresa o está inactivo';
  end if;

  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'El presupuesto debe tener al menos un ítem';
  end if;

  if p_valid_until is not null
     and p_valid_until < coalesce(p_issue_date, current_date) then
    raise exception 'La fecha de validez no puede ser anterior a la emisión';
  end if;

  v_status := coalesce(nullif(trim(p_status), ''), 'draft');

  if v_status not in ('draft','sent','approved','rejected') then
    raise exception 'Estado inicial de presupuesto inválido';
  end if;

  for v_item in
    select * from jsonb_array_elements(p_items)
  loop
    v_description := trim(coalesce(v_item ->> 'description', ''));
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 0);
    v_unit := coalesce((v_item ->> 'unit_price')::numeric, 0);

    if v_description = '' then
      raise exception 'Todos los ítems deben tener descripción';
    end if;
    if v_qty <= 0 then
      raise exception 'La cantidad debe ser mayor a cero';
    end if;
    if v_unit < 0 then
      raise exception 'El precio no puede ser negativo';
    end if;

    v_subtotal := v_subtotal + round(v_qty * v_unit, 2);
  end loop;

  if coalesce(p_discount, 0) < 0
     or coalesce(p_discount, 0) > v_subtotal then
    raise exception 'Descuento inválido';
  end if;

  v_total := v_subtotal - coalesce(p_discount, 0);
  v_quote_number := public.take_next_quote_number(p_company_id);

  insert into public.quotes(
    company_id,
    client_id,
    quote_number,
    status,
    issue_date,
    valid_until,
    subtotal,
    discount,
    total,
    notes,
    sent_at,
    approved_at,
    rejected_at,
    created_by,
    updated_by,
    created_at,
    updated_at
  )
  values(
    p_company_id,
    p_client_id,
    v_quote_number,
    v_status,
    coalesce(p_issue_date, current_date),
    p_valid_until,
    v_subtotal,
    coalesce(p_discount, 0),
    v_total,
    nullif(trim(coalesce(p_notes, '')), ''),
    case when v_status = 'sent' then now() else null end,
    case when v_status = 'approved' then now() else null end,
    case when v_status = 'rejected' then now() else null end,
    auth.uid(),
    auth.uid(),
    now(),
    now()
  )
  returning id into v_quote_id;

  for v_item in
    select * from jsonb_array_elements(p_items)
  loop
    v_sort := v_sort + 1;
    v_description := trim(v_item ->> 'description');
    v_qty := (v_item ->> 'quantity')::numeric;
    v_unit := (v_item ->> 'unit_price')::numeric;

    insert into public.quote_items(
      company_id,
      quote_id,
      description,
      quantity,
      unit_price,
      total,
      sort_order
    )
    values(
      p_company_id,
      v_quote_id,
      v_description,
      v_qty,
      v_unit,
      round(v_qty * v_unit, 2),
      v_sort
    );
  end loop;

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
    'quote.created',
    'quote',
    v_quote_id::text,
    'Presupuesto P-' || lpad(v_quote_number::text, 4, '0') || ' creado',
    jsonb_build_object(
      'quote_number', v_quote_number,
      'status', v_status,
      'total', v_total
    )
  );

  return v_quote_id;
end;
$$;

grant execute on function public.create_quote(uuid,uuid,date,date,text,numeric,text,jsonb)
to authenticated;

-- -------------------------------------------------------------
-- Editar presupuesto
-- -------------------------------------------------------------

drop function if exists public.update_quote(uuid,uuid,uuid,date,date,text,numeric,text,jsonb);

create or replace function public.update_quote(
  p_company_id uuid,
  p_quote_id uuid,
  p_client_id uuid,
  p_issue_date date,
  p_valid_until date,
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
  v_old public.quotes%rowtype;
  v_subtotal numeric(14,2) := 0;
  v_total numeric(14,2);
  v_item jsonb;
  v_qty numeric(14,3);
  v_unit numeric(14,2);
  v_description text;
  v_sort integer := 0;
  v_status text;
begin
  if not public.has_company_permission(p_company_id, 'quotes.write') then
    raise exception 'No tenés permiso para modificar presupuestos';
  end if;

  select *
  into v_old
  from public.quotes q
  where q.id = p_quote_id
    and q.company_id = p_company_id
  for update;

  if not found then
    raise exception 'Presupuesto inexistente';
  end if;

  if v_old.status in ('converted','cancelled') then
    raise exception 'El presupuesto convertido o cancelado no puede editarse';
  end if;

  if not exists(
    select 1
    from public.clients c
    where c.id = p_client_id
      and c.company_id = p_company_id
      and c.is_active = true
  ) then
    raise exception 'Cliente inválido';
  end if;

  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'El presupuesto debe tener al menos un ítem';
  end if;

  if p_valid_until is not null
     and p_valid_until < coalesce(p_issue_date, current_date) then
    raise exception 'La fecha de validez no puede ser anterior a la emisión';
  end if;

  v_status := coalesce(nullif(trim(p_status), ''), v_old.status);

  if v_status not in ('draft','sent','approved','rejected') then
    raise exception 'Estado de presupuesto inválido';
  end if;

  for v_item in
    select * from jsonb_array_elements(p_items)
  loop
    v_description := trim(coalesce(v_item ->> 'description', ''));
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 0);
    v_unit := coalesce((v_item ->> 'unit_price')::numeric, 0);

    if v_description = '' or v_qty <= 0 or v_unit < 0 then
      raise exception 'Revisá los ítems del presupuesto';
    end if;

    v_subtotal := v_subtotal + round(v_qty * v_unit, 2);
  end loop;

  if coalesce(p_discount, 0) < 0
     or coalesce(p_discount, 0) > v_subtotal then
    raise exception 'Descuento inválido';
  end if;

  v_total := v_subtotal - coalesce(p_discount, 0);

  update public.quotes
  set
    client_id = p_client_id,
    issue_date = coalesce(p_issue_date, current_date),
    valid_until = p_valid_until,
    status = v_status,
    subtotal = v_subtotal,
    discount = coalesce(p_discount, 0),
    total = v_total,
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    sent_at = case
      when v_status = 'sent' then coalesce(v_old.sent_at, now())
      when v_status = 'draft' then null
      else v_old.sent_at
    end,
    approved_at = case
      when v_status = 'approved' then coalesce(v_old.approved_at, now())
      when v_status in ('draft','sent','rejected') then null
      else v_old.approved_at
    end,
    rejected_at = case
      when v_status = 'rejected' then coalesce(v_old.rejected_at, now())
      when v_status in ('draft','sent','approved') then null
      else v_old.rejected_at
    end,
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_quote_id
    and company_id = p_company_id;

  delete from public.quote_items
  where company_id = p_company_id
    and quote_id = p_quote_id;

  for v_item in
    select * from jsonb_array_elements(p_items)
  loop
    v_sort := v_sort + 1;
    v_description := trim(v_item ->> 'description');
    v_qty := (v_item ->> 'quantity')::numeric;
    v_unit := (v_item ->> 'unit_price')::numeric;

    insert into public.quote_items(
      company_id,
      quote_id,
      description,
      quantity,
      unit_price,
      total,
      sort_order
    )
    values(
      p_company_id,
      p_quote_id,
      v_description,
      v_qty,
      v_unit,
      round(v_qty * v_unit, 2),
      v_sort
    );
  end loop;

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
    'quote.updated',
    'quote',
    p_quote_id::text,
    'Presupuesto P-' || lpad(v_old.quote_number::text, 4, '0') || ' actualizado',
    jsonb_build_object(
      'quote_number', v_old.quote_number,
      'old_status', v_old.status,
      'new_status', v_status,
      'total', v_total
    )
  );
end;
$$;

grant execute on function public.update_quote(uuid,uuid,uuid,date,date,text,numeric,text,jsonb)
to authenticated;

-- -------------------------------------------------------------
-- Cambio de estado
-- -------------------------------------------------------------

drop function if exists public.change_quote_status(uuid,uuid,text);

create or replace function public.change_quote_status(
  p_company_id uuid,
  p_quote_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.quotes%rowtype;
  v_status text;
begin
  if not public.has_company_permission(p_company_id, 'quotes.write') then
    raise exception 'No tenés permiso para modificar presupuestos';
  end if;

  v_status := trim(coalesce(p_status, ''));

  if v_status not in ('draft','sent','approved','rejected','cancelled') then
    raise exception 'Estado inválido';
  end if;

  select *
  into v_quote
  from public.quotes q
  where q.id = p_quote_id
    and q.company_id = p_company_id
  for update;

  if not found then
    raise exception 'Presupuesto inexistente';
  end if;

  if v_quote.status = 'converted' then
    raise exception 'El presupuesto ya fue convertido en pedido';
  end if;

  if v_quote.status = 'cancelled' and v_status <> 'cancelled' then
    raise exception 'Un presupuesto cancelado no puede reabrirse';
  end if;

  if v_status = 'approved'
     and v_quote.valid_until is not null
     and v_quote.valid_until < current_date then
    raise exception 'El presupuesto está vencido. Editá su vigencia antes de aprobarlo';
  end if;

  update public.quotes
  set
    status = v_status,
    sent_at = case
      when v_status = 'sent' then coalesce(sent_at, now())
      when v_status = 'draft' then null
      else sent_at
    end,
    approved_at = case
      when v_status = 'approved' then now()
      when v_status in ('draft','sent','rejected','cancelled') then null
      else approved_at
    end,
    rejected_at = case
      when v_status = 'rejected' then now()
      when v_status in ('draft','sent','approved','cancelled') then null
      else rejected_at
    end,
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_quote_id
    and company_id = p_company_id;

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
    'quote.status.changed',
    'quote',
    p_quote_id::text,
    'Estado del presupuesto P-' || lpad(v_quote.quote_number::text, 4, '0') || ' actualizado',
    jsonb_build_object(
      'quote_number', v_quote.quote_number,
      'from', v_quote.status,
      'to', v_status
    )
  );
end;
$$;

grant execute on function public.change_quote_status(uuid,uuid,text)
to authenticated;

-- -------------------------------------------------------------
-- Duplicar presupuesto
-- -------------------------------------------------------------

drop function if exists public.duplicate_quote(uuid,uuid);

create or replace function public.duplicate_quote(
  p_company_id uuid,
  p_quote_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.quotes%rowtype;
  v_new_id uuid;
  v_number bigint;
  v_valid_days integer;
begin
  if not public.has_company_permission(p_company_id, 'quotes.write') then
    raise exception 'No tenés permiso para duplicar presupuestos';
  end if;

  select *
  into v_source
  from public.quotes q
  where q.id = p_quote_id
    and q.company_id = p_company_id;

  if not found then
    raise exception 'Presupuesto inexistente';
  end if;

  v_number := public.take_next_quote_number(p_company_id);
  v_valid_days := greatest(
    coalesce(v_source.valid_until - v_source.issue_date, 15),
    1
  );

  insert into public.quotes(
    company_id,
    client_id,
    quote_number,
    status,
    issue_date,
    valid_until,
    subtotal,
    discount,
    total,
    notes,
    created_by,
    updated_by,
    created_at,
    updated_at
  )
  values(
    p_company_id,
    v_source.client_id,
    v_number,
    'draft',
    current_date,
    current_date + v_valid_days,
    v_source.subtotal,
    v_source.discount,
    v_source.total,
    v_source.notes,
    auth.uid(),
    auth.uid(),
    now(),
    now()
  )
  returning id into v_new_id;

  insert into public.quote_items(
    company_id,
    quote_id,
    description,
    quantity,
    unit_price,
    total,
    sort_order
  )
  select
    p_company_id,
    v_new_id,
    qi.description,
    qi.quantity,
    qi.unit_price,
    qi.total,
    qi.sort_order
  from public.quote_items qi
  where qi.company_id = p_company_id
    and qi.quote_id = p_quote_id
  order by qi.sort_order, qi.id;

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
    'quote.duplicated',
    'quote',
    v_new_id::text,
    'Presupuesto P-' || lpad(v_source.quote_number::text, 4, '0')
      || ' duplicado como P-' || lpad(v_number::text, 4, '0'),
    jsonb_build_object(
      'source_quote_id', p_quote_id,
      'source_quote_number', v_source.quote_number,
      'new_quote_number', v_number
    )
  );

  return v_new_id;
end;
$$;

grant execute on function public.duplicate_quote(uuid,uuid)
to authenticated;

-- -------------------------------------------------------------
-- Conversión Presupuesto -> Pedido
-- -------------------------------------------------------------

drop function if exists public.convert_quote_to_order(uuid,uuid,date,text,text);

create or replace function public.convert_quote_to_order(
  p_company_id uuid,
  p_quote_id uuid,
  p_delivery_date date default null,
  p_priority text default 'normal',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.quotes%rowtype;
  v_order_id uuid;
  v_order_number bigint;
  v_existing_order_number bigint;
  v_priority text;
  v_order_notes text;
begin
  if auth.uid() is null then
    raise exception 'Debés iniciar sesión';
  end if;

  if not public.has_company_permission(p_company_id, 'quotes.convert') then
    raise exception 'No tenés permiso para convertir presupuestos';
  end if;

  if not public.has_company_permission(p_company_id, 'orders.write') then
    raise exception 'También necesitás permiso para crear pedidos';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_company_id::text || ':quote:' || p_quote_id::text)
  );

  select *
  into v_quote
  from public.quotes q
  where q.id = p_quote_id
    and q.company_id = p_company_id
  for update;

  if not found then
    raise exception 'Presupuesto inexistente';
  end if;

  select o.id, o.order_number
  into v_order_id, v_existing_order_number
  from public.orders o
  where o.company_id = p_company_id
    and o.source_quote_id = p_quote_id
  limit 1;

  if v_order_id is not null then
    return jsonb_build_object(
      'order_id', v_order_id,
      'order_number', v_existing_order_number
    );
  end if;

  if v_quote.status <> 'approved' then
    raise exception 'Solo un presupuesto aprobado puede convertirse en pedido';
  end if;

  if v_quote.valid_until is not null
     and v_quote.valid_until < current_date then
    raise exception 'El presupuesto está vencido';
  end if;

  if not exists(
    select 1
    from public.clients c
    where c.id = v_quote.client_id
      and c.company_id = p_company_id
      and c.is_active = true
  ) then
    raise exception 'El cliente está inactivo o ya no pertenece a la empresa';
  end if;

  if not exists(
    select 1
    from public.quote_items qi
    where qi.company_id = p_company_id
      and qi.quote_id = p_quote_id
  ) then
    raise exception 'El presupuesto no tiene ítems';
  end if;

  v_priority := coalesce(nullif(trim(p_priority), ''), 'normal');

  if v_priority not in ('urgent','high','normal','low') then
    raise exception 'Prioridad inválida';
  end if;

  if p_delivery_date is not null
     and p_delivery_date < current_date then
    raise exception 'La fecha de entrega no puede estar en el pasado';
  end if;

  v_order_number := public.take_next_order_number(p_company_id);

  v_order_notes := nullif(
    concat_ws(
      E'\n\n',
      'Origen: Presupuesto P-' || lpad(v_quote.quote_number::text, 4, '0'),
      nullif(trim(coalesce(v_quote.notes, '')), ''),
      nullif(trim(coalesce(p_notes, '')), '')
    ),
    ''
  );

  insert into public.orders(
    company_id,
    client_id,
    source_quote_id,
    order_number,
    order_date,
    delivery_date,
    priority,
    status,
    subtotal,
    discount,
    total,
    notes,
    created_by,
    updated_by,
    created_at,
    updated_at
  )
  values(
    p_company_id,
    v_quote.client_id,
    p_quote_id,
    v_order_number,
    current_date,
    p_delivery_date,
    v_priority,
    'confirmed',
    v_quote.subtotal,
    v_quote.discount,
    v_quote.total,
    v_order_notes,
    auth.uid(),
    auth.uid(),
    now(),
    now()
  )
  returning id into v_order_id;

  insert into public.order_items(
    company_id,
    order_id,
    description,
    quantity,
    unit_price,
    total,
    sort_order
  )
  select
    p_company_id,
    v_order_id,
    qi.description,
    qi.quantity,
    qi.unit_price,
    qi.total,
    qi.sort_order
  from public.quote_items qi
  where qi.company_id = p_company_id
    and qi.quote_id = p_quote_id
  order by qi.sort_order, qi.id;

  update public.quotes
  set
    status = 'converted',
    converted_at = now(),
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_quote_id
    and company_id = p_company_id;

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
    'quote.converted',
    'quote',
    p_quote_id::text,
    'Presupuesto P-' || lpad(v_quote.quote_number::text, 4, '0')
      || ' convertido en pedido #' || lpad(v_order_number::text, 5, '0'),
    jsonb_build_object(
      'quote_number', v_quote.quote_number,
      'order_id', v_order_id,
      'order_number', v_order_number,
      'total', v_quote.total
    )
  );

  -- El trigger de Etapa 6 sobre public.orders crea/sincroniza
  -- automáticamente el production_job para el pedido confirmado.

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number
  );
end;
$$;

grant execute on function public.convert_quote_to_order(uuid,uuid,date,text,text)
to authenticated;

-- -------------------------------------------------------------
-- Historial: agregar grupo Presupuestos
-- -------------------------------------------------------------

create or replace function public.audit_action_group(
  p_action text,
  p_entity_type text
)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_action,'') || ' ' || coalesce(p_entity_type,'')) like '%quote%'
      then 'quotes'
    when lower(coalesce(p_action,'') || ' ' || coalesce(p_entity_type,'')) like '%client%'
      then 'clients'
    when lower(coalesce(p_action,'') || ' ' || coalesce(p_entity_type,'')) like '%order%'
      then 'orders'
    when lower(coalesce(p_action,'') || ' ' || coalesce(p_entity_type,'')) like '%payment%'
      then 'payments'
    when lower(coalesce(p_action,'') || ' ' || coalesce(p_entity_type,'')) like '%production%'
      then 'production'
    when (
      lower(coalesce(p_action,'') || ' ' || coalesce(p_entity_type,'')) like '%stock%'
      or lower(coalesce(p_action,'') || ' ' || coalesce(p_entity_type,'')) like '%material%'
      or lower(coalesce(p_action,'') || ' ' || coalesce(p_entity_type,'')) like '%inventory%'
    )
      then 'inventory'
    when lower(coalesce(p_action,'') || ' ' || coalesce(p_entity_type,'')) like '%cash%'
      then 'cash'
    when (
      lower(coalesce(p_action,'') || ' ' || coalesce(p_entity_type,'')) like '%membership%'
      or lower(coalesce(p_action,'') || ' ' || coalesce(p_entity_type,'')) like '%role%'
      or lower(coalesce(p_action,'') || ' ' || coalesce(p_entity_type,'')) like '%user%'
      or lower(coalesce(p_action,'') || ' ' || coalesce(p_entity_type,'')) like '%security%'
    )
      then 'security'
    when (
      lower(coalesce(p_action,'') || ' ' || coalesce(p_entity_type,'')) like '%settings%'
      or lower(coalesce(p_action,'') || ' ' || coalesce(p_entity_type,'')) like '%module%'
      or lower(coalesce(p_action,'')) like 'company.%'
    )
      then 'settings'
    else 'other'
  end;
$$;

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
      or public.audit_action_group(al.action, al.entity_type) = p_action_group
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
-- Dashboard: presupuestos abiertos correctos
-- -------------------------------------------------------------

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
        and q.status in ('draft','sent')
        and (q.valid_until is null or q.valid_until >= current_date)
    )::bigint;
end;
$$;

grant execute on function public.get_dashboard_overview(uuid) to authenticated;
