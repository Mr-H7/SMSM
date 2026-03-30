import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";

type SearchParams = { q?: string };

function getReturnBadge(returns: Array<{ type: "REFUND" | "EXCHANGE" }>) {
  if (returns.length === 0) {
    return {
      label: "بدون مرتجع",
      className: "border border-white/10 bg-white/5 text-white/60",
    };
  }

  const hasRefund = returns.some((r) => r.type === "REFUND");
  const hasExchange = returns.some((r) => r.type === "EXCHANGE");

  if (hasRefund && hasExchange) {
    return {
      label: `مرتجعات متعددة (${returns.length})`,
      className: "border border-red-500/30 bg-red-600/15 text-red-300",
    };
  }

  if (hasExchange) {
    return {
      label: returns.length > 1 ? `استبدال (${returns.length})` : "استبدال",
      className: "border border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
    };
  }

  return {
    label: returns.length > 1 ? `مرتجع (${returns.length})` : "مرتجع",
    className: "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  };
}

export default async function InvoicesPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();

  const sp = await props.searchParams;
  const q = (sp.q ?? "").trim();

  const sales = await prisma.sale.findMany({
    where: q
      ? {
          OR: [
            { id: { contains: q } },
            { customer: { contains: q } },
            { seller: { username: { contains: q } } },
            { seller: { fullName: { contains: q } } },
          ],
        }
      : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      createdAt: true,
      total: true,
      discount: true,
      customer: true,
      seller: { select: { username: true, fullName: true } },
      returns: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          type: true,
          refundAmount: true,
          extraAmount: true,
          createdAt: true,
        },
      },
    },
  });

  const totalInvoices = sales.length;
  const invoicesWithReturns = sales.filter((s) => s.returns.length > 0).length;
  const refundInvoices = sales.filter((s) =>
    s.returns.some((r) => r.type === "REFUND")
  ).length;
  const exchangeInvoices = sales.filter((s) =>
    s.returns.some((r) => r.type === "EXCHANGE")
  ).length;

  return (
    <div className="min-h-screen bg-black text-white" dir="rtl">
      <div className="mx-auto w-full max-w-7xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">الفواتير</h1>
            <p className="mt-1 text-sm text-white/60">
              بحث + عرض + طباعة + ربط مباشر بالمرتجعات
            </p>
          </div>

          <a
            href="/dashboard"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
          >
            رجوع
          </a>
        </div>

        <div className="mb-5 grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-white/60">إجمالي الفواتير</div>
            <div className="mt-2 text-3xl font-extrabold">{totalInvoices}</div>
          </div>

          <div className="rounded-2xl border border-red-500/30 bg-red-600/10 p-4">
            <div className="text-sm text-red-200">فواتير عليها مرتجعات</div>
            <div className="mt-2 text-3xl font-extrabold text-red-400">
              {invoicesWithReturns}
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <div className="text-sm text-emerald-200">فواتير فيها مرتجع</div>
            <div className="mt-2 text-3xl font-extrabold text-emerald-300">
              {refundInvoices}
            </div>
          </div>

          <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4">
            <div className="text-sm text-yellow-200">فواتير فيها استبدال</div>
            <div className="mt-2 text-3xl font-extrabold text-yellow-300">
              {exchangeInvoices}
            </div>
          </div>
        </div>

        <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-4">
          <form action="/invoices" method="get" className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-10">
              <label className="mb-1 block text-sm text-white/70">بحث</label>
              <input
                name="q"
                defaultValue={q}
                placeholder="ابحث بـ Invoice ID أو اسم العميل أو البائع"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
              />
            </div>

            <div className="flex items-end md:col-span-2">
              <button className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-bold hover:bg-red-500">
                بحث
              </button>
            </div>

            <div className="md:col-span-12">
              <a
                href="/invoices"
                className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
              >
                مسح
              </a>
            </div>
          </form>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 overflow-x-auto">
          <table className="w-full min-w-[1200px] border-collapse text-right text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/70">
                <th className="py-3">التاريخ</th>
                <th className="py-3">Invoice ID</th>
                <th className="py-3">العميل</th>
                <th className="py-3">البائع</th>
                <th className="py-3">خصم</th>
                <th className="py-3">الإجمالي</th>
                <th className="py-3">حالة المرتجع</th>
                <th className="py-3">آخر حركة</th>
                <th className="py-3">إجراءات</th>
              </tr>
            </thead>

            <tbody>
              {sales.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-white/50">
                    لا توجد فواتير
                  </td>
                </tr>
              ) : (
                sales.map((s) => {
                  const badge = getReturnBadge(
                    s.returns.map((r) => ({
                      type: r.type as "REFUND" | "EXCHANGE",
                    }))
                  );

                  const latestReturn = s.returns[0] ?? null;

                  return (
                    <tr key={s.id} className="border-b border-white/5">
                      <td className="py-3 text-white/70">
                        {new Date(s.createdAt).toLocaleString("ar-EG")}
                      </td>

                      <td className="py-3 font-mono text-xs">{s.id}</td>

                      <td className="py-3">{s.customer ?? "-"}</td>

                      <td className="py-3">
                        {s.seller.fullName ?? s.seller.username}
                      </td>

                      <td className="py-3">{s.discount}</td>

                      <td className="py-3 font-bold text-red-400">{s.total}</td>

                      <td className="py-3">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>

                      <td className="py-3">
                        {latestReturn ? (
                          <div className="space-y-1 text-xs">
                            <div
                              className={
                                latestReturn.type === "EXCHANGE"
                                  ? "text-yellow-300"
                                  : "text-emerald-300"
                              }
                            >
                              {latestReturn.type === "EXCHANGE"
                                ? "استبدال"
                                : "مرتجع"}
                            </div>

                            <div className="text-white/45">
                              {new Date(latestReturn.createdAt).toLocaleString(
                                "ar-EG"
                              )}
                            </div>

                            <div className="text-white/65">
                              مسترد:{" "}
                              <span className="text-white">
                                {latestReturn.refundAmount}
                              </span>
                            </div>

                            <div className="text-white/65">
                              إضافي:{" "}
                              <span className="text-white">
                                {latestReturn.extraAmount}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-white/35">—</span>
                        )}
                      </td>

                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          <a
                            href={`/invoices/${s.id}`}
                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                          >
                            عرض
                          </a>

                          <a
                            href={`/returns?saleId=${s.id}`}
                            className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold hover:bg-red-500"
                          >
                            مرتجع / استبدال
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}