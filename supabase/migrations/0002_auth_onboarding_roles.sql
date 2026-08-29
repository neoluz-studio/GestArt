-- GestArt ETAPA 2
-- Autenticación, onboarding, perfiles, roles y administración por tenant.

alter table public.roles
  add column if not exists code text;

alter table public.company_memberships
  add column if not exists created_at timestamptz not null default now();

alter table public.company_settings
  add column if not exists created_at timestamptz not null default now();

alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.modules enable row level security;
alter table public.role_permissions enable row level security;

-- Perfil automático al crear un usuario en Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(user_id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (user_id) do update
  set full_name = excluded.full_name;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_memberships m
    where m.company_id = target_company_id
      and m.user_id = auth.uid()
      and m.status in ('active', 'invited')
  );
$$;

create or replace function public.has_company_permission(
  target_company_id uuid,
  permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_memberships m
    join public.role_permissions rp on rp.role_id = m.role_id
    join public.permissions p on p.id = rp.permission_id
    where m.company_id = target_company_id
      and m.user_id = auth.uid()
      and m.status in ('active', 'invited')
      and p.code = permission_code
  );
$$;

create or replace function public.shares_company_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_user_id = auth.uid()
  or exists (
    select 1
    from public.company_memberships mine
    join public.company_memberships theirs
      on theirs.company_id = mine.company_id
    where mine.user_id = auth.uid()
      and theirs.user_id = target_user_id
      and mine.status in ('active','invited')
      and theirs.status in ('active','invited')
  );
$$;

drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert
on public.profiles for insert
with check (user_id = auth.uid());

drop policy if exists profiles_shared_read on public.profiles;
create policy profiles_shared_read
on public.profiles for select
using (public.shares_company_with(user_id));

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update
on public.profiles for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists permissions_authenticated_read on public.permissions;
create policy permissions_authenticated_read
on public.permissions for select to authenticated
using (true);

drop policy if exists modules_authenticated_read on public.modules;
create policy modules_authenticated_read
on public.modules for select to authenticated
using (true);

-- Administración de empresa.
drop policy if exists companies_admin_update on public.companies;
create policy companies_admin_update
on public.companies for update
using (public.has_company_permission(id, 'company.manage'))
with check (public.has_company_permission(id, 'company.manage'));

-- Roles: lectura ya existe en 0001; agregamos escritura con permiso.
drop policy if exists roles_admin_insert on public.roles;
create policy roles_admin_insert
on public.roles for insert
with check (public.has_company_permission(company_id, 'roles.manage'));

drop policy if exists roles_admin_update on public.roles;
create policy roles_admin_update
on public.roles for update
using (public.has_company_permission(company_id, 'roles.manage'))
with check (public.has_company_permission(company_id, 'roles.manage'));

drop policy if exists roles_admin_delete on public.roles;
create policy roles_admin_delete
on public.roles for delete
using (public.has_company_permission(company_id, 'roles.manage'));

drop policy if exists role_permissions_company_read on public.role_permissions;
create policy role_permissions_company_read
on public.role_permissions for select
using (
  exists (
    select 1
    from public.roles r
    where r.id = role_id
      and public.is_company_member(r.company_id)
  )
);

-- Configuración de empresa sólo editable con permiso.
drop policy if exists settings_tenant_all on public.company_settings;

drop policy if exists settings_tenant_read on public.company_settings;
create policy settings_tenant_read
on public.company_settings for select
using (public.is_company_member(company_id));

drop policy if exists settings_admin_insert on public.company_settings;
create policy settings_admin_insert
on public.company_settings for insert
with check (public.has_company_permission(company_id, 'company.manage'));

drop policy if exists settings_admin_update on public.company_settings;
create policy settings_admin_update
on public.company_settings for update
using (public.has_company_permission(company_id, 'company.manage'))
with check (public.has_company_permission(company_id, 'company.manage'));

-- Módulos: lectura para miembros, escritura para administradores.
drop policy if exists company_modules_tenant_all on public.company_modules;

drop policy if exists company_modules_tenant_read on public.company_modules;
create policy company_modules_tenant_read
on public.company_modules for select
using (public.is_company_member(company_id));

drop policy if exists company_modules_admin_insert on public.company_modules;
create policy company_modules_admin_insert
on public.company_modules for insert
with check (public.has_company_permission(company_id, 'company.manage'));

drop policy if exists company_modules_admin_update on public.company_modules;
create policy company_modules_admin_update
on public.company_modules for update
using (public.has_company_permission(company_id, 'company.manage'))
with check (public.has_company_permission(company_id, 'company.manage'));

drop policy if exists company_modules_admin_delete on public.company_modules;
create policy company_modules_admin_delete
on public.company_modules for delete
using (public.has_company_permission(company_id, 'company.manage'));

-- Onboarding seguro. La empresa se crea para el usuario autenticado actual.
create or replace function public.create_company_with_admin(
  p_name text,
  p_slug text,
  p_industry text default 'otro',
  p_primary_color text default '#6d4aff',
  p_module_codes text[] default array[]::text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid;
  v_role_id uuid;
begin
  if v_user_id is null then
    raise exception 'Debés iniciar sesión antes de crear una empresa';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'El nombre de la empresa es obligatorio';
  end if;

  if nullif(trim(p_slug), '') is null then
    raise exception 'El identificador de la empresa es obligatorio';
  end if;

  insert into public.companies(name, slug, industry)
  values (trim(p_name), lower(trim(p_slug)), p_industry)
  returning id into v_company_id;

  insert into public.company_settings(
    company_id,
    primary_color,
    secondary_color,
    accent_color
  )
  values (
    v_company_id,
    coalesce(nullif(p_primary_color, ''), '#6d4aff'),
    '#17151d',
    '#b9ff66'
  );

  insert into public.roles(company_id, name, code)
  values (v_company_id, 'Administrador', 'admin')
  returning id into v_role_id;

  insert into public.company_memberships(
    company_id,
    user_id,
    role_id,
    status
  )
  values (
    v_company_id,
    v_user_id,
    v_role_id,
    'active'
  );

  insert into public.role_permissions(role_id, permission_id)
  select v_role_id, p.id
  from public.permissions p
  on conflict do nothing;

  insert into public.company_modules(
    company_id,
    module_id,
    enabled,
    custom_label,
    custom_icon,
    sort_order
  )
  select
    v_company_id,
    m.id,
    case
      when m.is_core then true
      when cardinality(p_module_codes) = 0 then true
      else m.code = any(p_module_codes)
    end,
    null,
    null,
    row_number() over (order by m.is_core desc, m.default_label)::int
  from public.modules m;

  insert into public.payment_methods(company_id, code, name, enabled)
  values
    (v_company_id, 'cash', 'Efectivo', true),
    (v_company_id, 'transfer', 'Transferencia', true),
    (v_company_id, 'mercadopago', 'Mercado Pago', true),
    (v_company_id, 'debit', 'Tarjeta de débito', true),
    (v_company_id, 'credit', 'Tarjeta de crédito', true),
    (v_company_id, 'other', 'Otro', true)
  on conflict(company_id, code) do nothing;

  insert into public.activity_logs(
    company_id,
    user_id,
    action,
    entity_type,
    entity_id,
    description
  )
  values (
    v_company_id,
    v_user_id,
    'company.created',
    'company',
    v_company_id::text,
    'Empresa creada mediante onboarding'
  );

  return v_company_id;
end;
$$;

grant execute on function public.create_company_with_admin(text,text,text,text,text[])
to authenticated;

-- Creación de roles desde la UI administrativa.
create or replace function public.create_company_role(
  p_company_id uuid,
  p_name text,
  p_permission_codes text[] default array[]::text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_id uuid;
begin
  if not public.has_company_permission(p_company_id, 'roles.manage') then
    raise exception 'No tenés permiso para administrar roles';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'El nombre del rol es obligatorio';
  end if;

  insert into public.roles(company_id, name, code)
  values (
    p_company_id,
    trim(p_name),
    lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '_', 'g'))
  )
  returning id into v_role_id;

  insert into public.role_permissions(role_id, permission_id)
  select v_role_id, p.id
  from public.permissions p
  where p.code = any(p_permission_codes)
  on conflict do nothing;

  return v_role_id;
end;
$$;

grant execute on function public.create_company_role(uuid,text,text[])
to authenticated;
