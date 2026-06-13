import CommandShell from "@/components/CommandShell";
import { BackToDashboard, EmptyState, MetricCard, PageHeader, ProgressBar, StatusBadge } from "@/components/CommandUI";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/rbac";
import { getCairoDayRange } from "@/lib/cairo-time";

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

function pct(value: number, target: number) {
  if (!target || target <= 0) return 0;
  return Math.min(100, Math.round((value / target) * 100));
}

export default async function TargetsPage() {
  console.info("[page-auth] targets", { guard: "requireOwner", called: true });
  const user = await requireOwner();
  console.info("[page-auth] targets", {
    userExists: Boolean(user),
    userIdExists: Boolean(user?.id),
    userRole: String(user?.role ?? ""),
    userActive: user?.isActive !== false,
    pageReachedAfterAuth: true,
  });
  const today = getCairoDayRange();
  const monthStart = startOfMonth();

  const [sellers, monthSales] = await Promise.all([
    prisma.user.findMany({
      where: { role: "SELLER" },
      orderBy: [{ isActive: "desc" }, { username: "asc" }],
    }),
    prisma.sale.findMany({
      where: { createdAt: { gte: monthStart } },
      include: { seller: { select: { id: true, username: true, fullName: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const rows = sellers.map((seller) => {
    const sellerSales = monthSales.filter((sale) => sale.sellerId === seller.id);
    const todaySales = sellerSales
      .filter((sale) => sale.createdAt >= today.start && sale.createdAt < today.end)
      .reduce((sum, sale) => sum + (sale.total || 0), 0);
    const monthlySales = sellerSales.reduce((sum, sale) => sum + (sale.total || 0), 0);
    return {
      id: seller.id,
      name: seller.fullName || seller.username,
      username: seller.username,
      isActive: seller.isActive,
      invoices: sellerSales.length,
      todaySales,
      monthlySales,
      dailyTarget: 0,
      monthlyTarget: 0,
    };
  });

  const totalToday = rows.reduce((sum, row) => sum + row.todaySales, 0);
  const totalMonth = rows.reduce((sum, row) => sum + row.monthlySales, 0);
  const topMonth = Math.max(1, ...rows.map((row) => row.monthlySales));

  return (
    <CommandShell active="targets" user={user}>
      <div className="mx-auto max-w-7xl space-y-8">
        <PageHeader
          eyebrow="أهداف المبيعات"
          title="الأهداف"
          description="متابعة أداء البائعين من بيانات المبيعات الفعلية. لا توجد حقول أو جدول أهداف في قاعدة البيانات الحالية، لذلك تظهر الأهداف كحالة غير مفعلة بدل إنشاء بيانات وهمية."
          actions={<BackToDashboard />}
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="مبيعات اليوم" value={formatEGP(totalToday)} meta="من فواتير اليوم حسب توقيت القاهرة" tone="red" />
          <MetricCard label="مبيعات الشهر" value={formatEGP(totalMonth)} meta={`${monthSales.length} فاتورة هذا الشهر`} tone="blue" />
          <MetricCard label="عدد البائعين" value={sellers.length} meta={`${rows.filter((row) => row.isActive).length} نشط`} />
          <MetricCard label="الأهداف المخزنة" value="0" meta="لا يوجد Target model في Prisma" tone="red" />
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <div className="command-panel-high p-6 xl:col-span-2">
            <div className="command-label">مؤشر التقدم</div>
            <h2 className="mt-2 text-xl font-black text-white">ترتيب البائعين هذا الشهر</h2>
            <div className="mt-6 space-y-5">
              {rows.length === 0 ? (
                <EmptyState>لا يوجد بائعون حتى الآن.</EmptyState>
              ) : (
                rows
                  .sort((a, b) => b.monthlySales - a.monthlySales)
                  .map((row, index) => (
                    <div key={row.id} className="bg-black/20 p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-black text-white">{index + 1}. {row.name}</div>
                          <div className="mt-1 font-mono text-[10px] text-white/42">{row.username}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge tone={row.isActive ? "blue" : "neutral"}>{row.isActive ? "نشط" : "غير نشط"}</StatusBadge>
                          <StatusBadge tone={index === 0 ? "red" : "neutral"}>{row.invoices} فاتورة</StatusBadge>
                        </div>
                      </div>
                      <ProgressBar value={pct(row.monthlySales, topMonth)} tone={index === 0 ? "red" : "blue"} />
                      <div className="mt-3 grid gap-3 text-sm text-white/62 sm:grid-cols-3">
                        <div>اليوم: <span className="font-black text-white">{formatEGP(row.todaySales)}</span></div>
                        <div>الشهر: <span className="font-black text-white">{formatEGP(row.monthlySales)}</span></div>
                        <div>الهدف: <span className="font-black text-white/45">غير مضبوط</span></div>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="command-panel-high border-r-4 border-[var(--primary)] p-6">
              <div className="command-label">حالة ميزة الأهداف</div>
              <h2 className="mt-2 text-xl font-black text-white">تخزين غير متاح</h2>
              <p className="mt-3 text-sm leading-6 text-white/58">
                التصميم يحتوي على حقول هدف يومي وشهري، لكن قاعدة البيانات الحالية لا تحتوي على جدول أو أعمدة لحفظ هذه القيم.
                لذلك تم عرض الأداء الحقيقي فقط بدون إنشاء بيانات أو حقول جديدة.
              </p>
            </div>

            <div className="command-panel-high p-6">
              <div className="command-label">حوافز تشغيلية</div>
              <div className="mt-5 space-y-4">
                <div className="bg-black/20 p-4">
                  <StatusBadge tone="red">مقترح تصميم</StatusBadge>
                  <h3 className="mt-3 font-black text-white">سباق مبيعات اليوم</h3>
                  <p className="mt-2 text-sm text-white/55">يظهر كقسم بصري فقط إلى أن يتم اعتماد منطق أهداف حقيقي.</p>
                </div>
                <div className="bg-black/20 p-4">
                  <StatusBadge tone="blue">بيانات فعلية</StatusBadge>
                  <h3 className="mt-3 font-black text-white">ترتيب البائعين</h3>
                  <p className="mt-2 text-sm text-white/55">مرتبط بفواتير الشهر الحالية بدون أي أرقام وهمية.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </CommandShell>
  );
}
