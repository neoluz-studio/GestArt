import type { SupabaseClient } from "@supabase/supabase-js";

export type OrderStatus =
  | "budget"
  | "pending_payment"
  | "confirmed"
  | "design"
  | "waiting_approval"
  | "approved"
  | "pending_production"
  | "in_production"
  | "ready"
  | "pending_delivery"
  | "delivered"
  | "cancelled";

export type OrderPriority = "urgent" | "high" | "normal" | "low";

export type OrderPickerSummary = {
  id: string;
  order_number: number;
  client_id: string;
  status: string;
  total: number;
  paid: number;
  balance: number;
  order_date: string;
};

export type OrderSummary = {
  id: string;
  order_number: number;
  client_id: string;
  client_name: string;
  client_company: string | null;
  client_phone: string | null;
  order_date: string;
  delivery_date: string | null;
  priority: string;
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  item_count: number;
  first_item: string | null;
  notes: string | null;
  created_at: string;
};

export type OrderItemInput = {
  id?: string;
  description: string;
  quantity: number;
  unit_price: number;
};

export type OrderInput = {
  client_id: string;
  order_date: string;
  delivery_date?: string | null;
  priority: OrderPriority;
  status: OrderStatus;
  discount: number;
  notes?: string | null;
  items: OrderItemInput[];
};

export type PaymentMethod = {
  id: string;
  code: string;
  name: string;
};

export type PaymentLineInput = {
  payment_method_id: string;
  amount: number;
  reference?: string | null;
};

export type OrderDetail = {
  order: OrderSummary & {
    created_by: string | null;
    updated_by: string | null;
  };
  items: Array<{
    id: string;
    description: string;
    quantity: number;
    unit_price: number;
    total: number;
    sort_order: number;
  }>;
  payments: Array<{
    id: string;
    payment_batch_id: string;
    amount: number;
    reference: string | null;
    created_at: string;
    method: string;
    method_code: string;
  }>;
};

export async function listOrders(
  supabase: SupabaseClient,
  companyId: string,
  filters: { search?: string; status?: string; priority?: string } = {}
): Promise<OrderSummary[]> {
  const { data, error } = await supabase.rpc("get_order_summaries", {
    p_company_id: companyId,
    p_search: filters.search?.trim() || null,
    p_status: filters.status || null,
    p_priority: filters.priority || null
  });

  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    order_number: Number(row.order_number ?? 0),
    subtotal: Number(row.subtotal ?? 0),
    discount: Number(row.discount ?? 0),
    total: Number(row.total ?? 0),
    paid: Number(row.paid ?? 0),
    balance: Number(row.balance ?? 0),
    item_count: Number(row.item_count ?? 0)
  })) as OrderSummary[];
}

export async function createOrder(
  supabase: SupabaseClient,
  companyId: string,
  input: OrderInput
): Promise<string> {
  const { data, error } = await supabase.rpc("create_order", {
    p_company_id: companyId,
    p_client_id: input.client_id,
    p_order_date: input.order_date,
    p_delivery_date: input.delivery_date || null,
    p_priority: input.priority,
    p_status: input.status,
    p_discount: input.discount,
    p_notes: input.notes?.trim() || null,
    p_items: input.items.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price)
    }))
  });

  if (error) throw error;
  return String(data);
}

export async function updateOrder(
  supabase: SupabaseClient,
  companyId: string,
  orderId: string,
  input: OrderInput
): Promise<void> {
  const { error } = await supabase.rpc("update_order", {
    p_company_id: companyId,
    p_order_id: orderId,
    p_client_id: input.client_id,
    p_order_date: input.order_date,
    p_delivery_date: input.delivery_date || null,
    p_priority: input.priority,
    p_status: input.status,
    p_discount: input.discount,
    p_notes: input.notes?.trim() || null,
    p_items: input.items.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price)
    }))
  });

  if (error) throw error;
}

export async function loadOrderDetail(
  supabase: SupabaseClient,
  companyId: string,
  orderId: string
): Promise<OrderDetail> {
  const { data: summaryRows, error: summaryError } = await supabase.rpc(
    "get_order_summaries",
    {
      p_company_id: companyId,
      p_search: null,
      p_status: null,
      p_priority: null,
      p_order_id: orderId
    }
  );
  if (summaryError) throw summaryError;
  const summaryRow = summaryRows?.[0];
  if (!summaryRow) throw new Error("No se encontró el pedido.");

  const [{ data: items, error: itemsError }, { data: payments, error: paymentsError }, { data: rawOrder, error: orderError }] =
    await Promise.all([
      supabase
        .from("order_items")
        .select("id,description,quantity,unit_price,total,sort_order")
        .eq("company_id", companyId)
        .eq("order_id", orderId)
        .order("sort_order"),
      supabase
        .from("payments")
        .select("id,payment_batch_id,amount,reference,created_at,payment_methods(name,code)")
        .eq("company_id", companyId)
        .eq("order_id", orderId)
        .order("created_at", { ascending: false }),
      supabase
        .from("orders")
        .select("created_by,updated_by")
        .eq("company_id", companyId)
        .eq("id", orderId)
        .single()
    ]);

  if (itemsError) throw itemsError;
  if (paymentsError) throw paymentsError;
  if (orderError) throw orderError;

  const order: OrderSummary = {
    ...summaryRow,
    order_number: Number(summaryRow.order_number ?? 0),
    subtotal: Number(summaryRow.subtotal ?? 0),
    discount: Number(summaryRow.discount ?? 0),
    total: Number(summaryRow.total ?? 0),
    paid: Number(summaryRow.paid ?? 0),
    balance: Number(summaryRow.balance ?? 0),
    item_count: Number(summaryRow.item_count ?? 0)
  } as OrderSummary;

  return {
    order: {
      ...order,
      created_by: rawOrder?.created_by ?? null,
      updated_by: rawOrder?.updated_by ?? null
    },
    items: (items ?? []).map((item) => ({
      ...item,
      quantity: Number(item.quantity ?? 0),
      unit_price: Number(item.unit_price ?? 0),
      total: Number(item.total ?? 0),
      sort_order: Number(item.sort_order ?? 0)
    })),
    payments: (payments ?? []).map((payment: any) => ({
      id: payment.id,
      payment_batch_id: payment.payment_batch_id,
      amount: Number(payment.amount ?? 0),
      reference: payment.reference ?? null,
      created_at: payment.created_at,
      method: Array.isArray(payment.payment_methods)
        ? payment.payment_methods[0]?.name ?? "Pago"
        : payment.payment_methods?.name ?? "Pago",
      method_code: Array.isArray(payment.payment_methods)
        ? payment.payment_methods[0]?.code ?? "other"
        : payment.payment_methods?.code ?? "other"
    }))
  };
}

export async function listPaymentMethods(
  supabase: SupabaseClient,
  companyId: string
): Promise<PaymentMethod[]> {
  const { data, error } = await supabase
    .from("payment_methods")
    .select("id,code,name")
    .eq("company_id", companyId)
    .eq("enabled", true)
    .order("sort_order")
    .order("name");

  if (error) throw error;
  return (data ?? []) as PaymentMethod[];
}

export async function registerMixedPayment(
  supabase: SupabaseClient,
  companyId: string,
  orderId: string,
  lines: PaymentLineInput[],
  notes?: string
): Promise<string> {
  if (!lines.length) throw new Error("Agregá al menos un medio de pago.");
  if (lines.some((line) => !line.payment_method_id || Number(line.amount) <= 0)) {
    throw new Error("Todos los pagos deben tener medio y monto mayor a cero.");
  }

  const { data, error } = await supabase.rpc("register_mixed_payment_v2", {
    p_company_id: companyId,
    p_order_id: orderId,
    p_lines: lines.map((line) => ({
      payment_method_id: line.payment_method_id,
      amount: Number(line.amount),
      reference: line.reference?.trim() || null
    })),
    p_notes: notes?.trim() || null
  });

  if (error) throw error;
  return String(data);
}

export async function changeOrderStatus(
  supabase: SupabaseClient,
  companyId: string,
  orderId: string,
  status: OrderStatus
): Promise<void> {
  const { error } = await supabase.rpc("change_order_status", {
    p_company_id: companyId,
    p_order_id: orderId,
    p_status: status
  });
  if (error) throw error;
}

export async function cancelOrder(
  supabase: SupabaseClient,
  companyId: string,
  orderId: string
): Promise<void> {
  const { error } = await supabase.rpc("cancel_order_safe", {
    p_company_id: companyId,
    p_order_id: orderId
  });
  if (error) throw error;
}
export async function listOrdersByClient(
  supabase: SupabaseClient,
  companyId: string,
  clientId: string
): Promise<OrderPickerSummary[]> {

  const { data, error } = await supabase
    .from("orders")
    .select(`
      id,
      order_number,
      client_id,
      status,
      total,
      order_date
    `)
    .eq("company_id", companyId)
    .eq("client_id", clientId)
    .neq("status", "cancelled")
    .order("order_date", {
      ascending:false
    });

  if(error) throw error;

  const rows = data ?? [];
  const orderIds = rows.map((row: any) => row.id);

  // Traemos los pagos ya registrados para poder calcular el saldo
  // pendiente de cada pedido (mismo criterio que get_order_summaries).
  let paidByOrder = new Map<string, number>();
  if (orderIds.length > 0) {
    const { data: payments, error: paymentsError } = await supabase
      .from("payments")
      .select("order_id, amount")
      .eq("company_id", companyId)
      .in("order_id", orderIds);

    if (paymentsError) throw paymentsError;

    for (const payment of payments ?? []) {
      const current = paidByOrder.get(payment.order_id) ?? 0;
      paidByOrder.set(payment.order_id, current + Number(payment.amount ?? 0));
    }
  }

  return rows
    .map((row: any) => {
      const total = Number(row.total ?? 0);
      const paid = paidByOrder.get(row.id) ?? 0;
      return {
        id: row.id,
        order_number: Number(row.order_number ?? 0),
        client_id: row.client_id,
        status: row.status,
        order_date: row.order_date,
        total,
        paid,
        balance: Math.max(total - paid, 0)
      } satisfies OrderPickerSummary;
    })
    // Un pedido ya saldado no tiene sentido ofrecerlo para cargar más pago.
    .filter((order) => order.balance > 0);
}
export async function getOrderById(
  supabase: SupabaseClient,
  companyId: string,
  orderId: string
): Promise<OrderSummary> {

  const { data, error } = await supabase.rpc(
    "get_order_summaries",
    {
      p_company_id: companyId,
      p_search: null,
      p_status: null,
      p_priority: null,
      p_order_id: orderId
    }
  );


  if (error) throw error;


  const row = data?.[0];

  if (!row) {
    throw new Error("No se encontró el pedido.");
  }


  return {
    ...row,
    order_number: Number(row.order_number ?? 0),
    subtotal: Number(row.subtotal ?? 0),
    discount: Number(row.discount ?? 0),
    total: Number(row.total ?? 0),
    paid: Number(row.paid ?? 0),
    balance: Number(row.balance ?? 0),
    item_count: Number(row.item_count ?? 0)
  } as OrderSummary;

}
