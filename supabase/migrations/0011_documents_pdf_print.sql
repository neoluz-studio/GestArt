-- =============================================================
-- GestArt ETAPA 12
-- Identidad documental, logo por empresa, PDFs e impresión.
-- Ejecutar después de 0010_reports_analytics.sql
-- =============================================================

-- -------------------------------------------------------------
-- Configuración documental
-- -------------------------------------------------------------

alter table public.company_settings
  add column if not exists quote_header text,
  add column if not exists order_footer text,
  add column if not exists document_settings jsonb not null default
    '{"show_logo":true,"show_tax_id":true,"show_contact":true,"show_payment_information":true}'::jsonb;

update public.company_settings
set document_settings =
  '{"show_logo":true,"show_tax_id":true,"show_contact":true,"show_payment_information":true}'::jsonb
where document_settings is null;

-- -------------------------------------------------------------
-- Storage de identidad visual
-- -------------------------------------------------------------

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values(
  'company-assets',
  'company-assets',
  true,
  3145728,
  array['image/png','image/jpeg','image/webp']
)
on conflict(id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Lectura pública porque el logo se incorpora en impresión/PDF desde el navegador.
drop policy if exists company_assets_public_read on storage.objects;
create policy company_assets_public_read
on storage.objects for select
using (bucket_id = 'company-assets');

-- Cada tenant sólo puede escribir dentro de su propia carpeta UUID.
drop policy if exists company_assets_member_insert on storage.objects;
create policy company_assets_member_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'company-assets'
  and array_length(storage.foldername(name), 1) >= 1
  and public.has_company_permission(((storage.foldername(name))[1])::uuid, 'company.manage')
);

drop policy if exists company_assets_member_update on storage.objects;
create policy company_assets_member_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'company-assets'
  and array_length(storage.foldername(name), 1) >= 1
  and public.has_company_permission(((storage.foldername(name))[1])::uuid, 'company.manage')
)
with check (
  bucket_id = 'company-assets'
  and array_length(storage.foldername(name), 1) >= 1
  and public.has_company_permission(((storage.foldername(name))[1])::uuid, 'company.manage')
);

drop policy if exists company_assets_member_delete on storage.objects;
create policy company_assets_member_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'company-assets'
  and array_length(storage.foldername(name), 1) >= 1
  and public.has_company_permission(((storage.foldername(name))[1])::uuid, 'company.manage')
);

-- -------------------------------------------------------------
-- Auditoría de exportaciones
-- -------------------------------------------------------------

create or replace function public.log_document_action(
  p_company_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_description text;
begin
  if auth.uid() is null then
    raise exception 'Debés iniciar sesión';
  end if;

  if p_action not in ('pdf','print') then
    raise exception 'Acción documental inválida';
  end if;

  if p_entity_type = 'quote' then
    if not (
      public.has_company_permission(p_company_id, 'quotes.read')
      or public.has_company_permission(p_company_id, 'quotes.write')
    ) then
      raise exception 'No tenés permiso para exportar presupuestos';
    end if;

    if not exists(
      select 1 from public.quotes q
      where q.company_id = p_company_id
        and q.id::text = p_entity_id
    ) then
      raise exception 'Presupuesto inexistente';
    end if;

  elsif p_entity_type = 'order' then
    if not public.has_company_permission(p_company_id, 'orders.read') then
      raise exception 'No tenés permiso para exportar pedidos';
    end if;

    if not exists(
      select 1 from public.orders o
      where o.company_id = p_company_id
        and o.id::text = p_entity_id
    ) then
      raise exception 'Pedido inexistente';
    end if;

  elsif p_entity_type = 'report' then
    if not public.has_company_permission(p_company_id, 'reports.read') then
      raise exception 'No tenés permiso para exportar reportes';
    end if;

  else
    raise exception 'Tipo de documento inválido';
  end if;

  v_description := case p_action
    when 'pdf' then 'Documento exportado a PDF'
    else 'Documento enviado a impresión'
  end;

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
    case p_action
      when 'pdf' then 'document.pdf.generated'
      else 'document.printed'
    end,
    p_entity_type,
    p_entity_id,
    v_description,
    jsonb_build_object(
      'document_type', p_entity_type,
      'document_action', p_action
    )
  );
end;
$$;

grant execute on function public.log_document_action(uuid,text,text,text)
to authenticated;

-- -------------------------------------------------------------
-- Auditoría ampliada de company_settings
-- -------------------------------------------------------------

create or replace function public.audit_company_settings_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed text[];
begin
  v_changed := array_remove(array[
    case when old.logo_url is distinct from new.logo_url then 'logo_url' end,
    case when old.sidebar_logo_url is distinct from new.sidebar_logo_url then 'sidebar_logo_url' end,
    case when old.phone is distinct from new.phone then 'phone' end,
    case when old.whatsapp is distinct from new.whatsapp then 'whatsapp' end,
    case when old.email is distinct from new.email then 'email' end,
    case when old.website is distinct from new.website then 'website' end,
    case when old.address is distinct from new.address then 'address' end,
    case when old.city is distinct from new.city then 'city' end,
    case when old.province is distinct from new.province then 'province' end,
    case when old.primary_color is distinct from new.primary_color then 'primary_color' end,
    case when old.secondary_color is distinct from new.secondary_color then 'secondary_color' end,
    case when old.accent_color is distinct from new.accent_color then 'accent_color' end,
    case when old.theme is distinct from new.theme then 'theme' end,
    case when old.currency is distinct from new.currency then 'currency' end,
    case when old.locale is distinct from new.locale then 'locale' end,
    case when old.timezone is distinct from new.timezone then 'timezone' end,
    case when old.quote_template is distinct from new.quote_template then 'quote_template' end,
    case when old.quote_header is distinct from new.quote_header then 'quote_header' end,
    case when old.quote_footer is distinct from new.quote_footer then 'quote_footer' end,
    case when old.order_footer is distinct from new.order_footer then 'order_footer' end,
    case when old.terms_and_conditions is distinct from new.terms_and_conditions then 'terms_and_conditions' end,
    case when old.payment_information is distinct from new.payment_information then 'payment_information' end,
    case when old.document_settings is distinct from new.document_settings then 'document_settings' end,
    case when old.dashboard_options is distinct from new.dashboard_options then 'dashboard_options' end
  ], null);

  if coalesce(array_length(v_changed, 1), 0) > 0 then
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
      new.company_id,
      auth.uid(),
      'company.settings.updated',
      'company_settings',
      new.company_id::text,
      'Configuración de empresa actualizada',
      jsonb_build_object('changed_fields', to_jsonb(v_changed))
    );
  end if;

  return new;
end;
$$;

-- El trigger creado en Etapa 9 sigue apuntando a esta función reemplazada.

-- -------------------------------------------------------------
-- Historial: reconocer exportaciones de Reportes
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
    when lower(coalesce(p_action,'') || ' ' || coalesce(p_entity_type,'')) like '%report%'
      then 'reports'
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
