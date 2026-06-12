import Link from "next/link";
import { redirect } from "next/navigation";
import CommandShell from "@/components/CommandShell";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";
import {
  formatCairoDate,
  formatCairoDateTime,
  getCairoDayRange,
  getShiftAutoCloseLabel,
  isAfterShiftAutoClose,
} from "@/lib/cairo-time";

export const dynamic = "force-dynamic";

function formatEGP(value: number) {
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function metricTone(tone: "red" | "blue" | "neutral") {
  if (tone === "red") return "border-r-4 border-[var(--primary)]";
  if (tone === "blue") return "border-r-4 border-[var(--tertiary)]";
  return "border-r-4 border-white/10";
}

export default async function DashboardPage() {
  const user = await requireUser();
  if (!user) redirect("/login");

  const todayRange = getCairoDayRange();
  const afterAutoClose = isAfterShiftAutoClose();

  const [
    productsCount,
    lowStockCount,
    outOfStockCount,
    todaySales,
    todayReturns,
    usersCount,
    invoicesCount,
    totalReturnsCount,
    alertVariants,
  ] = await Promise.all([
    prisma.productVariant.count(),
    prisma.productVariant.count({ where: { stockQty: { gt: 0, lte: 7 } } }),
    prisma.productVariant.count({ where: { stockQty: 0 } }),
    prisma.sale.findMany({
      where: { createdAt: { gte: todayRange.start, lt: todayRange.end } },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { seller: { select: { username: true, fullName: true } } },
    }),
    prisma.saleReturn.findMany({
      where: { createdAt: { gte: todayRange.start, lt: todayRange.end } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.user.count(),
    prisma.sale.count(),
    prisma.saleReturn.count(),
    prisma.productVariant.findMany({
      where: { stockQty: { lte: 7 } },
      orderBy: [{ stockQty: "asc" }, { updatedAt: "desc" }],
      take: 6,
      include: { model: true },
    }),
  ]);

  const todaySalesValue = todaySales.reduce((sum, sale) => sum + (sale.total || 0), 0);
  const todayDiscounts = todaySales.reduce((sum, sale) => sum + (sale.discount || 0), 0);
  const todayReturnsValue = todayReturns.reduce((sum, r) => sum + (r.refundAmount || 0), 0);
  const role = String(user.role ?? "").toUpperCase();

  const metrics = [
    {
      label: "مبيعات اليوم",
      value: formatEGP(todaySalesValue),
      meta: `${todaySales.length} فاتورة اليوم`,
      tone: "red" as const,
    },
    {
      label: "أصناف المخزون",
      value: productsCount.toLocaleString("en-US"),
      meta: `${lowStockCount} تنبيه مخزون منخفض`,
      tone: "neutral" as const,
    },
    {
      label: "نافد من المخزون",
      value: outOfStockCount.toLocaleString("en-US"),
      meta: "يحتاج إعادة توريد",
      tone: "red" as const,
    },
    {
      label: "مرتجعات اليوم",
      value: formatEGP(todayReturnsValue),
      meta: `${todayReturns.length} عملية مرتجع`,
      tone: "blue" as const,
    },
  ];

  return (
    <CommandShell active="dashboard" user={user}>
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="command-label">نظام تشغيل المتجر</div>
            <h1 className="mt-2 text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">
              لوحة تحكم SMSM
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-white/55">
              متابعة مباشرة لحركة البيع والمخزون والفواتير والشيفت من بيانات التشغيل الفعلية.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href="/sales/new" className="command-primary px-5 py-3 text-xs font-black uppercase tracking-[0.12em]">
              بيع جديد
            </Link>
            <Link href="/products" className="command-secondary px-5 py-3 text-xs font-black uppercase tracking-[0.12em]">
              مركز المخزون
            </Link>
            <Link href="/shift-close" className="command-secondary px-5 py-3 text-xs font-black uppercase tracking-[0.12em]">
              إنهاء الشيفت
            </Link>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className={`command-card p-5 ${metricTone(metric.tone)}`}>
              <div className="command-label">{metric.label}</div>
              <div className="mt-4 text-3xl font-black tracking-tight text-white">{metric.value}</div>
              <div className="mt-3 h-px w-full bg-gradient-to-r from-[var(--primary)] via-white/10 to-transparent" />
              <div className="mt-3 text-xs font-semibold text-white/45">{metric.meta}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <div className="command-panel-high p-5 xl:col-span-2">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="command-label">آخر الحركة</div>
                <h2 className="mt-2 text-xl font-black uppercase tracking-tight text-white">
                  آخر الفواتير
                </h2>
              </div>
              <Link href="/invoices" className="text-xs font-black uppercase tracking-[0.12em] text-[var(--primary-soft)] hover:text-white">
                عرض الكل
              </Link>
            </div>

            <div className="overflow-x-auto">
              <table className="command-table min-w-[760px] text-left text-sm">
                <thead>
                  <tr>
                    <th>الفاتورة</th>
                    <th>البائع</th>
                    <th>الوقت</th>
                    <th className="text-left">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {todaySales.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-12 text-center text-white/42">
                        لا توجد فواتير مسجلة في يوم القاهرة الحالي.
                      </td>
                    </tr>
                  ) : (
                    todaySales.map((sale) => (
                      <tr key={sale.id}>
                        <td>
                          <Link href={`/invoices/${sale.id}`} className="font-mono text-xs font-bold text-white hover:text-[var(--primary-soft)]">
                            {sale.id}
                          </Link>
                        </td>
                        <td className="text-white/70">{sale.seller?.fullName || sale.seller?.username || "-"}</td>
                        <td className="text-white/55">{formatCairoDateTime(sale.createdAt)}</td>
                        <td className="text-left font-black text-white">{formatEGP(sale.total || 0)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-6">
            <div className={`command-panel-high p-5 ${afterAutoClose ? "border-r-4 border-[var(--primary)]" : "border-r-4 border-[var(--tertiary)]"}`}>
              <div className="command-label">نبض الشيفت</div>
              <h2 className="mt-2 text-xl font-black uppercase tracking-tight text-white">
                {afterAutoClose ? "الإغلاق مطلوب" : "نافذة العمل مفتوحة"}
              </h2>
              <p className="mt-3 text-sm leading-6 text-white/60">
                {afterAutoClose
                  ? `وقت الإغلاق ${getShiftAutoCloseLabel()} عدى. راجع الحركة وأنهِ الشيفت.`
                  : `الشيفت مستمر حتى ${getShiftAutoCloseLabel()}.`}
              </p>
              <div className="mt-4 text-xs font-bold text-white/45">تاريخ القاهرة: {formatCairoDate(new Date())}</div>
            </div>

            <div className="command-panel-high p-5">
              <div className="command-label">ملخص التشغيل</div>
              <div className="mt-4 space-y-3">
                {[
                  ["إجمالي الفواتير", invoicesCount],
                  ["إجمالي المرتجعات", totalReturnsCount],
                  ["المستخدمون", usersCount],
                  ["خصومات اليوم", formatEGP(todayDiscounts)],
                  ["الدور الحالي", role === "OWNER" ? "مالك" : role === "SELLER" ? "بائع" : "-"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between bg-black/20 px-4 py-3">
                    <span className="text-sm text-white/58">{label}</span>
                    <span className="text-sm font-black text-white">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="command-panel-high p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="command-label">تنبيهات المخزون</div>
              <h2 className="mt-2 text-xl font-black uppercase tracking-tight text-white">
                ضغط المخزون
              </h2>
            </div>
            <span className="command-badge bg-[var(--primary)]/15 text-[var(--primary-soft)]">
              {alertVariants.length} تنبيه نشط
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {alertVariants.length === 0 ? (
              <div className="col-span-full bg-black/20 px-4 py-8 text-center text-sm text-white/45">
                لا توجد منتجات منخفضة المخزون حالياً.
              </div>
            ) : (
              alertVariants.map((variant) => (
                <Link
                  key={variant.id}
                  href={`/products?q=${encodeURIComponent(variant.sku || variant.model.name)}`}
                  className="group bg-black/20 p-4 transition hover:bg-white/[0.045]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-white group-hover:text-[var(--primary-soft)]">
                        {variant.model.brand ? `${variant.model.brand} ${variant.model.name}` : variant.model.name}
                      </div>
                      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-white/42">
                        {variant.sku || variant.grade}
                      </div>
                    </div>
                    <span className="command-badge bg-[var(--primary)]/15 text-[var(--primary-soft)]">
                      متبقي {variant.stockQty}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </CommandShell>
  );
}
