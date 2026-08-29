# ETAPA 5 — Pedidos + pagos mixtos

## Incluido

- Listado real de pedidos por empresa.
- Búsqueda por número, cliente, empresa, teléfono o primer ítem.
- Filtros por estado y prioridad.
- Numeración automática y transaccional por empresa.
- Crear pedidos con múltiples ítems.
- Editar pedido completo.
- Subtotal, descuento y total calculados en PostgreSQL.
- Validación para que un pedido editado nunca quede por debajo de lo ya pagado.
- Estados completos del flujo operativo.
- Prioridades urgente / alta / normal / baja.
- Ficha lateral de pedido.
- Historial real de pagos.
- Pagos parciales.
- Pago mixto con varias líneas en una misma operación.
- Métodos: efectivo, transferencia, Mercado Pago, débito, crédito y otros.
- Cada línea de pago genera su movimiento de caja.
- Saldo calculado a partir de pagos reales.
- Bloqueo de pagos que exceden el saldo.
- Auditoría de creación, edición, cambio de estado, cancelación y pagos.
- Cancelación segura: si hay pagos, no permite cancelar hasta implementar devolución/ajuste.
- RLS/permisos por `company_id`.

## Migración

Si ya ejecutaste 0001, 0002 y 0003, ejecutar solamente:

`supabase/migrations/0004_orders_mixed_payments.sql`

## Flujo de pago mixto

Pedido $100.000

- Transferencia $40.000
- Efectivo $30.000
- Mercado Pago $30.000

La RPC `register_mixed_payment_v2` ejecuta toda la operación dentro de una única transacción PostgreSQL:

1. bloquea el pedido;
2. calcula el saldo actual;
3. valida medios y montos;
4. crea `payment_batches`;
5. crea las filas de `payments`;
6. crea un `cash_movements` por cada medio;
7. registra `activity_logs`;
8. si algo falla, PostgreSQL revierte toda la operación.
