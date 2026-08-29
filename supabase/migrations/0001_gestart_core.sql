create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(), name text not null, legal_name text, slug text not null unique,
  tax_id text, industry text, country text not null default 'AR', status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.company_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  logo_url text, sidebar_logo_url text, phone text, whatsapp text, email text, website text, address text, city text, province text,
  primary_color text not null default '#6d4aff', secondary_color text not null default '#17151d', accent_color text not null default '#b9ff66',
  theme text not null default 'light', currency text not null default 'ARS', locale text not null default 'es-AR', timezone text not null default 'America/Argentina/Buenos_Aires',
  quote_template text not null default 'modern', quote_footer text, terms_and_conditions text, payment_information jsonb not null default '[]'::jsonb,
  dashboard_options jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);
create table if not exists public.profiles (user_id uuid primary key references auth.users(id) on delete cascade, full_name text, avatar_url text);
create table if not exists public.roles (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, name text not null, unique(company_id,name));
create table if not exists public.permissions (id uuid primary key default gen_random_uuid(), code text not null unique, description text);
create table if not exists public.role_permissions (role_id uuid references public.roles(id) on delete cascade, permission_id uuid references public.permissions(id) on delete cascade, primary key(role_id,permission_id));
create table if not exists public.company_memberships (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, role_id uuid references public.roles(id), status text not null default 'active', unique(company_id,user_id));
create table if not exists public.modules (id uuid primary key default gen_random_uuid(), code text not null unique, default_label text not null, default_icon text, is_core boolean not null default false);
create table if not exists public.company_modules (company_id uuid references public.companies(id) on delete cascade, module_id uuid references public.modules(id) on delete cascade, enabled boolean not null default true, custom_label text, custom_icon text, sort_order int not null default 0, primary key(company_id,module_id));

create table if not exists public.clients (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, name text not null, company_name text, tax_id text, phone text, email text, address text, notes text, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.quotes (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, client_id uuid not null references public.clients(id), quote_number bigint not null, status text not null default 'draft', issue_date date not null default current_date, valid_until date, subtotal numeric(14,2) not null default 0, discount numeric(14,2) not null default 0, total numeric(14,2) not null default 0, created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(company_id,quote_number));
create table if not exists public.quote_items (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, quote_id uuid not null references public.quotes(id) on delete cascade, description text not null, quantity numeric(14,3) not null check(quantity>0), unit_price numeric(14,2) not null check(unit_price>=0), total numeric(14,2) not null check(total>=0));
create table if not exists public.orders (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, client_id uuid not null references public.clients(id), source_quote_id uuid references public.quotes(id), order_number bigint not null, order_date date not null default current_date, delivery_date date, priority text not null default 'normal', status text not null default 'confirmed', total numeric(14,2) not null default 0, notes text, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,order_number));
create table if not exists public.order_items (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, order_id uuid not null references public.orders(id) on delete cascade, description text not null, quantity numeric(14,3) not null check(quantity>0), unit_price numeric(14,2) not null check(unit_price>=0), total numeric(14,2) not null check(total>=0));
create table if not exists public.payment_methods (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, code text not null, name text not null, enabled boolean not null default true, unique(company_id,code));
create table if not exists public.payment_batches (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, order_id uuid not null references public.orders(id), total_amount numeric(14,2) not null check(total_amount>0), created_by uuid references auth.users(id), created_at timestamptz not null default now());
create table if not exists public.payments (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, payment_batch_id uuid not null references public.payment_batches(id) on delete cascade, order_id uuid not null references public.orders(id), payment_method_id uuid not null references public.payment_methods(id), amount numeric(14,2) not null check(amount>0), created_by uuid references auth.users(id), created_at timestamptz not null default now());
create table if not exists public.cash_movements (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, movement_type text not null check(movement_type in('income','expense')), concept text not null, amount numeric(14,2) not null check(amount>0), payment_method_id uuid references public.payment_methods(id), order_id uuid references public.orders(id), payment_id uuid references public.payments(id), created_by uuid references auth.users(id), created_at timestamptz not null default now());
create table if not exists public.materials (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, name text not null, category text, code text, unit text not null, current_stock numeric(14,3) not null default 0, minimum_stock numeric(14,3) not null default 0, unit_cost numeric(14,2) not null default 0, unique(company_id,code));
create table if not exists public.stock_movements (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, material_id uuid not null references public.materials(id), movement_type text not null check(movement_type in('in','out','adjustment')), quantity numeric(14,3) not null check(quantity<>0), reason text not null, order_id uuid references public.orders(id), created_by uuid references auth.users(id), created_at timestamptz not null default now());
create table if not exists public.production_jobs (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, order_id uuid not null references public.orders(id) on delete cascade, status text not null default 'pending', responsible_user_id uuid references auth.users(id), started_at timestamptz, completed_at timestamptz);
create table if not exists public.activity_logs (id bigint generated always as identity primary key, company_id uuid not null references public.companies(id) on delete cascade, user_id uuid references auth.users(id), action text not null, entity_type text, entity_id text, description text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());

create or replace function public.is_company_member(target_company_id uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.company_memberships m where m.company_id=target_company_id and m.user_id=auth.uid() and m.status='active'); $$;

-- RLS: aislamiento desde la base, no sólo desde la UI.
alter table public.companies enable row level security;
alter table public.company_settings enable row level security;
alter table public.company_memberships enable row level security;
alter table public.roles enable row level security;
alter table public.clients enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_methods enable row level security;
alter table public.payment_batches enable row level security;
alter table public.payments enable row level security;
alter table public.cash_movements enable row level security;
alter table public.materials enable row level security;
alter table public.stock_movements enable row level security;
alter table public.production_jobs enable row level security;
alter table public.activity_logs enable row level security;
alter table public.company_modules enable row level security;

create policy companies_member_read on public.companies for select using(public.is_company_member(id));
create policy settings_tenant_all on public.company_settings for all using(public.is_company_member(company_id)) with check(public.is_company_member(company_id));
create policy memberships_tenant_read on public.company_memberships for select using(user_id=auth.uid() or public.is_company_member(company_id));
create policy roles_tenant_read on public.roles for select using(public.is_company_member(company_id));
create policy company_modules_tenant_all on public.company_modules for all using(public.is_company_member(company_id)) with check(public.is_company_member(company_id));

do $$ declare t text; begin
  foreach t in array array['clients','quotes','quote_items','orders','order_items','payment_methods','payment_batches','payments','cash_movements','materials','stock_movements','production_jobs','activity_logs'] loop
    execute format('create policy %I_tenant_select on public.%I for select using(public.is_company_member(company_id))',t,t);
    execute format('create policy %I_tenant_insert on public.%I for insert with check(public.is_company_member(company_id))',t,t);
    execute format('create policy %I_tenant_update on public.%I for update using(public.is_company_member(company_id)) with check(public.is_company_member(company_id))',t,t);
    execute format('create policy %I_tenant_delete on public.%I for delete using(public.is_company_member(company_id))',t,t);
  end loop;
end $$;
