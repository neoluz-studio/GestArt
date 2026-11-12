# Etapa 19 — Números con punto de miles mientras se escribe

Al escribir 10000 el campo muestra 10.000; la coma (o el punto) marca los decimales: 2500,75.
Aplica a precios, costos, cantidades, descuentos, montos de caja, señas y pagos.

- Componente nuevo: `src/components/NumberInput.tsx` (lógica en `src/lib/number-format.ts`).
- Usa los separadores del idioma configurado de la empresa (es-AR: punto de miles, coma decimal).
- Se puede escribir "." o "," como decimal; al pegar acepta 1.234,56, 1,234.56 y 10.000.
- Cantidades con hasta 3 decimales, importes con 2; no deja escribir letras.
- No hay cambios en la base de datos: sólo copiar los archivos.

Pantallas actualizadas: Caja, Inventario, Pedidos, Presupuestos, Productos, Ventas, Recetas y Productos compuestos.
