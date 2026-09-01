begin;


-- =========================================
-- Vincular caja con cliente y presupuesto
-- =========================================

alter table public.cash_movements
add column if not exists client_id uuid,
add column if not exists quote_id uuid;


alter table public.cash_movements
drop constraint if exists cash_movements_client_id_fkey;

alter table public.cash_movements
add constraint cash_movements_client_id_fkey
foreign key (client_id)
references public.clients(id)
on delete set null;


alter table public.cash_movements
drop constraint if exists cash_movements_quote_id_fkey;

alter table public.cash_movements
add constraint cash_movements_quote_id_fkey
foreign key (quote_id)
references public.quotes(id)
on delete set null;


create index if not exists cash_movements_company_client_idx
on public.cash_movements(company_id, client_id);


create index if not exists cash_movements_company_quote_idx
on public.cash_movements(company_id, quote_id);



-- =========================================
-- Actualizar función ingreso manual
-- =========================================

drop function if exists public.record_manual_cash_movement(
uuid,
text,
text,
text,
numeric,
uuid,
uuid,
text,
text,
timestamptz
);



create function public.record_manual_cash_movement(

  p_company_id uuid,

  p_movement_type text,

  p_concept text,

  p_category text,

  p_amount numeric,

  p_payment_method_id uuid,

  p_client_id uuid default null,

  p_quote_id uuid default null,

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


  if not public.has_company_permission(
    p_company_id,
    'cash.write'
  ) then
    raise exception 'No tenés permiso para registrar movimientos de caja';
  end if;


  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto debe ser mayor a cero';
  end if;


  v_occurred := coalesce(
    p_occurred_at,
    now()
  );


  insert into public.cash_movements(

    company_id,
    movement_type,
    category,
    concept,
    amount,

    payment_method_id,

    client_id,
    quote_id,

    supplier_id,

    notes,
    reference,

    occurred_at,

    source,
    created_by,
    created_at

  )

  values(

    p_company_id,

    p_movement_type,

    nullif(trim(coalesce(p_category,'')),''),

    trim(p_concept),

    p_amount,

    p_payment_method_id,


    p_client_id,

    p_quote_id,


    p_supplier_id,


    nullif(trim(coalesce(p_notes,'')),''),

    nullif(trim(coalesce(p_reference,'')),''),


    v_occurred,


    'manual',

    auth.uid(),

    now()

  )

  returning id into v_id;


  return v_id;

end;

$$;


grant execute on function public.record_manual_cash_movement(
uuid,
text,
text,
text,
numeric,
uuid,
uuid,
uuid,
uuid,
text,
text,
timestamptz
)
to authenticated;


commit;