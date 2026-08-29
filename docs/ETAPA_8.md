# ETAPA 8 — Caja + Ingresos + Egresos + Cierres

## Incluye

- Caja real por `company_id`.
- Pagos de pedidos impactan automáticamente.
- Ingresos manuales.
- Egresos manuales.
- Categorías.
- Proveedor en egresos.
- Medio de pago.
- Referencia/comprobante.
- Fecha y hora del movimiento.
- Saldo total.
- Ingresos y egresos del día.
- Saldo por medio de pago.
- Filtros por tipo, método y fechas.
- Cierre de caja.
- Saldo inicial.
- Ingresos del período.
- Egresos del período.
- Saldo esperado.
- Saldo real.
- Diferencia.
- Usuario que realizó el cierre.
- Historial de cierres.
- Reversión auditable: los movimientos no se borran.
- Integración opcional de compra de material:
  `entrada stock + egreso caja + auditoría` en una sola transacción.

## Migración

Si ya ejecutaste hasta `0006_inventory_materials.sql`, ejecutar solamente:

`supabase/migrations/0007_cash_income_expenses_closures.sql`

## Prueba principal

1. Abrir Caja.
2. Registrar ingreso manual de $50.000 en Efectivo.
3. Registrar egreso de $15.000 por Transferencia.
4. Verificar los saldos por método.
5. Crear un pedido y registrar un pago mixto.
6. Confirmar que cada línea aparece en Caja.
7. Hacer un cierre con saldo real distinto al esperado.
8. Verificar la diferencia y el historial.
9. En Materiales, registrar una entrada marcando
   “Registrar también el egreso en Caja”.
10. Confirmar:
   - `stock_movements`
   - `cash_movements`
   - `cash_closures`
   - `activity_logs`

## Integridad

GestArt no elimina movimientos contables desde la UI.

Para corregir un ingreso/egreso manual se utiliza una **reversión**, que genera
el movimiento opuesto y conserva la trazabilidad.

## Nota de compatibilidad de Etapa 7

La copia de `0006_inventory_materials.sql` incluida en este ZIP fue reforzada para
crear la tabla `suppliers` y las columnas de inventario que necesita el módulo.
Es seguro reejecutarla: utiliza `IF NOT EXISTS` y políticas idempotentes.
