# ETAPA 6 — Producción Kanban

## Objetivo

Conectar los pedidos reales con un tablero operativo de producción por empresa.

## Flujo

`Pedido → Producción → Etapa → Responsable → Historial`

Cada cambio de columna actualiza también el estado operativo del pedido.

## Columnas

1. Pendiente
2. Diseño
3. Esperando aprobación
4. Producción
5. Terminado
6. Entrega

## Funciones

- Board real desde PostgreSQL.
- Drag & drop entre columnas.
- Cambio de etapa desde el detalle, útil también en celular.
- Responsable por trabajo.
- Prioridad heredada del pedido.
- Fecha de entrega y alerta de vencido.
- Notas internas de producción.
- Búsqueda por número, cliente o trabajo.
- Filtro por prioridad.
- Filtro por responsable.
- Métricas del tablero.
- Auditoría en `activity_logs`.
- Sincronización bidireccional lógica entre `orders.status` y `production_jobs.status`.
- RLS endurecido con `production.read` y `production.write`.

## Migración

Si ya ejecutaste hasta Etapa 5, correr solamente:

`supabase/migrations/0005_production_kanban.sql`
