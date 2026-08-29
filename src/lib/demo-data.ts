export const company = {
  id: "demo-company",
  name: "Gráfica López",
  legalName: "Gráfica López S.R.L.",
  initials: "GL",
  taxId: "30-71234567-8",
  phone: "+54 9 266 412 8890",
  email: "hola@graficalopez.com",
  currency: "ARS",
  locale: "es-AR",
  theme: { primary: "#6d4aff", accent: "#b9ff66" }
};

export const user = { name: "Lionel", fullName: "Lionel Gaitán", initials: "LG", email: "admin@gestart.local", role: "Administrador" };

export const clients = [
  { id:"C-001", name:"Juan Pérez", company:"JP Eventos", phone:"+54 9 266 400-1001", email:"juan@jpeventos.com", orders:8, total:485000, balance:0 },
  { id:"C-002", name:"María López", company:"López Estudio", phone:"+54 9 266 400-1002", email:"maria@lopezestudio.com", orders:12, total:720000, balance:45000 },
  { id:"C-003", name:"Metalúrgica San Juan", company:"Metalúrgica San Juan", phone:"+54 9 264 500-2000", email:"compras@msj.com", orders:15, total:1260000, balance:120000 },
  { id:"C-004", name:"Estudio Creativo", company:"Estudio Creativo", phone:"+54 9 266 455-7733", email:"hola@estudiocreativo.com", orders:6, total:298000, balance:0 },
  { id:"C-005", name:"Transporte Andino", company:"Transporte Andino", phone:"+54 9 266 487-1110", email:"contacto@transporteandino.com", orders:4, total:392000, balance:68000 }
];

export const orders = [
  { number:"00251", client:"Juan Pérez", detail:"500 tarjetas personales premium", total:85000, paid:85000, status:"En producción", priority:"Alta", due:"30/08/2026", responsible:"Producción" },
  { number:"00250", client:"María López", detail:"2 carteles PVC + diseño", total:120000, paid:75000, status:"Pendiente de entrega", priority:"Normal", due:"29/08/2026", responsible:"Lionel" },
  { number:"00249", client:"Metalúrgica San Juan", detail:"Señalética industrial completa", total:310000, paid:190000, status:"Confirmado", priority:"Normal", due:"03/09/2026", responsible:"Ventas" },
  { number:"00248", client:"Estudio Creativo", detail:"1000 flyers A5 full color", total:92000, paid:46000, status:"Diseño", priority:"Urgente", due:"29/08/2026", responsible:"Diseño" },
  { number:"00247", client:"Transporte Andino", detail:"Ploteo parcial de vehículo", total:245000, paid:245000, status:"Listo", priority:"Alta", due:"31/08/2026", responsible:"Producción" }
];

export const quotes = [
  { number:"P-0108", client:"Estudio Creativo", detail:"Packaging + etiquetas", total:92000, status:"Enviado", date:"28/08/2026", validUntil:"12/09/2026" },
  { number:"P-0107", client:"Transporte Andino", detail:"Ploteo de flota", total:245000, status:"Aprobado", date:"27/08/2026", validUntil:"08/09/2026" },
  { number:"P-0106", client:"Comercio Centro", detail:"Cartelería exterior", total:68000, status:"Borrador", date:"27/08/2026", validUntil:"15/09/2026" },
  { number:"P-0105", client:"Metalúrgica San Juan", detail:"Señalética planta", total:310000, status:"Aprobado", date:"25/08/2026", validUntil:"09/09/2026" }
];

export const materials = [
  { code:"PAP-300", name:"Papel ilustración 300g", category:"Papeles", unit:"hojas", stock:25, minimum:10, cost:800, supplier:"Papelera Centro" },
  { code:"VIN-BLA", name:"Vinilo blanco brillante", category:"Vinilos", unit:"m²", stock:8.5, minimum:12, cost:6400, supplier:"Visual Supply" },
  { code:"PVC-3MM", name:"PVC espumado 3mm", category:"Rígidos", unit:"placas", stock:4, minimum:5, cost:11500, supplier:"Visual Supply" },
  { code:"TINT-CYA", name:"Tinta cyan eco-solvente", category:"Tintas", unit:"litros", stock:3.2, minimum:2, cost:28000, supplier:"Insumos Print" },
  { code:"LAM-MAT", name:"Laminado mate", category:"Terminaciones", unit:"m²", stock:22, minimum:10, cost:4200, supplier:"Insumos Print" }
];

export const cashMovements = [
  { date:"29/08/2026 10:42", type:"Ingreso", concept:"Pago pedido #00251", method:"Transferencia", amount:40000, user:"Lionel" },
  { date:"29/08/2026 10:42", type:"Ingreso", concept:"Pago pedido #00251", method:"Efectivo", amount:20000, user:"Lionel" },
  { date:"29/08/2026 09:18", type:"Egreso", concept:"Compra vinilo blanco", method:"Transferencia", amount:-48000, user:"Lionel" },
  { date:"28/08/2026 17:30", type:"Ingreso", concept:"Seña presupuesto P-0107", method:"Mercado Pago", amount:80000, user:"Lionel" }
];

export const activity = [
  { time:"29/08 10:42", title:"Pago mixto registrado", text:"Pedido #00251 · $20.000 efectivo + $40.000 transferencia" },
  { time:"29/08 10:20", title:"Pedido pasó a producción", text:"#00251 · Juan Pérez · cambiado por Producción" },
  { time:"29/08 09:18", title:"Movimiento de stock", text:"Salida 7 m² de vinilo para pedido #00247" },
  { time:"28/08 18:00", title:"Presupuesto aprobado", text:"P-0107 · Transporte Andino · convertido a pedido" },
  { time:"28/08 16:45", title:"Cliente actualizado", text:"Metalúrgica San Juan · datos comerciales modificados" }
];

export const money = (n:number) => new Intl.NumberFormat("es-AR", {style:"currency", currency:"ARS", maximumFractionDigits:0}).format(n);
