# ETAPA 11 — Reportes reales

La Etapa 11 convierte `/reportes` en un módulo analítico conectado a Supabase.

## Incluye

### Resumen general
- Ventas del período.
- Cobros del período.
- Saldo pendiente de los pedidos creados en el período.
- Cantidad de pedidos.
- Ticket promedio.
- Clientes con actividad.
- Ingresos de caja.
- Egresos de caja.
- Neto de caja.
- Trabajos terminados.
- Tiempo promedio de producción.
- Valor actual del inventario.
- Cantidad de materiales con stock bajo.

### Ventas
- Evolución diaria de ventas.
- Evolución diaria de cobros.
- Pedidos por estado.
- Facturación por estado.
- Tasa de cobro.
- Distribución por medio de pago.

### Clientes
- Top clientes por ventas.
- Cantidad de pedidos.
- Total vendido.
- Total cobrado.
- Saldo pendiente.

### Producción
- Cantidad de trabajos por etapa.
- Trabajos vencidos.
- Trabajos terminados.
- Tiempo promedio entre inicio y finalización.

### Caja
- Ingresos.
- Egresos.
- Neto.
- Evolución diaria.

### Inventario
- Valor del stock actual.
- Stock actual y mínimo.
- Materiales con stock bajo.
- Cantidad consumida en el período.
- Valor estimado consumido.

### Exportación
El reporte actual puede exportarse en CSV desde la interfaz.

La exportación PDF con logo, encabezado y formato profesional queda para la
Etapa 12, junto con los PDFs de Presupuestos y Pedidos.

## Seguridad

Todas las funciones analíticas:

- reciben `company_id`,
- verifican `reports.read`,
- utilizan funciones `SECURITY DEFINER`,
- sólo devuelven datos del tenant solicitado.

## Migración

Si ya ejecutaste correctamente la Etapa 10, ejecutar solamente:

`supabase/migrations/0010_reports_analytics.sql`

## Prueba sugerida

1. Tener pedidos y pagos reales.
2. Registrar movimientos de Caja.
3. Mover pedidos por Producción.
4. Registrar movimientos de Materiales.
5. Abrir `/reportes`.
6. Cambiar entre:
   - 7 días,
   - 30 días,
   - 90 días,
   - este mes,
   - este año.
7. Abrir las pestañas:
   - General,
   - Ventas,
   - Clientes,
   - Producción,
   - Caja,
   - Inventario.
8. Exportar CSV.
9. Confirmar que los totales coinciden con los módulos operativos.
