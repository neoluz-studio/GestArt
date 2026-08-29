insert into public.modules(code,default_label,default_icon,is_core) values
('dashboard','Inicio','home',true),('clients','Clientes','users',true),('quotes','Presupuestos','quote',true),('orders','Pedidos','orders',true),('production','Producción','production',false),('materials','Materiales','materials',false),('cash','Caja y pagos','cash',true),('reports','Reportes','reports',true),('history','Historial','history',true),('settings','Configuración','settings',true)
on conflict(code) do nothing;

insert into public.permissions(code,description) values
('company.manage','Administrar empresa'),('users.manage','Administrar usuarios'),('clients.read','Ver clientes'),('clients.write','Modificar clientes'),('orders.read','Ver pedidos'),('orders.write','Modificar pedidos'),('payments.write','Registrar pagos'),('cash.read','Ver caja'),('cash.write','Modificar caja'),('inventory.read','Ver inventario'),('inventory.write','Modificar inventario'),('reports.read','Ver reportes'),('audit.read','Ver historial') on conflict(code) do nothing;


insert into public.permissions(code,description) values
('roles.manage','Administrar roles y permisos'),
('quotes.read','Ver presupuestos'),
('quotes.write','Crear y modificar presupuestos'),
('production.read','Ver producción'),
('production.write','Modificar producción'),
('settings.read','Ver configuración')
on conflict(code) do nothing;
