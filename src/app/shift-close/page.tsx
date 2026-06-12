import CommandShell from "@/components/CommandShell";
import { BackToDashboard, EmptyState, MetricCard, PageHeader, ProgressBar, StatusBadge } from "@/components/CommandUI";
import { formatCairoDate, formatCairoDateTime, getCairoDayRange, getShiftAutoCloseLabel } from "@/lib/cairo-time";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function endShiftAction() {
  "use server";
  redirect("/dashboard");
}

function formatEGP(value: number) {
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function pct(value: number, max: number) {
  if (!max) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

export default async function ShiftClosePage() {
  const user = await requireUser();
  const range = getCairoDayRange();

  const [sales, returns] = await Promise.all([
    prisma.sale.findMany({
      where: { createdAt: { gte: range.start, lt: range.end } },
      include: { seller: { select: { id: true, username: true, fullName: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.saleReturn.findMany({
      where: { createdAt: { gte: range.start, lt: range.end } },
      include: { createdBy: { select: { username: true, fullName: true } }, sale: { select: { id: true, customer: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const totalSales = sales.reduce((sum, sale) => sum + (sale.total || 0), 0);
  const totalDiscounts = sales.reduce((sum, sale) => sum + (sale.discount || 0), 0);
  const totalReturns = returns.reduce((sum, row) => sum + (row.refundAmount || 0), 0);
  const totalExtra = returns.reduce((sum, row) => sum + (row.extraAmount || 0), 0);
  const cashTotal = sales.filter((sale) => sale.paymentMethod === "CASH").reduce((sum, sale) => sum + (sale.total || 0), 0);
  const transferTotal = sales.filter((sale) => sale.paymentMethod === "TRANSFER").reduce((sum, sale) => sum + (sale.total || 0), 0);
  const ledgerNet = Math.max(0, totalSales - totalReturns + totalExtra);

  const sellers = Array.from(
    sales.reduce((map, sale) => {
      const key = sale.sellerId;
      const current = map.get(key) ?? {
        name: sale.seller?.fullName || sale.seller?.username || "مستخدم",
        invoices: 0,
        total: 0,
      };
      current.invoices += 1;
      current.total += sale.total || 0;
      map.set(key, current);
      return map;
    }, new Map<string, { name: string; invoices: number; total: number }>())
  )
    .map(([, value]) => value)
    .sort((a, b) => b.total - a.total);

  const sellerMax = Math.max(1, ...sellers.map((seller) => seller.total));

  return (
    <CommandShell active="shift" user={user}>
      <div className="mx-auto max-w-7xl space-y-8">
        <PageHeader
          eyebrow="بروتوكول الإغلاق"
          title="إنهاء الشيفت"
          description="مراجعة نهائية لحركة اليوم حسب توقيت القاهرة: الفواتير، النقدي، التحويلات، الخصومات، المرتجعات، ونشاط البائعين قبل الرجوع للوحة التحكم."
          actions={<BackToDashboard />}
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="صافي دفتر اليوم" value={formatEGP(ledgerNet)} meta={`إغلاق مقترح ${getShiftAutoCloseLabel()}`} tone="red" />
          <MetricCard label="عدد الفواتير" value={sales.length} meta={formatCairoDate(new Date())} />
          <MetricCard label="النقدي" value={formatEGP(cashTotal)} meta="من طرق الدفع المسجلة" tone="blue" />
          <MetricCard label="التحويلات" value={formatEGP(transferTotal)} meta="تحويل / محافظ حسب الفاتورة" />
        </section>

        <section className="grid gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-5">
            <div className="command-panel-high border-r-4 border-[var(--primary)] p-6">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-xl font-black text-white">ملخص الشيفت</h2>
                <StatusBadge tone="red">نشط</StatusBadge>
              </div>
              <div className="space-y-4">
                {[
                  ["إجمالي المبيعات", formatEGP(totalSales)],
                  ["إجمالي الخصومات", formatEGP(totalDiscounts)],
                  ["المبالغ المستردة", formatEGP(totalReturns)],
                  ["فروق الاستبدال المدفوعة", formatEGP(totalExtra)],
                  ["صافي دفتر اليوم", formatEGP(ledgerNet)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between border-b border-white/[0.055] py-3">
                    <span className="text-sm font-semibold text-white/58">{label}</span>
                    <span className="font-mono text-sm font-black text-white">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="command-panel-high p-6">
              <div className="command-label">خط سير اليوم</div>
              <div className="mt-6 space-y-6">
                <div className="relative pr-8">
                  <span className="absolute right-0 top-1 h-3 w-3 rounded-full bg-[var(--tertiary)]" />
                  <p className="text-sm font-black text-white">بداية يوم القاهرة</p>
                  <p className="mt-1 text-xs text-white/50">{formatCairoDateTime(range.start)}</p>
                </div>
                <div className="relative pr-8">
                  <span className="absolute right-0 top-1 h-3 w-3 rounded-full bg-[var(--primary)]" />
                  <p className="text-sm font-black text-white">آخر فاتورة مسجلة</p>
                  <p className="mt-1 text-xs text-white/50">{sales[0] ? formatCairoDateTime(sales[0].createdAt) : "لا توجد فواتير اليوم"}</p>
                </div>
                <div className="relative pr-8">
                  <span className="absolute right-0 top-1 h-3 w-3 rounded-full bg-white/30" />
                  <p className="text-sm font-black text-white">موعد الإغلاق المقترح</p>
                  <p className="mt-1 text-xs text-white/50">{getShiftAutoCloseLabel()}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="command-panel-high p-6 xl:col-span-7">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="command-label">مطابقة الدفع</div>
                <h2 className="mt-2 text-2xl font-black text-white">تسوية النقدي والتحويل</h2>
              </div>
              <div className="text-left">
                <div className="command-label">الإجمالي الدفتري</div>
                <div className="mt-2 text-3xl font-black text-[var(--primary-soft)]">{formatEGP(ledgerNet)}</div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="bg-black/20 p-5">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-white/58">نقدي</span>
                  <span className="font-black text-white">{formatEGP(cashTotal)}</span>
                </div>
                <ProgressBar value={pct(cashTotal, Math.max(totalSales, 1))} tone="red" />
              </div>
              <div className="bg-black/20 p-5">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-white/58">تحويل</span>
                  <span className="font-black text-white">{formatEGP(transferTotal)}</span>
                </div>
                <ProgressBar value={pct(transferTotal, Math.max(totalSales, 1))} tone="blue" />
              </div>
            </div>

            <div className="mt-8">
              <div className="command-label">أداء البائعين اليوم</div>
              <div className="mt-5 space-y-4">
                {sellers.length === 0 ? (
                  <EmptyState>لا توجد حركة بيع اليوم.</EmptyState>
                ) : (
                  sellers.map((seller) => (
                    <div key={seller.name} className="bg-black/20 p-4">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-black text-white">{seller.name}</span>
                        <span className="text-white/60">{formatEGP(seller.total)} / {seller.invoices} فاتورة</span>
                      </div>
                      <ProgressBar value={pct(seller.total, sellerMax)} tone="red" />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="command-panel overflow-hidden">
          <div className="bg-[var(--surface-lowest)] px-5 py-4">
            <div className="command-label">سجل اليوم</div>
            <h2 className="mt-1 text-lg font-black text-white">آخر الفواتير والمرتجعات</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="command-table min-w-[1000px] text-right text-sm">
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>المرجع</th>
                  <th>النوع</th>
                  <th>الطرف</th>
                  <th>القيمة</th>
                </tr>
              </thead>
              <tbody>
                {[...sales.map((sale) => ({
                  id: sale.id,
                  at: sale.createdAt,
                  type: "فاتورة",
                  person: sale.customer || sale.seller?.fullName || sale.seller?.username || "-",
                  value: sale.total || 0,
                })), ...returns.map((row) => ({
                  id: row.id,
                  at: row.createdAt,
                  type: row.type === "EXCHANGE" ? "استبدال" : "استرداد",
                  person: row.sale.customer || row.createdBy.fullName || row.createdBy.username,
                  value: row.refundAmount || row.extraAmount || row.returnedValue,
                }))].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 10).map((row) => (
                  <tr key={`${row.type}-${row.id}`}>
                    <td className="text-white/58">{formatCairoDateTime(row.at)}</td>
                    <td className="max-w-[220px] break-all font-mono text-xs font-bold text-white">{row.id}</td>
                    <td><StatusBadge tone={row.type === "فاتورة" ? "blue" : "red"}>{row.type}</StatusBadge></td>
                    <td className="text-white/70">{row.person}</td>
                    <td className="font-black text-white">{formatEGP(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="command-panel-high border-r-4 border-[var(--primary)] p-6">
          <h2 className="text-2xl font-black text-white">تأكيد إنهاء الشيفت</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/58">
            لا يتم إنشاء سجل شيفت جديد لأن قاعدة البيانات الحالية لا تحتوي على جدول شيفت. هذا الإجراء يحافظ على السلوك الحالي: مراجعة تشغيلية ثم الرجوع للوحة التحكم.
          </p>
          <form action={endShiftAction} className="mt-5">
            <button className="command-primary px-8 py-4 text-xs font-black uppercase tracking-[0.14em]">
              إنهاء الشيفت الآن
            </button>
          </form>
        </section>
      </div>
    </CommandShell>
  );
}
