# ETAPA 9 — Historial + Auditoría General

La Etapa 9 convierte `/historial` en el centro de trazabilidad de GestArt.

## Incluye

- Historial real conectado a `activity_logs`.
- Aislamiento por `company_id`.
- Permiso `history.read`.
- Filtro por:
  - texto,
  - usuario,
  - módulo,
  - entidad,
  - fecha desde,
  - fecha hasta.
- Agrupación visual por día.
- Nombre y email del actor.
- Acción técnica y etiqueta amigable.
- Detalle completo del evento.
- Visualización de `metadata`.
- Exportación CSV.
- Métricas:
  - eventos de hoy,
  - eventos últimos 7 días,
  - usuarios activos,
  - tipos de entidad.
- Auditoría adicional de:
  - configuración de empresa,
  - usuarios/membresías,
  - navegación/módulos.
- Protección contra UPDATE/DELETE de `activity_logs`.

## Flujo auditado

Cliente
  → Pedido
  → Pago
  → Caja
  → Producción
  → Material
  → Stock
  → Cierre
  → Historial

Además:

Configuración
  → cambio
  → Historial

Usuario / rol
  → cambio
  → Historial

Navegación
  → cambio
  → Historial

## Instalación

Si ya ejecutaste correctamente hasta Etapa 8:

1. Copiar la carpeta de esta entrega sobre el proyecto actual.
2. Conservar `.env.local`.
3. En Supabase ejecutar solamente:

`supabase/migrations/0008_history_audit.sql`

4. Ejecutar:

```bash
npm run dev
```

5. Abrir:

`http://localhost:3000/historial`

## Prueba recomendada

1. Crear o editar un cliente.
2. Crear un pedido.
3. Registrar un pago.
4. Mover el pedido en Producción.
5. Registrar una salida de material.
6. Registrar un ingreso o egreso de Caja.
7. Hacer un cierre.
8. Ir a Historial.
9. Filtrar por módulo y usuario.
10. Abrir un evento y revisar sus metadatos.
11. Exportar CSV.

## Integridad

La interfaz no modifica ni elimina eventos.

La migración revoca `UPDATE` y `DELETE` sobre `activity_logs` al rol
`authenticated`. Se mantiene INSERT para compatibilidad con algunos triggers
anteriores `SECURITY INVOKER`; las próximas etapas pueden migrar todos los
escritores a funciones internas si se busca un registro totalmente append-only
incluso frente a clientes SQL maliciosos.
