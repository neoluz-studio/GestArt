# Etapa 17 — Productos compuestos (bar, gastronomía)

Al vender un producto compuesto se descuentan del stock sus componentes.

Ejemplo de bar:
- Insumo «Cerveza barril» → 50 litros, costo $2.500 el litro (no se vende al público).
- «Vaso de cerveza» → lleva 0,4 litros de barril. Costo $1.000, precio $3.000.
- «Fernet con 5 gaseosas» → lleva 1 Fernet + 5 gaseosas. Descuenta las seis cosas.

## Dónde se usa
- **Productos**: cargar los insumos y destildar «Se vende al público».
- **Recetas y costeo → Productos compuestos**: armar lo que se vende con esos insumos.
- **Ventas**: el producto compuesto aparece con «Podés vender: N» según los insumos.
- Anular una venta devuelve cada componente al stock.

## Instalación
1. Copiar esta carpeta sobre el proyecto (reemplazar archivos).
2. En Supabase → SQL Editor, pegar el CONTENIDO de `0018_composite_products.sql` y ejecutar.
3. Reiniciar `npm run dev`.

## Reglas
- Un componente no puede ser a la vez un producto compuesto (no hay compuestos anidados).
- Cantidades con hasta 3 decimales, en la unidad del componente (litros, unidades, etc.).
- El costo del compuesto se calcula con el costo actual de sus componentes.
- Si falta algún insumo, la venta se rechaza completa y no se descuenta nada.

## Rubro Bar
El registro ahora tiene «Bar / restaurante»: preselecciona Productos, Ventas, Recetas y Caja
(sin Pedidos ni Presupuestos). El cliente puede tocar «Activar todos» o ajustar uno por uno.

## Archivos
Nuevos: `supabase/migrations/0018_composite_products.sql`, `src/features/recipes/CompositePanel.tsx`.
Reemplazados: `src/services/products.ts`, `src/features/products/ProductsClient.tsx`,
`src/features/sales/SalesClient.tsx`, `src/features/recipes/RecipesClient.tsx`,
`src/app/onboarding/page.tsx`, `src/styles/pos.css`.
