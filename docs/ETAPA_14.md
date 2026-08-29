# GestArt — Etapa 14 / Versión 1.0

Esta etapa cierra la primera versión completa de GestArt.

## Correcciones incorporadas

- Los módulos desactivados ahora permanecen realmente ocultos.
- TenantContext carga módulos activos e inactivos.
- Sidebar y buscador global respetan:
  - habilitado/deshabilitado,
  - nombre personalizado,
  - icono personalizado,
  - orden personalizado.
- Configuración → Navegación ahora es funcional.
- Drag & drop para ordenar módulos.
- Los módulos esenciales no pueden desactivarse.
- Configuración → Sistema ahora permite:
  - país,
  - moneda,
  - formato regional,
  - zona horaria,
  - tema.
- Configuración → Seguridad permite cambiar la contraseña del usuario actual.
- Pantalla de error por módulo.
- Pantalla 404.
- Hardening del historial para volverlo append-only desde clientes autenticados.
- Dependencias PDF fijadas:
  - `jspdf 2.5.2`
  - `jspdf-autotable 3.8.4`.

## Migración

Si ya ejecutaste hasta Etapa 12, ejecutar:

`supabase/migrations/0012_final_hardening.sql`

Etapa 13 no tenía SQL.

## Validación recomendada

```bash
npm install
npm run typecheck
npm run build
```

También existe:

```bash
npm run check
```

que ejecuta typecheck + build.

## Flujos críticos a probar

### Comercial
Cliente → Presupuesto → Aprobación → Pedido.

### Cobros
Pedido → Pago parcial/mixto → Caja → Historial → Reportes.

### Producción
Pedido → Producción → Material → Stock → Historial.

### Documentos
Configuración de empresa → Presupuesto/Pedido → PDF → Impresión.

### Multiempresa
Cambiar de empresa y comprobar que:
- clientes cambian,
- pedidos cambian,
- caja cambia,
- inventario cambia,
- historial cambia,
- identidad y PDFs cambian.

### Navegación
Configuración → Navegación:
- renombrar módulo,
- cambiar icono,
- desactivar un módulo no esencial,
- arrastrar para ordenar,
- guardar,
- recargar navegador.

### Responsive
- 1440 px
- 1024 px
- 768 px
- 430 px
- 360 px

## Resultado esperado

La aplicación debe poder recorrer todos los módulos sin errores de consola
bloqueantes, mantener aislamiento por tenant y producir documentos con la
identidad de la empresa activa.
