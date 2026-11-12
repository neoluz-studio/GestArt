# Etapa 18 — Bar: vasos por porción, promos, cerveza tirada y ticket

## Los tres casos
1. **Bebida entera** (cerveza en botella, Fernet completo, gaseosa): producto normal, se vende y descuenta de a uno.
2. **Promo** (Fernet + gaseosa grande): producto compuesto con los componentes en **unidades enteras**.
3. **Vaso por proporción**:
   - *Por litros*: cerveza tirada cargada en litros; un vaso de 750 ml descuenta 0,75 litros.
   - *Por porciones de una botella*: el Fernet rinde 5 vasos. Cada vaso descuenta 1 gaseosa y 1 porción de Fernet;
     la botella se descuenta entera recién al servir el 5.º vaso. El stock siempre se ve en números enteros.

## Cómo cargarlo (ejemplo)
Productos (destildar «Se vende al público» en los insumos):
- Fernet: stock 30, costo de la botella, **«Cada unidad rinde» = 5**, nombre de la porción = vaso.
- Gaseosa 500 ml: stock 30, unidad.
- Cerveza tirada: unidad **litro**, stock en litros.
- Cerveza botella: se vende al público, stock en unidades.

Recetas y costeo → Productos compuestos:
- **Vaso de Fernet** (precio de venta): Fernet → 1 **vaso**; Gaseosa → 1 unidad.
- **Promo Fernet + gaseosa grande**: Fernet → 1 unidad; Gaseosa → 1 unidad.
- **Vaso de cerveza 750**: Cerveza tirada → 750 **ml** (el sistema descuenta 0,75 litros).

## Ticket
Ventas → al cobrar se abre el ticket (rollo 58 u 80 mm). También desde Historial → «Ver / imprimir ticket».
Para PDF: en el cuadro de impresión elegir «Guardar como PDF». Si el pago es en efectivo se puede indicar
cuánto recibió el cliente para mostrar el vuelto. El ticket aclara que no es válido como factura.

## Instalación
1. Copiar esta carpeta sobre el proyecto (reemplazar archivos). Requiere haber aplicado las etapas 15 a 17.
2. En Supabase → SQL Editor pegar el CONTENIDO de `0019_bar_portions.sql` y ejecutar.
3. Reiniciar `npm run dev`.

## Reglas
- Anular una venta devuelve las porciones y, si hace falta, recupera una botella entera.
- Si falta stock para completar un vaso, la venta se rechaza completa.
- Si se cambia el rendimiento de un producto (de 5 a 4 vasos), vale para las ventas siguientes.
- El costo del vaso se calcula: costo de la botella / porciones + costo de los demás componentes.
