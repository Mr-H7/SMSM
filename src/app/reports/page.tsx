import Link from "next/link";
import CommandShell from "@/components/CommandShell";
import { BackToDashboard, EmptyState, MetricCard, PageHeader, ProgressBar, StatusBadge } from "@/components/CommandUI";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/rbac";
import { formatCairoDateTime, getCairoDayRange } from "@/lib/cairo-time";

export const dynamic = "force-dynamic";

function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function formatEGP(value: number) {
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function percent(value: number, max: number) {
  if (!max) return 0;
  return Math.round((value / max) * 100);
}

export default async function ReportsPage() {
  const user = await requireOwner();
  const today = getCairoDayRange();
  const monthStart = startOfMonth();

  const [
    todaySales,
    todayReturns,
    monthSales,
    recentSales,
    recentReturns,
    productCount,
    lowStockCount,
    invoicesWithReturns,
  ] = await Promise.all([
    prisma.sale.findMany({ where: { createdAt: { gte: today.start, lt: today.end } } }),
    prisma.saleReturn.findMany({ where: { createdAt: { gte: today.start, lt: today.end } } }),
    prisma.sale.findMany({
      where: { createdAt: { gte: monthStart } },
      include: { seller: { select: { username: true, fullName: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.sale.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { seller: { select: { username: true, fullName: true } }, returns: true },
    }),
    prisma.saleReturn.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { sale: { select: { id: true, customer: true } }, createdBy: { select: { username: true, fullName: true } } },
    }),
    prisma.productVariant.count(),
    prisma.productVariant.count({ where: { stockQty: { lte: 5 } } }),
    prisma.sale.count({ where: { returns: { some: {} } } }),
  ]);

  const todayRevenue = todaySales.reduce((sum, sale) => sum + (sale.total || 0), 0);
  const todayDiscounts = todaySales.reduce((sum, sale) => sum + (sale.discount || 0), 0);
  const todayRefunds = todayReturns.reduce((sum, row) => sum + (row.refundAmount || 0), 0);
  const todayExtra = todayReturns.reduce((sum, row) => sum + (row.extraAmount || 0), 0);
  const monthRevenue = monthSales.reduce((sum, sale) => sum + (sale.total || 0), 0);
  const monthDiscounts = monthSales.reduce((sum, sale) => sum + (sale.discount || 0), 0);
  const netToday = Math.max(0, todayRevenue - todayRefunds + todayExtra);

  const dailyBuckets = new Map<string, number>();
  for (const sale of monthSales) {
    const key = new Intl.DateTimeFormat("ar-EG", { day: "2-digit", month: "2-digit" }).format(sale.createdAt);
    dailyBuckets.set(key, (dailyBuckets.get(key) ?? 0) + (sale.total || 0));
  }
  const revenueSeries = Array.from(dailyBuckets.entries()).slice(-10);
  const maxRevenue = Math.max(1, ...revenueSeries.map(([, value]) => value));

  const sellerMap = new Map<string, { name: string; total: number; invoices: number }>();
  for (const sale of monthSales) {
    const name = sale.seller.fullName || sale.seller.username;
    const current = sellerMap.get(name) ?? { name, total: 0, invoices: 0 };
    current.total += sale.total || 0;
    current.invoices += 1;
    sellerMap.set(name, current);
  }
  const sellers = Array.from(sellerMap.values()).sort((a, b) => b.total - a.total).slice(0, 5);
  const topSellerTotal = Math.max(1, ...sellers.map((seller) => seller.total));

  const hourCounts = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: todaySales.filter((sale) => new Date(sale.createdAt).getHours() === hour).length,
  }));
  const maxHour = Math.max(1, ...hourCounts.map((row) => row.count));

  return (
    <CommandShell active="reports" user={user}>
      <div className="mx-auto max-w-7xl space-y-8">
        <PageHeader
          eyebrow="تحليلات المالك"
          title="التقارير"
          description="لوحة تحليل حقيقية للمبيعات والخصومات والمرتجعات وحركة الفواتير، بدون بيانات وهمية وبدون كشف أرقام الربح إلا داخل صفحات المالك."
          actions={
            <>
              <BackToDashboard />
              <Link href="/reports/profit" className="command-primary px-5 py-3 text-xs font-black uppercase tracking-[0.12em]">
                تقرير الأرباح
              </Link>
            </>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="صافي حركة اليوم" value={formatEGP(netToday)} meta={`${todaySales.length} فاتورة اليوم`} tone="red" />
          <MetricCard label="إيراد الشهر" value={formatEGP(monthRevenue)} meta={`${monthSales.length} فاتورة منذ بداية الشهر`} tone="blue" />
          <MetricCard label="خصومات الشهر" value={formatEGP(monthDiscounts)} meta={`خصومات اليوم ${formatEGP(todayDiscounts)}`} />
          <MetricCard label="مرتجعات اليوم" value={formatEGP(todayRefunds)} meta={`${todayReturns.length} عملية مرتجع / استبدال`} tone="red" />
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <div className="command-panel-high p-6 xl:col-span-2">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="command-label">منحنى الإيراد</div>
                <h2 className="mt-2 text-xl font-black text-white">مبيعات آخر أيام في الشهر</h2>
              </div>
              <StatusBadge tone="blue">بيانات فعلية</StatusBadge>
            </div>
            {revenueSeries.length === 0 ? (
              <EmptyState>لا توجد مبيعات كافية لعرض الرسم.</EmptyState>
            ) : (
              <div className="flex h-72 items-end gap-3 border-b border-white/10 px-2">
                {revenueSeries.map(([label, value]) => (
                  <div key={label} className="flex h-full flex-1 flex-col justify-end gap-3">
                    <div className="flex min-h-6 items-end justify-center text-[10px] font-black text-white/50">
                      {formatEGP(value)}
                    </div>
                    <div
                      className="bg-gradient-to-t from-[var(--primary)] to-[var(--primary-soft)] shadow-[0_0_18px_rgba(229,9,20,0.18)]"
                      style={{ height: `${Math.max(6, percent(value, maxRevenue))}%` }}
                    />
                    <div className="pb-3 text-center text-[10px] font-bold text-white/45">{label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="command-panel-high p-6">
            <div className="command-label">أداء البائعين</div>
            <h2 className="mt-2 text-xl font-black text-white">ترتيب الشهر</h2>
            <div className="mt-6 space-y-5">
              {sellers.length === 0 ? (
                <EmptyState>لا توجد مبيعات للبائعين هذا الشهر.</EmptyState>
              ) : (
                sellers.map((seller, index) => (
                  <div key={seller.name} className="space-y-2">
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="font-black text-white">{index + 1}. {seller.name}</span>
                      <span className="text-white/60">{formatEGP(seller.total)}</span>
                    </div>
                    <ProgressBar value={percent(seller.total, topSellerTotal)} tone={index === 0 ? "red" : "blue"} />
                    <div className="text-[10px] font-bold text-white/42">{seller.invoices} فاتورة</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <div className="command-panel-high p-6 xl:col-span-2">
            <div className="command-label">كثافة الحركة</div>
            <h2 className="mt-2 text-xl font-black text-white">توزيع فواتير اليوم بالساعة</h2>
            <div className="mt-6 grid grid-cols-12 gap-1 md:grid-cols-[repeat(24,minmax(0,1fr))]">
              {hourCounts.map((row) => (
                <div key={row.hour} className="space-y-2">
                  <div
                    className="h-8 bg-[var(--primary)]"
                    style={{ opacity: row.count ? Math.max(0.18, row.count / maxHour) : 0.08 }}
                    title={`${row.hour}:00 - ${row.count}`}
                  />
                  <div className="text-center text-[9px] font-bold text-white/35">{row.hour}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="command-panel-high p-6">
            <div className="command-label">مؤشرات تشغيلية</div>
            <div className="mt-5 space-y-4">
              <div className="flex items-center justify-between bg-black/20 px-4 py-3">
                <span className="text-sm text-white/58">إجمالي المنتجات</span>
                <span className="font-black text-white">{productCount}</span>
              </div>
              <div className="flex items-center justify-between bg-black/20 px-4 py-3">
                <span className="text-sm text-white/58">منخفض المخزون</span>
                <span className="font-black text-white">{lowStockCount}</span>
              </div>
              <div className="flex items-center justify-between bg-black/20 px-4 py-3">
                <span className="text-sm text-white/58">فواتير بها مرتجع</span>
                <span className="font-black text-white">{invoicesWithReturns}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="command-panel overflow-hidden">
          <div className="bg-[var(--surface-lowest)] px-5 py-4">
            <div className="command-label">سجل الحركة</div>
            <h2 className="mt-1 text-lg font-black text-white">آخر الفواتير والمرتجعات</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="command-table min-w-[1050px] text-right text-sm">
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>المرجع</th>
                  <th>الطرف</th>
                  <th>النوع</th>
                  <th>القيمة</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {[...recentSales.map((sale) => ({
                  id: sale.id,
                  at: sale.createdAt,
                  person: sale.customer || sale.seller.fullName || sale.seller.username,
                  kind: "فاتورة",
                  value: sale.total || 0,
                  status: sale.returns.length ? "بها مرتجع" : "مكتملة",
                })), ...recentReturns.map((row) => ({
                  id: row.id,
                  at: row.createdAt,
                  person: row.sale.customer || row.createdBy.fullName || row.createdBy.username,
                  kind: row.type === "EXCHANGE" ? "استبدال" : "استرداد",
                  value: row.refundAmount || row.extraAmount || row.returnedValue,
                  status: "مسجلة",
                }))].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 10).map((row) => (
                  <tr key={`${row.kind}-${row.id}`}>
                    <td className="text-white/58">{formatCairoDateTime(row.at)}</td>
                    <td className="max-w-[220px] break-all font-mono text-xs font-bold text-white">{row.id}</td>
                    <td className="text-white/70">{row.person || "-"}</td>
                    <td><StatusBadge tone={row.kind === "فاتورة" ? "blue" : "red"}>{row.kind}</StatusBadge></td>
                    <td className="font-black text-white">{formatEGP(row.value)}</td>
                    <td className="text-white/60">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </CommandShell>
  );
}
