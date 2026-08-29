# ETAPA 10 — Presupuestos + Conversión a Pedido

## Incluye

- Presupuestos reales por `company_id`.
- Numeración automática por empresa.
- Cliente.
- Fecha de emisión.
- Vigencia.
- Múltiples ítems.
- Cantidad.
- Precio unitario.
- Subtotal.
- Descuento.
- Total.
- Observaciones.
- Estados:
  - Borrador.
  - Enviado.
  - Aprobado.
  - Rechazado.
  - Vencido.
  - Convertido.
  - Cancelado.
- Detección automática visual de vencidos.
- Edición.
- Duplicación como nuevo borrador.
- Trazabilidad de envío, aprobación, rechazo y conversión.
- Conversión atómica `Presupuesto -> Pedido`.
- El pedido conserva `source_quote_id`.
- Copia automática de todos los ítems.
- Copia de subtotal, descuento y total.
- Selección de prioridad y fecha de entrega al convertir.
- El pedido confirmado entra automáticamente al flujo de Producción gracias al trigger de Etapa 6.
- Historial general reconoce el módulo Presupuestos.
- Dashboard corrige el conteo de presupuestos abiertos.
- Permisos:
  - `quotes.read`
  - `quotes.write`
  - `quotes.convert`
- RLS por empresa.

## Flujo

Presupuesto
  → Enviado
  → Aprobado
  → Convertir
  → Pedido confirmado
  → Producción
  → Pagos
  → Caja
  → Historial

## Integridad

La conversión es transaccional.

Si falla la creación del pedido o la copia de cualquiera de sus ítems, el
presupuesto no queda marcado como convertido.

Además existe un índice único sobre:

`orders(company_id, source_quote_id)`

por lo que un presupuesto no puede generar dos pedidos.

## Instalación

Si ya ejecutaste correctamente hasta Etapa 9, ejecutar solamente:

`supabase/migrations/0009_quotes_conversion.sql`

Luego:

```bash
npm run dev
```

Abrir:

`http://localhost:3000/presupuestos`

## Prueba recomendada

1. Crear un presupuesto para un cliente real.
2. Agregar 2 o 3 ítems.
3. Guardarlo como borrador.
4. Marcarlo enviado.
5. Aprobarlo.
6. Convertirlo a pedido.
7. Ir a Pedidos.
8. Confirmar:
   - mismo cliente,
   - mismos ítems,
   - mismos precios,
   - mismo descuento,
   - mismo total.
9. Ir a Producción y comprobar que el pedido aparece.
10. Ir a Historial y filtrar por Presupuestos.
11. Revisar en Supabase:
   - `quotes`
   - `quote_items`
   - `orders`
   - `order_items`
   - `production_jobs`
   - `activity_logs`
