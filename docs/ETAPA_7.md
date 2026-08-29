# ETAPA 7 — Materiales + Inventario

Esta etapa conecta el inventario real de GestArt con PostgreSQL/Supabase.

## Incluye

- CRUD de materiales.
- Código, categoría, unidad, stock mínimo, costo, proveedor y ubicación.
- Archivado/restauración sin borrar historial.
- Entradas, salidas y ajustes transaccionales.
- Bloqueo de stock negativo salvo que la empresa lo permita.
- Stock actual calculado en la misma transacción.
- Historial con saldo después de cada movimiento.
- Alertas de stock bajo.
- Valor económico del inventario.
- Búsqueda y filtros.
- Alta rápida de proveedor.
- Salidas vinculables a pedidos.
- Consumo de materiales relacionado con producción.
- Auditoría en `activity_logs`.
- Permisos `inventory.read` / `inventory.write`.
- RLS por `company_id`.

## Flujo

Pedido → Producción → Salida de material → Stock → Historial

Una salida vinculada a un pedido crea también un registro en
`production_material_usage`, manteniendo la trazabilidad productiva.

## Instalación

Si ya ejecutaste las migraciones 0001 a 0005, ejecutar solamente:

`supabase/migrations/0006_inventory_materials.sql`

Luego:

```bash
npm install
npm run dev
```

Abrir:

`http://localhost:3000/materiales`

## Prueba recomendada

1. Crear un material con stock mínimo 10.
2. Registrar una entrada de 50.
3. Registrar una salida de 35 vinculada a un pedido.
4. Confirmar stock 15.
5. Registrar salida de 6.
6. Confirmar stock 9 y alerta de stock bajo.
7. Verificar:
   - `materials`
   - `stock_movements`
   - `production_material_usage`
   - `activity_logs`
