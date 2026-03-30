import Image from "next/image";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function currency(n: number) {
  return new Intl.NumberFormat("ar-EG").format(n || 0);
}

export default async function DashboardPage() {
  const user = await requireUser();
  const isOwner = user.role === "OWNER";

  const todayStart = startOfToday();

  const salesWhere = isOwner
    ? { createdAt: { gte: todayStart } }
    : { createdAt: { gte: todayStart }, sellerId: user.id };

  const allSalesWhere = isOwner ? {} : { sellerId: user.id };

  const [
    totalProducts,
    lowStockCount,
    outOfStockCount,
    todaySalesCount,
    totalSalesCount,
    todayReturnsCount,
    totalReturnsCount,
    totalUsers,
    todaySales,
    todayReturns,
  ] = await Promise.all([
    prisma.productVariant.count(),
    prisma.productVariant.count({
      where: { stockQty: { gt: 0, lte: 7 } },
    }),
    prisma.productVariant.count({
      where: { stockQty: { lte: 0 } },
    }),
    prisma.sale.count({
      where: salesWhere,
    }),
    prisma.sale.count({
      where: allSalesWhere,
    }),
    prisma.saleReturn.count({
      where: isOwner
        ? { createdAt: { gte: todayStart } }
        : {
            createdAt: { gte: todayStart },
            sale: { sellerId: user.id },
          },
    }),
    prisma.saleReturn.count({
      where: isOwner
        ? {}
        : {
            sale: { sellerId: user.id },
          },
    }),
    isOwner ? prisma.user.count() : Promise.resolve(0),
    prisma.sale.findMany({
      where: salesWhere,
      select: {
        total: true,
        discount: true,
      },
    }),
    prisma.saleReturn.findMany({
      where: isOwner
        ? { createdAt: { gte: todayStart } }
        : {
            createdAt: { gte: todayStart },
            sale: { sellerId: user.id },
          },
      select: {
        refundAmount: true,
      },
    }),
  ]);

  const todaySalesAmount = todaySales.reduce((sum, s) => sum + (s.total || 0), 0);
  const todayDiscountAmount = todaySales.reduce((sum, s) => sum + (s.discount || 0), 0);
  const todayReturnsAmount = todayReturns.reduce((sum, r) => sum + (r.refundAmount || 0), 0);

  return (
    <div dir="rtl" className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8 overflow-hidden rounded-[28px] border border-red-900/40 bg-gradient-to-br from-red-950/35 via-black to-black p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                <Image
                  src="/smsm-logo.png"
                  alt="SMSM Logo"
                  width={80}
                  height={80}
                  className="h-full w-full object-contain p-2"
                  priority
                />
              </div>

              <div>
                <h1 className="text-3xl font-black">
                  لوحة تحكم <span className="text-white">SMSM</span>
                </h1>
                <p className="mt-1 text-sm text-white/65">
                  نظام إدارة محل الأحذية — واجهة تشغيل تجارية عربية نظيفة
                </p>

                <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/75">
                  <span>{isOwner ? "OWNER" : "SELLER"}</span>
                  <span className="text-white/35">•</span>
                  <span className="font-bold">{user.username}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <NavTab href="/sales/new" label="بيع جديد" active />
              <NavTab href="/products" label="المنتجات" />
              <NavTab href="/invoices" label="الفواتير" />
              {isOwner ? <NavTab href="/reports" label="التقارير" /> : <NavTab href="/returns" label="المرتجعات" />}
              <NavTab href="/shift-close" label="إغلاق الوردية" />
              {isOwner ? <NavTab href="/returns" label="المرتجعات" /> : <span />}
            </div>
          </div>
        </div>

        <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SimpleBox
            title="إجمالي المنتجات"
            value={totalProducts}
            note="عدد النسخ الموجودة في النظام"
          />
          <SimpleBox
            title="مخزون منخفض"
            value={lowStockCount}
            note="من 1 إلى 7"
            tone="red"
          />
          <SimpleBox
            title="نفد المخزون"
            value={outOfStockCount}
            note="يحتاج إعادة تخزين"
            tone="red"
          />
          <SimpleBox
            title="مبيعات اليوم"
            value={todaySalesCount}
            note="عدد الفواتير اليوم"
            tone="dark"
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2 space-y-6">
            <SectionCard title="ملخص اليوم">
              <div className="grid gap-4 md:grid-cols-3">
                <MetricCard
                  title="إجمالي مبيعات اليوم"
                  value={`${currency(todaySalesAmount)} ج.م`}
                />
                <MetricCard
                  title="خصومات اليوم"
                  value={`${currency(todayDiscountAmount)} ج.م`}
                />
                <MetricCard
                  title="مرتجعات اليوم"
                  value={`${currency(todayReturnsAmount)} ج.م`}
                />
              </div>
            </SectionCard>

            <SectionCard title="الوصول السريع">
              <div className="grid gap-3 md:grid-cols-2">
                <QuickCard href="/sales/new" title="إنشاء فاتورة جديدة" desc="ابدأ عملية بيع جديدة بسرعة." />
                <QuickCard href="/products" title="المنتجات والمخزون" desc="عرض المنتجات وإعادة التخزين والمتابعة." />
                <QuickCard href="/invoices" title="عرض الفواتير" desc="تفاصيل الفواتير والطباعة." />
                <QuickCard href="/returns" title="المرتجعات والاستبدال" desc="استرجاع واستبدال وربط بالفواتير." />
                <QuickCard href="/shift-close" title="إغلاق الوردية" desc="إنهاء الوردية وطباعة الملخص." />
                {isOwner ? (
                  <QuickCard href="/targets" title="الأهداف" desc="إدارة هدف اليوم والشهر والبائعين." />
                ) : null}
              </div>
            </SectionCard>
          </div>

          <div className="space-y-6">
            <SectionCard title="ملخص التشغيل">
              <MiniRow label="إجمالي الفواتير" value={totalSalesCount} />
              <MiniRow label="مرتجعات مسجلة" value={totalReturnsCount} />
              {isOwner ? <MiniRow label="عدد المستخدمين" value={totalUsers} /> : null}
              <MiniRow label="فواتير اليوم" value={todaySalesCount} />
              <MiniRow label="مرتجعات اليوم" value={todayReturnsCount} />
            </SectionCard>

            <SectionCard title="تنبيهات سريعة">
              <MiniRow label="منتجات منخفضة" value={lowStockCount} tone={lowStockCount > 0 ? "warn" : "ok"} />
              <MiniRow label="منتجات نافدة" value={outOfStockCount} tone={outOfStockCount > 0 ? "danger" : "ok"} />
              <Link
                href="/products"
                className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-bold text-black transition hover:bg-white/90"
              >
                فتح صفحة المخزون
              </Link>
            </SectionCard>

            {isOwner ? (
              <SectionCard title="لوحات الإدارة">
                <div className="space-y-3">
                  <SideLink href="/reports" label="التقارير" />
                  <SideLink href="/reports/profit" label="تقرير الأرباح" />
                  <SideLink href="/targets" label="الأهداف" />
                  <SideLink href="/users" label="إدارة المستخدمين" />
                </div>
              </SectionCard>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function NavTab({
  href,
  label,
  active = false,
}: {
  href: string;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-2xl border px-5 py-3 text-center text-sm font-bold transition ${
        active
          ? "border-red-500 bg-red-600 text-white hover:bg-red-500"
          : "border-white/10 bg-black/60 text-white hover:bg-white/10"
      }`}
    >
      {label}
    </Link>
  );
}

function SimpleBox({
  title,
  value,
  note,
  tone = "dark",
}: {
  title: string;
  value: string | number;
  note: string;
  tone?: "dark" | "red";
}) {
  return (
    <div
      className={`rounded-[26px] border p-6 ${
        tone === "red"
          ? "border-red-800/60 bg-gradient-to-br from-red-950/60 to-black"
          : "border-white/10 bg-[#05070b]"
      }`}
    >
      <div className="text-sm text-white/70">{title}</div>
      <div className={`mt-3 text-5xl font-black ${tone === "red" ? "text-red-400" : "text-white"}`}>
        {value}
      </div>
      <div className="mt-3 text-sm text-white/45">{note}</div>
    </div>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[26px] border border-white/10 bg-[#05070b] p-5">
      <h2 className="mb-4 text-xl font-bold">{title}</h2>
      {children}
    </div>
  );
}

function MetricCard({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
      <div className="text-sm text-white/65">{title}</div>
      <div className="mt-3 text-2xl font-black">{value}</div>
    </div>
  );
}

function QuickCard({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-white/10 bg-black/30 p-4 transition hover:border-red-500/30 hover:bg-white/5"
    >
      <div className="text-base font-bold">{title}</div>
      <div className="mt-2 text-sm leading-6 text-white/60">{desc}</div>
    </Link>
  );
}

function MiniRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "ok" | "warn" | "danger";
}) {
  const cls =
    tone === "ok"
      ? "text-green-400"
      : tone === "warn"
      ? "text-yellow-300"
      : tone === "danger"
      ? "text-red-400"
      : "text-white";

  return (
    <div className="mb-3 flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 py-3 last:mb-0">
      <span className="text-white/70">{label}</span>
      <span className={`font-bold ${cls}`}>{value}</span>
    </div>
  );
}

function SideLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-medium transition hover:bg-white/5"
    >
      {label}
    </Link>
  );
}