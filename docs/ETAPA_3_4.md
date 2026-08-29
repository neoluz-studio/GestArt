# GestArt — Etapas 3 + 4

## Etapa 3 — Dashboard real

El dashboard deja de depender de datos demo cuando `NEXT_PUBLIC_DEMO_MODE=false`.

Incluye:

- Métricas por `company_id`.
- Pedidos activos.
- Trabajos en producción.
- Pedidos listos.
- Ingresos del día.
- Pendiente de cobro.
- Stock bajo.
- Clientes activos.
- Presupuestos abiertos.
- Pedidos recientes.
- Actividad reciente.
- Gráfico de facturación de los últimos 7 días.
- Widgets activables/desactivables por empresa.
- Estados de carga, vacío y error.

La función SQL `get_dashboard_overview` consolida las métricas principales sin mezclar tenants.

## Etapa 4 — Clientes

El módulo Clientes ahora trabaja con Supabase real.

Incluye:

- Crear cliente.
- Editar cliente.
- Marcar cliente activo/inactivo.
- Borrado seguro.
- Búsqueda.
- Exportación CSV.
- CUIT/DNI.
- Teléfono.
- Email.
- Empresa.
- Dirección.
- Instagram.
- Observaciones.
- Cantidad de pedidos.
- Cantidad de presupuestos.
- Total comprado.
- Total pagado.
- Saldo pendiente.
- Ficha lateral del cliente.
- Pedidos recientes del cliente.
- Presupuestos recientes del cliente.
- Pagos recientes del cliente.
- Auditoría automática al crear, editar o eliminar.

## Seguridad

La migración reemplaza las políticas genéricas de `clients` por políticas basadas en:

- `clients.read`
- `clients.write`

El `company_id` se sigue validando desde PostgreSQL mediante RLS.

## Migración

Si Etapa 1 y Etapa 2 ya están cargadas, ejecutar solamente:

```text
supabase/migrations/0003_dashboard_clients.sql
```

No volver a ejecutar `0001` ni `0002` en una base que ya está funcionando.

## Actualización local

1. Detener GestArt con `Ctrl + C`.
2. Copiar esta entrega sobre la carpeta actual y reemplazar archivos.
3. Mantener el `.env.local` existente.
4. Ejecutar:

```bash
npm install
npm run dev
```

5. Entrar a `http://localhost:3000`.
