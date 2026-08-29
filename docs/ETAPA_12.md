# ETAPA 12 — PDFs + Impresión profesional

Esta etapa agrega documentos profesionales personalizados por empresa.

## Presupuestos

Desde el detalle de un presupuesto aparecen:

- Descargar PDF.
- Imprimir.

El documento incluye, según configuración:

- Logo de la empresa.
- Nombre comercial y razón social.
- CUIT / identificación fiscal.
- Dirección.
- Teléfono.
- Email.
- Sitio web.
- Cliente y sus datos.
- Número de presupuesto.
- Fecha de emisión.
- Vigencia.
- Estado.
- Ítems, cantidades, precios y totales.
- Descuento.
- Observaciones.
- Métodos de pago activos.
- Banco, titular, CBU/CVU, alias y cuenta.
- Términos y condiciones.
- Pie personalizado.

## Pedidos

Desde el detalle del pedido se puede:

- Descargar PDF.
- Imprimir.

Incluye:

- identidad de empresa,
- cliente,
- número de pedido,
- fecha,
- entrega,
- estado,
- ítems,
- subtotal,
- descuento,
- total,
- pagado,
- saldo pendiente,
- datos de pago,
- observaciones,
- pie del pedido.

## Reportes

`/reportes` suma:

- Descargar PDF.
- Imprimir.
- Exportar CSV (ya existente).

El PDF ejecutivo incluye identidad de empresa, período, KPIs, top clientes e
inventario destacado.

## Configuración documental

En `/configuracion` se puede definir:

### Empresa
- Logo mediante carga de archivo.
- Nombre comercial.
- Razón social.
- CUIT.
- Teléfono.
- WhatsApp.
- Email.
- Sitio web.
- Dirección, ciudad y provincia.

### Apariencia
- Color principal.
- Color secundario.
- Color de acento.
- Mostrar u ocultar logo, CUIT, contacto y datos de pago.

### Presupuestos
- Plantilla.
- Texto de encabezado.
- Términos y condiciones.
- Pie de presupuesto.
- Pie de pedido.
- Vista previa del encabezado.

### Pagos
- Banco / billetera.
- Titular.
- CBU / CVU.
- Alias.
- Número de cuenta.
- Información adicional.

Además, los métodos de pago activos de la empresa se incorporan de forma
automática al documento.

## Logo

La migración crea el bucket público:

`company-assets`

La aplicación guarda los archivos en una carpeta cuyo primer segmento es el
`company_id`. Las políticas de Storage permiten escribir sólo a miembros de
esa empresa.

## Auditoría

Cada acción de:

- generar PDF,
- imprimir,

se registra en `activity_logs` mediante `log_document_action`.

## Dependencias nuevas

La Etapa 12 agrega:

- `jspdf`
- `jspdf-autotable`

Por eso, después de copiar esta entrega, ejecutar:

```bash
npm install
npm run dev
```

## Migración

Si la Etapa 11 ya está aplicada, ejecutar solamente:

`supabase/migrations/0011_documents_pdf_print.sql`

## Prueba recomendada

1. Ir a Configuración → Empresa.
2. Subir el logo.
3. Completar CUIT, teléfono, email y dirección.
4. Ir a Configuración → Presupuestos.
5. Escribir términos y pie.
6. Ir a Configuración → Pagos.
7. Completar banco, CBU/CVU y alias.
8. Guardar.
9. Abrir un presupuesto real.
10. Descargar PDF.
11. Verificar logo y datos comerciales.
12. Presionar Imprimir.
13. Abrir un pedido y repetir la prueba.
14. Ir a Reportes y descargar un PDF ejecutivo.
15. Revisar Historial para confirmar la auditoría de exportaciones.
