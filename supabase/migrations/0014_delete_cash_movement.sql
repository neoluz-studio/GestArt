-- =========================================================
-- El botón "Eliminar" de un movimiento de caja manual llamaba
-- a public.delete_cash_movement_safe, pero esa función nunca
-- se había creado en la base (había quedado solo el botón en
-- el frontend, con un comentario "acá después conectamos el
-- RPC real"). Esto hacía que tocar "Eliminar" tirara error.
--
-- Solo permite borrar movimientos manuales, no reversados y
-- que no sean ya una reversión de otro (mismas reglas que ya
-- usa reverse_cash_movement), para no romper la trazabilidad
-- de pagos de pedidos ni de reversiones.
-- =========================================================

create or replace function public.delete_cash_movement_safe(
  p_company_id uuid,
  p_movement_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement public.cash_movements%rowtype;
begin
  if not public.has_company_permission(p_company_id,'cash.write') then
    raise exception 'No tenés permiso para eliminar movimientos de caja';
  end if;

  select *
  into v_movement
  from public.cash_movements
  where id = p_movement_id and company_id = p_company_id
  for update;

  if not found then
    raise exception 'Movimiento inexistente';
  end if;

  if v_movement.source <> 'manual' then
    raise exception 'Los movimientos automáticos se corrigen desde su módulo de origen';
  end if;

  if v_movement.payment_id is not null or v_movement.order_id is not null then
    raise exception 'Este movimiento está vinculado a un pedido: usá "Revertir" en vez de eliminarlo';
  end if;

  if v_movement.reversal_of_id is not null then
    raise exception 'No se puede eliminar un contramovimiento de reversión';
  end if;

  if v_movement.reversed_by_id is not null then
    raise exception 'Este movimiento ya fue revertido; no hace falta eliminarlo';
  end if;

  delete from public.cash_movements
  where id = p_movement_id and company_id = p_company_id;
end;
$$;

grant execute on function public.delete_cash_movement_safe(uuid,uuid)
to authenticated;
