import Link from "next/link";
import { notFound } from "next/navigation";
import CommandShell from "@/components/CommandShell";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";
import {
  cancelOrderAction,
  confirmOrderAction,
  fulfillOrderAction,
  markContactedAction,
} from "../actions";
import WebOrderSeen from "../WebOrderSeen";

export const dynamic = "force-dynamic";

function money(value: number) {
  return new Intl.NumberFormat("ar-EG").format(value) + " EGP";
}

export default async function WebOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const order = await prisma.webOrder.findUnique({
    where: { id },
    include: {
      items: true,
      sale: { select: { id: true } },
    },
  });
  if (!order) notFound();

  return (
    <CommandShell active="web-orders" user={user}>
      <WebOrderSeen orderId={order.id} />
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="command-label">طلب موقع</div>
            <h1 className="mt-2 font-mono text-2xl font-black text-white">{order.orderNumber}</h1>
          </div>
          <Link href="/web-orders" className="command-secondary px-5 py-3 text-xs font-black">
            رجوع للطلبات
          </Link>
        </div>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="command-panel-high space-y-3 p-5 lg:col-span-2">
            <h2 className="text-lg font-black text-white">بيانات العميل</h2>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div><span className="text-white/45">الاسم:</span> {order.customerName}</div>
              <div><span className="text-white/45">الهاتف:</span> {order.phone}</div>
              <div className="sm:col-span-2"><span className="text-white/45">العنوان:</span> {order.address}</div>
              <div className="sm:col-span-2"><span className="text-white/45">ملاحظات:</span> {order.notes || "-"}</div>
            </div>
          </div>
          <div className="command-panel-high p-5">
            <div className="command-label">الحالة</div>
            <div className="mt-3 text-2xl font-black text-white">{order.status}</div>
            <div className="mt-4 text-xl font-black text-[var(--primary-soft)]">{money(order.total)}</div>
            {order.sale ? (
              <Link href={"/invoices/" + order.sale.id} className="mt-4 block text-xs font-black text-white/65 hover:text-white">
                فتح الفاتورة
              </Link>
            ) : null}
          </div>
        </section>

        <section className="command-panel-high overflow-hidden">
          <div className="overflow-x-auto">
            <table className="command-table min-w-[820px] text-sm">
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th>المقاس</th>
                  <th>اللون</th>
                  <th>الكمية</th>
                  <th>سعر الطلب</th>
                  <th>الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="font-black text-white">{item.productNameAr}</div>
                      <div className="mt-1 text-xs text-white/45">{item.productNameEn}</div>
                    </td>
                    <td>{item.selectedSize}</td>
                    <td>{item.selectedColor || "-"}</td>
                    <td>{item.quantity}</td>
                    <td>{money(item.unitPrice)}</td>
                    <td className="font-black text-white">{money(item.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="command-panel-high flex flex-wrap gap-3 p-5">
          {order.status === "NEW" ? (
            <form action={markContactedAction}>
              <input type="hidden" name="id" value={order.id} />
              <button className="command-secondary px-5 py-3 text-xs font-black">تم التواصل</button>
            </form>
          ) : null}
          {order.status === "NEW" || order.status === "CONTACTED" ? (
            <form action={confirmOrderAction}>
              <input type="hidden" name="id" value={order.id} />
              <button className="command-primary px-5 py-3 text-xs font-black">تأكيد وخصم المخزون</button>
            </form>
          ) : null}
          {order.status === "CONFIRMED" ? (
            <form action={fulfillOrderAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={order.id} />
              <label className="text-xs text-white/55">
                طريقة الدفع
                <select name="paymentMethod" className="command-input mt-2 block h-11 px-3">
                  <option value="CASH">نقدي</option>
                  <option value="TRANSFER">تحويل</option>
                </select>
              </label>
              <label className="text-xs text-white/55">
                تفاصيل التحويل
                <input name="paymentDescription" className="command-input mt-2 block h-11 px-3" />
              </label>
              <button className="command-primary h-11 px-5 text-xs font-black">إتمام وإنشاء الفاتورة</button>
            </form>
          ) : null}
          {order.status !== "CANCELLED" && order.status !== "FULFILLED" ? (
            <form action={cancelOrderAction} className="ms-auto">
              <input type="hidden" name="id" value={order.id} />
              <button className="command-secondary px-5 py-3 text-xs font-black text-[var(--primary-soft)]">
                إلغاء الطلب
              </button>
            </form>
          ) : null}
        </section>
      </div>
    </CommandShell>
  );
}