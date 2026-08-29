# ETAPA 2 — Autenticación + Multiempresa

## Flujo

Usuario
→ Supabase Auth
→ `company_memberships`
→ tenant actual
→ rol
→ permisos
→ RLS
→ módulos y datos de esa empresa

## Onboarding

La función SQL `create_company_with_admin` realiza en una sola transacción:

1. crea `companies`,
2. crea `company_settings`,
3. crea rol Administrador,
4. crea membresía,
5. asigna todos los permisos,
6. configura módulos,
7. crea métodos de pago,
8. registra actividad.

## Invitaciones

`POST /api/users/invite`:

1. valida el JWT,
2. comprueba `users.manage`,
3. valida que el rol pertenezca al tenant,
4. usa Service Role sólo en servidor,
5. invita por Supabase Auth,
6. crea membresía de esa empresa.

## Aislamiento

Los datos de negocio no se guardan en localStorage.

`sessionStorage` se usa únicamente para recordar qué empresa seleccionó el usuario durante la sesión. La información real permanece en PostgreSQL.
