# GestArt — Etapa 13

## Rebranding completo

Desde esta entrega el producto deja de llamarse GestArt y pasa a llamarse:

**GestArt**

El cambio se aplicó a:

- Sidebar y marca principal.
- Login.
- Onboarding.
- Dashboard.
- Textos de ayuda.
- Configuración.
- Historial.
- Reportes.
- PDFs e impresión.
- Títulos HTML y metadata.
- Health endpoint.
- Archivos demo.
- Descargas CSV.
- Documentación.
- Comentarios de migraciones.
- Prefijos CSS internos.
- Nombre del paquete npm.
- `.env.example`.
- Archivo de estilos principal, ahora `src/styles/gestart.css`.

Los datos comerciales de las empresas/tenants no se cambian.

## Responsive + UX

La Etapa 13 también agrega:

- Sidebar móvil con backdrop real.
- Cierre del sidebar al navegar.
- Cierre con tecla Escape.
- Bloqueo de scroll al tener un panel móvil abierto.
- Barra inferior móvil con accesos a:
  - Inicio.
  - Clientes.
  - Pedidos.
  - Producción.
  - Más.
- Buscador global `Ctrl/Cmd + K`.
- Búsqueda de módulos y navegación.
- Modales tipo bottom-sheet en celular.
- Drawers adaptados a celular.
- Cabeceras y acciones sticky dentro de modales.
- Mejoras de tablas con scroll táctil.
- Kanban con scroll horizontal mejorado.
- Formularios en una sola columna en pantallas pequeñas.
- Métricas adaptativas.
- Safe areas para móviles.
- Mejoras de foco y accesibilidad.
- Enlace “Saltar al contenido”.
- Compatibilidad con `prefers-reduced-motion`.

## Supabase

**Esta etapa no agrega migraciones SQL.**

Si la Etapa 12 ya está funcionando, no tenés que ejecutar nada nuevo en
Supabase para la Etapa 13.

## Instalación

1. Detener el proyecto.
2. Copiar todo el contenido de `GESTART_ETAPA13` encima del proyecto actual.
3. Conservar `.env.local`.
4. En `.env.local`, si todavía existe:

```env
NEXT_PUBLIC_APP_NAME=GestArt
```

cambiarlo por:

```env
NEXT_PUBLIC_APP_NAME=GestArt
```

Aunque el frontend ya usa GestArt directamente, conviene dejar el entorno
consistente.

5. Ejecutar:

```bash
npm install
npm run dev
```

## Prueba responsive

Revisar como mínimo:

- 1440 px escritorio.
- 1024 px tablet.
- 768 px tablet vertical.
- 430 px celular.
- 360 px celular pequeño.

Probar:

- Sidebar.
- Barra inferior.
- Ctrl/Cmd + K.
- Dashboard.
- Clientes.
- Pedidos.
- Presupuestos.
- Producción.
- Materiales.
- Caja.
- Historial.
- Reportes.
- Configuración.
- Usuarios.
- Modales.
- Drawers.
- PDFs e impresión.

La próxima etapa es la **Etapa 14 — Testing y corrección final**.
