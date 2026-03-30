import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/rbac";

function toDateOnly(v: string | undefined) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export default async function ProfitReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireOwner();

  const sp = await searchParams;

  const fromInput = toDateOnly(sp.from);
  const toInput = toDateOnly(sp.to);

  // default: today
  const now = new Date();
  const from = startOfDay(fromInput ?? now);
  const to = endOfDay(toInput ?? now);

  const sales = await prisma.sale.findMany({
    where: {
      createdAt: { gte: from, lte: to },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      total: true,
      discount: true,
      seller: { select: { id: true, username: true, fullName: true } },
      items: {
        select: {
          qty: true,
          sellPrice: true,
          costPrice: true,
        },
      },
    },
  });

  // totals
  let revenue = 0; // before discount = sum(items.qty*sellPrice)
  let cost = 0; // sum(items.qty*costPrice)
  let discount = 0; // sum(sale.discount)
  let net = 0; // sum(sale.total)

  const bySeller = new Map<
    string,
    { name: string; revenue: number; net: number; discount: number; cost: number; profit: number; salesCount: number }
  >();

  for (const s of sales) {
    const sellerName = s.seller.fullName ?? s.seller.username;
    const sellerId = s.seller.id;

    let saleRevenue = 0;
    let saleCost = 0;

    for (const it of s.items) {
      saleRevenue += it.qty * it.sellPrice;
      saleCost += it.qty * it.costPrice;
    }

    const saleDiscount = s.discount ?? 0;
    const saleNet = s.total ?? Math.max(0, saleRevenue - saleDiscount);
    const saleProfit = saleNet - saleCost;

    revenue += saleRevenue;
    cost += saleCost;
    discount += saleDiscount;
    net += saleNet;

    const cur =
      bySeller.get(sellerId) ??
      { name: sellerName, revenue: 0, net: 0, discount: 0, cost: 0, profit: 0, salesCount: 0 };

    cur.revenue += saleRevenue;
    cur.net += saleNet;
    cur.discount += saleDiscount;
    cur.cost += saleCost;
    cur.profit += saleProfit;
    cur.salesCount += 1;

    bySeller.set(sellerId, cur);
  }

  const profit = net - cost;

  const sellers = Array.from(bySeller.values()).sort((a, b) => b.profit - a.profit);

  return (
    <div className="min-h-screen bg-black text-white" dir="rtl">
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">تقرير الأرباح (Owner)</h1>
            <p className="mt-1 text-sm text-white/60">
              من {from.toLocaleDateString("ar-EG")} إلى {to.toLocaleDateString("ar-EG")}
            </p>
          </div>
          <a
            href="/dashboard"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
          >
            رجوع
          </a>
        </div>

        {/* Filters */}
        <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-4">
          <form action="/reports/profit" method="get" className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-4">
              <label className="mb-1 block text-sm text-white/70">من</label>
              <input
                type="date"
                name="from"
                defaultValue={sp.from ?? ""}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
              />
            </div>
            <div className="md:col-span-4">
              <label className="mb-1 block text-sm text-white/70">إلى</label>
              <input
                type="date"
                name="to"
                defaultValue={sp.to ?? ""}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
              />
            </div>
            <div className="md:col-span-4 flex items-end gap-2">
              <button className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-bold hover:bg-red-500">
                تطبيق
              </button>
              <a
                href="/reports/profit"
                className="w-full text-center rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm hover:bg-white/10"
              >
                اليوم
              </a>
            </div>
          </form>
        </div>

        {/* KPI */}
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-white/60">Revenue</div>
            <div className="mt-1 text-2xl font-extrabold">{revenue}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-white/60">Discount</div>
            <div className="mt-1 text-2xl font-extrabold">{discount}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-white/60">Cost</div>
            <div className="mt-1 text-2xl font-extrabold">{cost}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-white/60">Profit</div>
            <div className="mt-1 text-2xl font-extrabold text-red-500">{profit}</div>
          </div>
        </div>

        {/* Seller breakdown */}
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 overflow-x-auto">
          <h2 className="mb-3 text-lg font-bold">أرباح حسب البائع</h2>

          <table className="w-full min-w-[950px] border-collapse text-right text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/70">
                <th className="py-3">البائع</th>
                <th className="py-3">عدد الفواتير</th>
                <th className="py-3">Revenue</th>
                <th className="py-3">Discount</th>
                <th className="py-3">Net</th>
                <th className="py-3">Cost</th>
                <th className="py-3">Profit</th>
              </tr>
            </thead>
            <tbody>
              {sellers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-white/50">
                    لا توجد بيانات
                  </td>
                </tr>
              ) : (
                sellers.map((x, idx) => (
                  <tr key={idx} className="border-b border-white/5">
                    <td className="py-3 font-semibold">{x.name}</td>
                    <td className="py-3">{x.salesCount}</td>
                    <td className="py-3">{x.revenue}</td>
                    <td className="py-3">{x.discount}</td>
                    <td className="py-3">{x.net}</td>
                    <td className="py-3">{x.cost}</td>
                    <td className="py-3 font-bold text-red-400">{x.profit}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Small note */}
        <div className="mt-4 text-xs text-white/40">
          * Profit محسوب من: Net (بعد الخصم) - Cost (snapshot من SaleItem).
        </div>
      </div>
    </div>
  );
}