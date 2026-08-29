# GestArt — arquitectura

GestArt es la plataforma. La empresa cliente es el tenant.

Frontend: Next.js + React + TypeScript.
Backend: Supabase.
Base: PostgreSQL.
Autenticación: Supabase Auth.
Seguridad: RLS + `company_id` + membresías.

## Flujo
Usuario → Auth → company_memberships → tenant actual → módulos activos → datos filtrados por RLS.

## Diseño
La fuente visual oficial de esta recreación es:
- `reference-design/index.html`
- `reference-design/pedidos.html`
- `reference-design/presupuestos.html`
- `reference-design/css/base.css`
- `reference-design/css/pedidos.css`
- `reference-design/css/presupuestos.css`

El resto de los módulos reutiliza variables, radios, sombras, tipografías, sidebar, tarjetas y patrones derivados de esos archivos.
