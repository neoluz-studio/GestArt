# Etapa 15 — Módulo "Lo de Fausti" dentro de GestArt

Trae a GestArt la lógica del sistema de Fausti (productos, ventas con carrito y
descuentos, caja, recetas y proveedores), adaptada a multiempresa y con el diseño
de GestArt. El sistema de Fausti sigue funcionando por separado, sin cambios.

## Qué se agregó

| Fausti | En GestArt | Módulo (se activa por empresa) |
|---|---|---|
| productos | `products` + movimientos de stock | **Productos** |
| ventas + venta_detalle | `sales` + `sale_items`, descuento por producto y general | **Ventas** |
| caja | Se reutiliza la caja de GestArt: cada venta genera un ingreso | Caja y pagos (ya existía) |
| recetas + receta_ingredientes | `recipes` + `recipe_ingredients`, costo y margen | **Recetas y costeo** |
| proveedores | Se reutiliza `suppliers` de GestArt (Materiales / Caja) | ya existía |

## Caja con horario
- Configuración → Sistema → **Horario de caja**: apertura (09:00) y cierre automático (00:00).
- El cierre lo hace la base de datos (pg_cron, cada 10 min), no el navegador.
- Genera un cierre con saldo real = esperado y queda marcado como «Cierre automático».
- Si no hubo movimientos no se crea un cierre vacío.
- Las ventas se filtran por fecha (Ventas → Historial) y los cierres también (Caja y pagos).

## Pasos
1. Copiar esta carpeta sobre el proyecto, aceptando reemplazar archivos.
2. En Supabase activar la extensión **pg_cron** (Database → Extensions).
3. En el SQL Editor ejecutar, en orden: `0016_pos_products_recipes.sql` y `0017_cash_auto_close.sql`.
4. `npm install` (sin cambios en dependencias) y `npm run dev`.
5. En la app: Configuración → Navegación → activar Productos / Ventas / Recetas.
6. Configuración → Sistema → Horario de caja → activar el cierre automático.

## Notas
- Empresas existentes: los módulos nuevos aparecen **desactivados**.
- Empresas nuevas: el onboarding preselecciona módulos según el rubro (ej. Gastronomía).
- Los administradores existentes reciben los permisos nuevos. Otros roles necesitan
  `products.*`, `sales.*` o `recipes.*` asignados en `role_permissions`.
- Los precios y costos de cada venta se leen de la base de datos, no del navegador.
- Las ventas anuladas devuelven el stock y revierten el ingreso en caja.
- Los datos de Fausti **no** se importaron: es un paso aparte (ver README).

## Archivos reemplazados (existentes)
`src/app/layout.tsx`, `src/lib/navigation.ts`, `src/contexts/TenantContext.tsx`,
`src/features/cash/CashClient.tsx`, `src/features/settings/SystemSettings.tsx`,
`src/app/onboarding/page.tsx`.
