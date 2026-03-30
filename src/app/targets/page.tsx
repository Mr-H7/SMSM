import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/rbac";
import {
  updateGlobalTargets,
  updateSellerTargets,
  clearSellerTargets,
} from "./actions";

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function pct(value: number, target: number) {
  if (!target || target <= 0) return 0;
  return Math.min(100, Math.round((value / target) * 100));
}

function currency(n: number) {
  return new Intl.NumberFormat("ar-EG").format(n || 0);
}

async function ensureTargetTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS target_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      daily_target INTEGER NOT NULL DEFAULT 15000,
      monthly_target INTEGER NOT NULL DEFAULT 50000,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS seller_targets (
      seller_id TEXT PRIMARY KEY,
      daily_target INTEGER NOT NULL DEFAULT 0,
      monthly_target INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    INSERT OR IGNORE INTO target_settings (id, daily_target, monthly_target)
    VALUES (1, 15000, 50000)
  `);
}

export default async function TargetsPage() {
  await requireOwner();
  await ensureTargetTables();

  const today = startOfToday();
  const month = startOfMonth();

  const settingsRows = (await prisma.$queryRawUnsafe(`
    SELECT daily_target, monthly_target
    FROM target_settings
    WHERE id = 1
    LIMIT 1
  `)) as Array<{ daily_target: number; monthly_target: number }>;

  const globalTargets = settingsRows[0] ?? {
    daily_target: 15000,
    monthly_target: 50000,
  };

  const sellers = await prisma.user.findMany({
    where: { role: "SELLER" as any },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      username: true,
    },
  });

  const sellerTargetRows = (await prisma.$queryRawUnsafe(`
    SELECT seller_id, daily_target, monthly_target
    FROM seller_targets
  `)) as Array<{
    seller_id: string;
    daily_target: number;
    monthly_target: number;
  }>;

  const sellerTargetMap = new Map(
    sellerTargetRows.map((row) => [
      row.seller_id,
      {
        dailyTarget: Number(row.daily_target || 0),
        monthlyTarget: Number(row.monthly_target || 0),
      },
    ])
  );

  const [todaySales, monthSales, todayCount, monthCount, todayDiscounts, monthDiscounts, todayReturns, monthReturns] =
    await Promise.all([
      prisma.sale.findMany({
        where: { createdAt: { gte: today } },
        select: { sellerId: true, total: true, discount: true },
      }),
      prisma.sale.findMany({
        where: { createdAt: { gte: month } },
        select: { sellerId: true, total: true, discount: true },
      }),
      prisma.sale.findMany({
        where: { createdAt: { gte: today } },
        select: { sellerId: true },
      }),
      prisma.sale.findMany({
        where: { createdAt: { gte: month } },
        select: { sellerId: true },
      }),
      prisma.sale.findMany({
        where: { createdAt: { gte: today } },
        select: { sellerId: true, discount: true },
      }),
      prisma.sale.findMany({
        where: { createdAt: { gte: month } },
        select: { sellerId: true, discount: true },
      }),
      prisma.saleReturn.findMany({
        where: { createdAt: { gte: today } },
        select: {
          refundAmount: true,
          sale: { select: { sellerId: true } },
        },
      }),
      prisma.saleReturn.findMany({
        where: { createdAt: { gte: month } },
        select: {
          refundAmount: true,
          sale: { select: { sellerId: true } },
        },
      }),
    ]);

  const totalsTodaySales = todaySales.reduce((sum, s) => sum + (s.total || 0), 0);
  const totalsMonthSales = monthSales.reduce((sum, s) => sum + (s.total || 0), 0);
  const totalsTodayDiscounts = todayDiscounts.reduce((sum, s) => sum + (s.discount || 0), 0);
  const totalsMonthDiscounts = monthDiscounts.reduce((sum, s) => sum + (s.discount || 0), 0);
  const totalsTodayReturns = todayReturns.reduce((sum, r) => sum + (r.refundAmount || 0), 0);
  const totalsMonthReturns = monthReturns.reduce((sum, r) => sum + (r.refundAmount || 0), 0);

  const sellerStats = sellers.map((seller) => {
    const daySales = todaySales
      .filter((s) => s.sellerId === seller.id)
      .reduce((sum, s) => sum + (s.total || 0), 0);

    const monthSalesTotal = monthSales
      .filter((s) => s.sellerId === seller.id)
      .reduce((sum, s) => sum + (s.total || 0), 0);

    const dayInvoices = todayCount.filter((s) => s.sellerId === seller.id).length;
    const monthInvoices = monthCount.filter((s) => s.sellerId === seller.id).length;

    const dayDiscounts = todayDiscounts
      .filter((s) => s.sellerId === seller.id)
      .reduce((sum, s) => sum + (s.discount || 0), 0);

    const monthDiscountsTotal = monthDiscounts
      .filter((s) => s.sellerId === seller.id)
      .reduce((sum, s) => sum + (s.discount || 0), 0);

    const dayReturns = todayReturns
      .filter((r) => r.sale?.sellerId === seller.id)
      .reduce((sum, r) => sum + (r.refundAmount || 0), 0);

    const monthReturnsTotal = monthReturns
      .filter((r) => r.sale?.sellerId === seller.id)
      .reduce((sum, r) => sum + (r.refundAmount || 0), 0);

    const custom = sellerTargetMap.get(seller.id);

    const dailyTarget = custom?.dailyTarget || globalTargets.daily_target || 0;
    const monthlyTarget = custom?.monthlyTarget || globalTargets.monthly_target || 0;

    return {
      id: seller.id,
      username: seller.username,
      dailyTarget,
      monthlyTarget,
      daySales,
      monthSales: monthSalesTotal,
      dayInvoices,
      monthInvoices,
      dayDiscounts,
      monthDiscounts: monthDiscountsTotal,
      dayReturns,
      monthReturns: monthReturnsTotal,
      dayPct: pct(daySales, dailyTarget),
      monthPct: pct(monthSalesTotal, monthlyTarget),
      hasCustom: !!custom,
    };
  });

  const globalDayPct = pct(totalsTodaySales, globalTargets.daily_target);
  const globalMonthPct = pct(totalsMonthSales, globalTargets.monthly_target);

  return (
    <div dir="rtl" className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black">الأهداف</h1>
            <p className="mt-2 text-sm text-white/60">
              تخصيص هدف اليوم والشهر + هدف خاص لكل بائع
            </p>
          </div>

          <Link
            href="/dashboard"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold hover:bg-white/10"
          >
            رجوع
          </Link>
        </div>

        <div className="mb-8 grid gap-4 lg:grid-cols-2">
          <div className="rounded-[26px] border border-red-800/60 bg-gradient-to-br from-red-950/60 to-black p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">هدف اليوم</h2>
                <p className="mt-1 text-sm text-white/55">الهدف العام للنظام</p>
              </div>
              <div className="text-4xl font-black">{currency(globalTargets.daily_target)}</div>
            </div>

            <div className="mb-3 text-sm text-white/70">
              المحقق اليوم: <span className="font-bold text-white">{currency(totalsTodaySales)}</span>
            </div>

            <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-red-500" style={{ width: `${globalDayPct}%` }} />
            </div>

            <div className="mt-2 text-xs text-white/50">نسبة الإنجاز: %{globalDayPct}</div>
          </div>

          <div className="rounded-[26px] border border-emerald-800/50 bg-gradient-to-br from-emerald-950/50 to-black p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">هدف الشهر</h2>
                <p className="mt-1 text-sm text-white/55">الهدف الشهري العام للنظام</p>
              </div>
              <div className="text-4xl font-black">{currency(globalTargets.monthly_target)}</div>
            </div>

            <div className="mb-3 text-sm text-white/70">
              المحقق هذا الشهر: <span className="font-bold text-white">{currency(totalsMonthSales)}</span>
            </div>

            <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${globalMonthPct}%` }} />
            </div>

            <div className="mt-2 text-xs text-white/50">نسبة الإنجاز: %{globalMonthPct}</div>
          </div>
        </div>

        <div className="mb-8 rounded-[26px] border border-white/10 bg-[#05070b] p-5">
          <h2 className="mb-4 text-xl font-bold">تعديل الأهداف العامة</h2>

          <form action={updateGlobalTargets} className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm text-white/70">هدف اليوم</label>
              <input
                name="dailyTarget"
                type="number"
                min={0}
                defaultValue={globalTargets.daily_target}
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 outline-none focus:border-red-500"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-white/70">هدف الشهر</label>
              <input
                name="monthlyTarget"
                type="number"
                min={0}
                defaultValue={globalTargets.monthly_target}
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 outline-none focus:border-red-500"
              />
            </div>

            <div className="flex items-end">
              <button className="w-full rounded-2xl bg-white px-4 py-3 font-bold text-black hover:bg-white/90">
                حفظ الأهداف العامة
              </button>
            </div>
          </form>
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SmallBox title="فواتير اليوم" value={todayCount.length} />
          <SmallBox title="فواتير الشهر" value={monthCount.length} />
          <SmallBox title="خصومات اليوم" value={currency(totalsTodayDiscounts)} />
          <SmallBox title="خصومات الشهر" value={currency(totalsMonthDiscounts)} />
        </div>

        <div className="space-y-5">
          {sellerStats.length === 0 ? (
            <div className="rounded-[26px] border border-white/10 bg-[#05070b] p-8 text-center text-white/50">
              لا يوجد بائعون حالياً
            </div>
          ) : (
            sellerStats.map((seller) => (
              <div key={seller.id} className="rounded-[26px] border border-white/10 bg-[#05070b] p-5">
                <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h3 className="text-2xl font-black">{seller.username}</h3>
                    <p className="mt-1 text-sm text-white/55">
                      {seller.hasCustom ? "له أهداف مخصصة" : "يستخدم الأهداف العامة"}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                      <div className="text-xs text-white/55">هدف اليوم</div>
                      <div className="mt-1 text-2xl font-black">{currency(seller.dailyTarget)}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                      <div className="text-xs text-white/55">هدف الشهر</div>
                      <div className="mt-1 text-2xl font-black">{currency(seller.monthlyTarget)}</div>
                    </div>
                  </div>
                </div>

                <div className="mb-5 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-red-800/50 bg-gradient-to-br from-red-950/50 to-black p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm text-white/70">إنجاز اليوم</span>
                      <span className="font-bold">{currency(seller.daySales)}</span>
                    </div>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-red-500" style={{ width: `${seller.dayPct}%` }} />
                    </div>
                    <div className="mt-2 text-xs text-white/55">%{seller.dayPct}</div>
                  </div>

                  <div className="rounded-2xl border border-emerald-800/50 bg-gradient-to-br from-emerald-950/50 to-black p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm text-white/70">إنجاز الشهر</span>
                      <span className="font-bold">{currency(seller.monthSales)}</span>
                    </div>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${seller.monthPct}%` }} />
                    </div>
                    <div className="mt-2 text-xs text-white/55">%{seller.monthPct}</div>
                  </div>
                </div>

                <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <SmallBox title="فواتير اليوم" value={seller.dayInvoices} />
                  <SmallBox title="فواتير الشهر" value={seller.monthInvoices} />
                  <SmallBox title="خصومات اليوم" value={currency(seller.dayDiscounts)} />
                  <SmallBox title="مرتجعات اليوم" value={currency(seller.dayReturns)} />
                </div>

                <form action={updateSellerTargets} className="grid gap-4 md:grid-cols-4">
                  <input type="hidden" name="sellerId" value={seller.id} />

                  <div>
                    <label className="mb-2 block text-sm text-white/70">هدف اليوم لهذا البائع</label>
                    <input
                      name="dailyTarget"
                      type="number"
                      min={0}
                      defaultValue={seller.dailyTarget}
                      className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 outline-none focus:border-red-500"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-white/70">هدف الشهر لهذا البائع</label>
                    <input
                      name="monthlyTarget"
                      type="number"
                      min={0}
                      defaultValue={seller.monthlyTarget}
                      className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 outline-none focus:border-red-500"
                    />
                  </div>

                  <div className="flex items-end">
                    <button className="w-full rounded-2xl bg-white px-4 py-3 font-bold text-black hover:bg-white/90">
                      حفظ هدف البائع
                    </button>
                  </div>

                  <div className="flex items-end">
                    <form action={clearSellerTargets}>
                      <input type="hidden" name="sellerId" value={seller.id} />
                      <button className="w-full rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 font-bold text-red-300 hover:bg-red-500/20">
                        حذف التخصيص
                      </button>
                    </form>
                  </div>
                </form>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SmallBox({
  title,
  value,
}: {
  title: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="text-sm text-white/60">{title}</div>
      <div className="mt-2 text-3xl font-black">{value}</div>
    </div>
  );
}