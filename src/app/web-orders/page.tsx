import Link from "next/link";
import CommandShell from "@/components/CommandShell";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";

export const dynamic = "force-dynamic";

function money(value: number) {
  return new Intl.NumberFormat("ar-EG").format(value) + " EGP";
}

function date(value: Date) {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  }).format(value);
}

const labels = {
  NEW: "جديد",
  CONTACTED: "تم التواصل",
  CONFIRMED: "مؤكد",
  FULFILLED: "مكتمل",
  CANCELLED: "ملغي",
} as const;

export default async function WebOrdersPage() {
  const user = await requireUser();
  const orders = await prisma.webOrder.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { _count: { select: { items: true } }, sale: { select: { id: true } } },
  });

  return (
    <CommandShell active="web-orders" user={user}>
      <div className="mx-auto max-w-7xl space-y-8">
        <section>
          <div className="command-label">قناة الموقع</div>
          <h1 className="mt-2 text-3xl font-black text-white sm:text-4xl">طلبات الموقع</h1>
          <p className="mt-2 text-sm text-white/55">
            متابعة الطلبات من الإنشاء حتى التأكيد والوفاء، مع خصم المخزون عند التأكيد فقط.
          </p>
        </section>

        <section className="command-panel-high overflow-hidden">
          <div className="overflow-x-auto">
            <table className="command-table min-w-[960px] text-sm">
              <thead>
                <tr>
                  <th>الطلب</th>
                  <th>العميل</th>
                  <th>الحالة</th>
                  <th>العناصر</th>
                  <th>الإجمالي</th>
                  <th>الوقت</th>
                  <th>الفاتورة</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-14 text-center text-white/45">
                      لا توجد طلبات موقع حتى الآن.
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.id} className={order.seenAt ? "" : "bg-[var(--primary)]/[0.055]"}>
                      <td>
                        <Link
                          href={"/web-orders/" + order.id}
                          className="font-mono text-xs font-black text-[var(--primary-soft)] hover:text-white"
                        >
                          {order.orderNumber}
                        </Link>
                      </td>
                      <td>
                        <div className="font-bold text-white">{order.customerName}</div>
                        <div className="mt-1 text-xs text-white/45">{order.phone}</div>
                      </td>
                      <td>
                        <span className="command-badge bg-white/[0.06] text-white/70">
                          {labels[order.status]}
                        </span>
                      </td>
                      <td>{order._count.items}</td>
                      <td className="font-black text-white">{money(order.total)}</td>
                      <td className="text-white/55">{date(order.createdAt)}</td>
                      <td className="font-mono text-xs text-white/55">{order.sale?.id ?? "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </CommandShell>
  );
}