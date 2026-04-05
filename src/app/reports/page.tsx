import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/rbac";

export const dynamic = "force-dynamic";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatEGP(value: number) {
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

export default async function ReportsPage() {
  const user = await requireOwner();
  const today = startOfToday();

  const [
    todaySalesCount,
    todaySalesAgg,
    todayReturnsCount,
    todayReturnsAgg,
    invoicesWithReturnsCount,
    totalSalesCount,
    totalSalesAgg,
    totalReturnsCount,
    totalProductsCount,
    lowStockCount,
  ] = await Promise.all([
    prisma.sale.count({
      where: {
        createdAt: { gte: today },
      },
    }),

    prisma.sale.aggregate({
      where: {
        createdAt: { gte: today },
      },
      _sum: {
        total: true,
        discount: true,
      },
    }),

    prisma.saleReturn.count({
      where: {
        createdAt: { gte: today },
      },
    }),

    prisma.saleReturn.aggregate({
      where: {
        createdAt: { gte: today },
      },
      _sum: {
        returnedValue: true,
        refundAmount: true,
        extraAmount: true,
      },
    }),

    prisma.sale.count({
      where: {
        returns: {
          some: {},
        },
      },
    }),

    prisma.sale.count(),

    prisma.sale.aggregate({
      _sum: {
        total: true,
        discount: true,
      },
    }),

    prisma.saleReturn.count(),

    prisma.productVariant.count(),

    prisma.productVariant.count({
      where: {
        stockQty: { lte: 5 },
      },
    }),
  ]);

  const todaySalesTotal = Number(todaySalesAgg._sum.total ?? 0);
  const todayDiscountTotal = Number(todaySalesAgg._sum.discount ?? 0);

  const todayReturnedValue = Number(todayReturnsAgg._sum.returnedValue ?? 0);
  const todayRefundTotal = Number(todayReturnsAgg._sum.refundAmount ?? 0);
  const todayExtraAmount = Number(todayReturnsAgg._sum.extraAmount ?? 0);

  const allSalesTotal = Number(totalSalesAgg._sum.total ?? 0);
  const allDiscountsTotal = Number(totalSalesAgg._sum.discount ?? 0);

  return (
    <div className="min-h-screen bg-black text-white" dir="rtl">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white">التقارير</h1>
            <p className="mt-1 text-sm text-white/60">
              OWNER only — مسجل الدخول: {user.fullName || user.username}
            </p>
          </div>

          <Link
            href="/dashboard"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
          >
            رجوع
          </Link>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-white/60">مبيعات اليوم</div>
            <div className="mt-2 text-3xl font-extrabold">{todaySalesCount}</div>
            <div className="mt-2 text-xs text-white/40">عدد الفواتير اليوم</div>
          </div>

          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5">
            <div className="text-sm text-emerald-200">إجمالي بيع اليوم</div>
            <div className="mt-2 text-2xl font-extrabold text-emerald-300">
              {formatEGP(todaySalesTotal)}
            </div>
            <div className="mt-2 text-xs text-white/40">إجمالي الفواتير اليوم</div>
          </div>

          <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-5">
            <div className="text-sm text-yellow-200">خصومات اليوم</div>
            <div className="mt-2 text-2xl font-extrabold text-yellow-300">
              {formatEGP(todayDiscountTotal)}
            </div>
            <div className="mt-2 text-xs text-white/40">إجمالي الخصومات اليوم</div>
          </div>

          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5">
            <div className="text-sm text-red-200">عمليات مرتجع اليوم</div>
            <div className="mt-2 text-3xl font-extrabold text-red-300">
              {todayReturnsCount}
            </div>
            <div className="mt-2 text-xs text-white/40">مرتجع + استبدال</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-white/60">فواتير عليها مرتجعات</div>
            <div className="mt-2 text-3xl font-extrabold">{invoicesWithReturnsCount}</div>
            <div className="mt-2 text-xs text-white/40">من بداية التشغيل</div>
          </div>
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-white/60">صافي المرتجع اليوم</div>
            <div className="mt-2 text-2xl font-extrabold">{formatEGP(todayReturnedValue)}</div>
            <div className="mt-2 text-xs text-white/40">
              بعد توزيع الخصم على الجزء المرتجع
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5">
            <div className="text-sm text-emerald-200">المبالغ المستردة اليوم</div>
            <div className="mt-2 text-2xl font-extrabold text-emerald-300">
              {formatEGP(todayRefundTotal)}
            </div>
            <div className="mt-2 text-xs text-white/40">فلوس رجعت للعميل</div>
          </div>

          <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-5">
            <div className="text-sm text-yellow-200">إضافي على العملاء اليوم</div>
            <div className="mt-2 text-2xl font-extrabold text-yellow-300">
              {formatEGP(todayExtraAmount)}
            </div>
            <div className="mt-2 text-xs text-white/40">فرق الاستبدال المدفوع</div>
          </div>
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-white/60">إجمالي الفواتير</div>
            <div className="mt-2 text-3xl font-extrabold">{totalSalesCount}</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-white/60">إجمالي المبيعات</div>
            <div className="mt-2 text-2xl font-extrabold">{formatEGP(allSalesTotal)}</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-white/60">إجمالي الخصومات</div>
            <div className="mt-2 text-2xl font-extrabold">{formatEGP(allDiscountsTotal)}</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-white/60">إجمالي المرتجعات</div>
            <div className="mt-2 text-3xl font-extrabold">{totalReturnsCount}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Link
            href="/reports/profit"
            className="block rounded-2xl border border-red-500/20 bg-red-600/10 p-5 transition hover:bg-red-600/15"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-lg font-bold text-white">تقرير الأرباح</div>
              <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">
                Profit
              </span>
            </div>

            <p className="mt-2 text-sm text-white/70">
              أرباح كل بائع + إجمالي الإيراد + الخصم + صافي الربح.
            </p>

            <div className="mt-4 text-sm text-red-300">اضغط للدخول →</div>
          </Link>

          <Link
            href="/returns"
            className="block rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:bg-white/10"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-lg font-bold text-white">مراجعة المرتجعات</div>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white">
                Returns
              </span>
            </div>

            <p className="mt-2 text-sm text-white/70">
              عرض كل عمليات المرتجع والاستبدال والبحث داخلها بسرعة.
            </p>

            <div className="mt-4 text-sm text-red-300">اضغط للدخول →</div>
          </Link>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-lg font-bold text-white">إحصاءات عامة</div>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white">
                Summary
              </span>
            </div>

            <div className="mt-4 space-y-3 text-sm text-white/75">
              <div className="flex items-center justify-between">
                <span>إجمالي المنتجات</span>
                <span className="font-bold">{totalProductsCount}</span>
              </div>

              <div className="flex items-center justify-between">
                <span>منخفض المخزون</span>
                <span className="font-bold">{lowStockCount}</span>
              </div>

              <div className="flex items-center justify-between">
                <span>فواتير بها مرتجع</span>
                <span className="font-bold">{invoicesWithReturnsCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}