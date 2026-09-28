-- =========================================================
-- Registro de pagos de pedidos <-> Caja (versión reforzada)
--
-- Mejoras respecto a la versión anterior de register_mixed_payment_v2:
--  * El movimiento de Caja queda con concepto
--    "Pago pedido #00025 - Juan Pérez" y vinculado al cliente (client_id).
--  * Protección contra pagos duplicados: clave de idempotencia por
--    envío. Si el mismo formulario se manda dos veces (doble clic,
--    reintento de red) se devuelve el lote ya registrado y NO se
--    vuelve a cobrar.
--  * Se valida que el pedido pertenezca a la empresa y no esté cancelado
--    (ya existía) y que el medio de pago esté activo en esa empresa.
--  * Todo ocurre en una sola transacción con el pedido bloqueado
--    (FOR UPDATE), por lo que dos pagos simultáneos no pueden superar
--    el saldo.
-- =========================================================

begin;

alter table public.payment_batches
  add column if not exists idempotency_key text;

create unique index if not exists payment_batches_company_idempotency_uidx
  on public.payment_batches(company_id, idempotency_key)
  where idempotency_key is not null;

-- Cambia la firma (nuevo parámetro opcional), por eso se elimina la anterior.
drop function if exists public.register_mixed_payment_v2(uuid,uuid,jsonb,text);

create or replace function public.register_mixed_payment_v2(
  p_company_id uuid,
  p_order_id uuid,
  p_lines jsonb,
  p_notes text default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_existing_batch uuid;
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
  v_client_id uuid;
  v_client_name text;
  v_key text := nullif(trim(coalesce(p_idempotency_key,'')),'');
  v_concept text;
begin
  if auth.uid() is null then raise exception 'Debés iniciar sesión'; end if;
  if not public.has_company_permission(p_company_id,'payments.write') then
    raise exception 'No tenés permiso para registrar pagos';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 then
    raise exception 'Agregá al menos un medio de pago';
  end if;

  -- Bloquea el pedido: serializa pagos simultáneos sobre el mismo pedido.
  select o.total, o.order_number, o.client_id
    into v_order_total, v_order_number, v_client_id
  from public.orders o
  where o.id = p_order_id
    and o.company_id = p_company_id
    and o.status <> 'cancelled'
  for update;

  if v_order_total is null then raise exception 'Pedido inexistente o cancelado'; end if;

  -- Idempotencia: mismo envío repetido => devolver el lote ya guardado.
  if v_key is not null then
    select pb.id into v_existing_batch
    from public.payment_batches pb
    where pb.company_id = p_company_id
      and pb.idempotency_key = v_key
    limit 1;

    if v_existing_batch is not null then
      return v_existing_batch;
    end if;
  end if;

  select coalesce(sum(p.amount),0)
    into v_paid
  from public.payments p
  where p.company_id = p_company_id and p.order_id = p_order_id;

  v_balance := greatest(v_order_total - v_paid, 0);

  if v_balance <= 0 then
    raise exception 'El pedido ya está pagado en su totalidad';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_amount := coalesce((v_line->>'amount')::numeric,0);
    v_method_id := nullif(v_line->>'payment_method_id','')::uuid;

    if v_amount <= 0 then raise exception 'Todos los montos deben ser mayores a cero'; end if;

    if v_method_id is null or not exists(
      select 1 from public.payment_methods pm
      where pm.id = v_method_id
        and pm.company_id = p_company_id
        and pm.enabled = true
    ) then
      raise exception 'Medio de pago inválido';
    end if;

    v_total := v_total + v_amount;
  end loop;

  if v_total > v_balance then
    raise exception 'El pago (%) supera el saldo pendiente (%)', v_total, v_balance;
  end if;

  select c.name into v_client_name
  from public.clients c
  where c.id = v_client_id and c.company_id = p_company_id;

  v_concept := 'Pago pedido #' || lpad(v_order_number::text,5,'0')
    || case when v_client_name is not null and length(trim(v_client_name)) > 0
            then ' - ' || trim(v_client_name) else '' end;

  insert into public.payment_batches(company_id,order_id,total_amount,notes,created_by,idempotency_key)
  values(p_company_id,p_order_id,v_total,nullif(trim(coalesce(p_notes,'')),''),auth.uid(),v_key)
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
      payment_method_id,order_id,payment_id,client_id,reference,
      occurred_at,source,created_by
    ) values(
      p_company_id,'income','order_payment',v_concept,
      v_amount,v_method_id,p_order_id,v_payment_id,v_client_id,v_reference,
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

grant execute on function public.register_mixed_payment_v2(uuid,uuid,jsonb,text,text)
to authenticated;

-- Corrige los movimientos de Caja de pagos ya registrados: agrega el
-- cliente y el nombre en el concepto (solo si todavía no lo tienen).
update public.cash_movements cm
set client_id = o.client_id
from public.orders o
where cm.order_id = o.id
  and cm.company_id = o.company_id
  and cm.source = 'order_payment'
  and cm.client_id is null;

update public.cash_movements cm
set concept = cm.concept || ' - ' || trim(c.name)
from public.clients c
where cm.client_id = c.id
  and cm.company_id = c.company_id
  and cm.source = 'order_payment'
  and cm.concept ~ '^Pago pedido #[0-9]+$';

commit;
