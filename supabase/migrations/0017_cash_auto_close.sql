-- =============================================================
-- GestArt ETAPA 16
-- Caja con horario: apertura 09:00 y cierre automático 00:00
-- (horarios configurables por empresa, en su zona horaria).
-- Ejecutar después de 0016_pos_products_recipes.sql
-- Es idempotente.
-- =============================================================

-- -------------------------------------------------------------
-- 1) Configuración por empresa
-- -------------------------------------------------------------
alter table public.company_settings
  add column if not exists cash_auto_close_enabled boolean not null default false,
  add column if not exists cash_open_time  time not null default '09:00',
  add column if not exists cash_close_time time not null default '00:00';

-- -------------------------------------------------------------
-- 2) Los cierres automáticos se muestran como tales
-- -------------------------------------------------------------
create or replace function public.get_cash_closures(p_company_id uuid)
returns table(
  id uuid,
  opened_at timestamptz,
  closed_at timestamptz,
  opening_balance numeric,
  income_total numeric,
  expense_total numeric,
  expected_balance numeric,
  actual_balance numeric,
  difference numeric,
  notes text,
  closed_by_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_company_permission(p_company_id,'cash.read')
    or public.has_company_permission(p_company_id,'cash.write')
  ) then
    raise exception 'No tenés permiso para ver cierres';
  end if;

  return query
  select
    cc.id,cc.opened_at,cc.closed_at,cc.opening_balance,
    cc.income_total,cc.expense_total,cc.expected_balance,
    cc.actual_balance,cc.difference,cc.notes,
    case
      when cc.closed_by is null then 'Cierre automático'
      else coalesce(nullif(trim(pr.full_name),''),'Usuario')
    end
  from public.cash_closures cc
  left join public.profiles pr on pr.user_id=cc.closed_by
  where cc.company_id=p_company_id
  order by cc.closed_at desc
  limit 100;
end;
$$;
grant execute on function public.get_cash_closures(uuid) to authenticated;

-- -------------------------------------------------------------
-- 3) Cierre automático (lo ejecuta el servidor, no el navegador)
--    Para cada empresa con la opción activa:
--      - calcula el último horario de cierre ya vencido (en su zona horaria)
--      - si no hay un cierre posterior y hubo movimientos, cierra la caja
--        con saldo real = saldo esperado y lo deja registrado.
--    Los movimientos posteriores al horario de cierre pasan al período siguiente.
-- -------------------------------------------------------------
create or replace function public.auto_close_cash_registers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_co record;
  v_local_now timestamp;
  v_due_local timestamp;
  v_due timestamptz;
  v_opened timestamptz;
  v_opening numeric(14,2);
  v_income numeric(14,2);
  v_expense numeric(14,2);
  v_expected numeric(14,2);
  v_moves integer;
  v_id uuid;
  v_closed integer := 0;
begin
  for v_co in
    select cs.company_id, cs.cash_close_time, cs.timezone
    from public.company_settings cs
    join public.companies c on c.id = cs.company_id
    where cs.cash_auto_close_enabled
      and c.status = 'active'
  loop
    begin
      v_local_now := now() at time zone v_co.timezone;
      v_due_local := date_trunc('day', v_local_now) + v_co.cash_close_time;
      if v_due_local > v_local_now then
        v_due_local := v_due_local - interval '1 day';
      end if;
      v_due := v_due_local at time zone v_co.timezone;

      perform pg_advisory_xact_lock(hashtext(v_co.company_id::text || ':cash-close'));

      -- ¿ya existe un cierre (manual o automático) posterior al horario?
      if exists (
        select 1 from public.cash_closures cc
        where cc.company_id = v_co.company_id and cc.closed_at >= v_due
      ) then
        continue;
      end if;

      select cps.opened_at, cps.opening_balance
      into v_opened, v_opening
      from public.cash_period_start(v_co.company_id) cps;

      -- Si el período todavía no arrancó antes del horario de cierre, no hay nada que cerrar
      if v_opened >= v_due then
        continue;
      end if;

      select
        count(*),
        coalesce(sum(case when cm.movement_type='income'  then cm.amount else 0 end),0),
        coalesce(sum(case when cm.movement_type='expense' then cm.amount else 0 end),0)
      into v_moves, v_income, v_expense
      from public.cash_movements cm
      where cm.company_id = v_co.company_id
        and cm.occurred_at >= v_opened
        and cm.occurred_at <  v_due;

      -- Sin movimientos no se genera un cierre vacío
      if v_moves = 0 then
        continue;
      end if;

      v_expected := v_opening + v_income - v_expense;

      insert into public.cash_closures(
        company_id,opened_at,closed_at,opening_balance,
        income_total,expense_total,expected_balance,actual_balance,
        difference,notes,closed_by
      ) values (
        v_co.company_id,v_opened,v_due,v_opening,
        v_income,v_expense,v_expected,v_expected,
        0,'Cierre automático (el saldo real se asume igual al esperado)',null
      )
      returning id into v_id;

      insert into public.activity_logs(
        company_id,user_id,action,entity_type,entity_id,description,metadata
      ) values (
        v_co.company_id,null,'cash.auto_closed','cash_closure',v_id::text,
        'Cierre automático de caja',
        jsonb_build_object(
          'closed_at',v_due,'income_total',v_income,'expense_total',v_expense,
          'expected_balance',v_expected
        )
      );

      v_closed := v_closed + 1;
    exception when others then
      -- Un error en una empresa no frena a las demás
      raise warning 'auto_close_cash_registers: empresa % -> %', v_co.company_id, sqlerrm;
    end;
  end loop;

  return v_closed;
end;
$$;

-- Sólo el servidor (cron) puede ejecutarla; nunca los usuarios desde el navegador.
revoke all on function public.auto_close_cash_registers() from public;
revoke all on function public.auto_close_cash_registers() from anon, authenticated;

-- -------------------------------------------------------------
-- 4) Programación: cada 10 minutos (requiere la extensión pg_cron)
--    En Supabase: Database > Extensions > pg_cron (activar una sola vez).
--    Si la extensión no está disponible, la migración NO falla: avisa por consola.
-- -------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;

  begin
    perform cron.unschedule('gestart-auto-close-cash');
  exception when others then
    null; -- no existía
  end;

  perform cron.schedule(
    'gestart-auto-close-cash',
    '*/10 * * * *',
    'select public.auto_close_cash_registers();'
  );
  raise notice 'Cierre automático de caja programado cada 10 minutos.';
exception when others then
  raise notice 'No se pudo programar pg_cron (%). Activá la extensión pg_cron y volvé a ejecutar este archivo.', sqlerrm;
end $$;
