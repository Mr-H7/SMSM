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
  return new Intl.NumberFormat("en-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function metricTone(tone: "red" | "blue" | "neutral") {
  if (tone === "red") return "border-l-4 border-[var(--primary)]";
  if (tone === "blue") return "border-l-4 border-[var(--tertiary)]";
  return "border-l-4 border-white/10";
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
      label: "Today Sales",
      value: formatEGP(todaySalesValue),
      meta: `${todaySales.length} invoices today`,
      tone: "red" as const,
    },
    {
      label: "Inventory Variants",
      value: productsCount.toLocaleString("en-US"),
      meta: `${lowStockCount} low stock alerts`,
      tone: "neutral" as const,
    },
    {
      label: "Out Of Stock",
      value: outOfStockCount.toLocaleString("en-US"),
      meta: "Requires restock action",
      tone: "red" as const,
    },
    {
      label: "Returns Today",
      value: formatEGP(todayReturnsValue),
      meta: `${todayReturns.length} return records`,
      tone: "blue" as const,
    },
  ];

  return (
    <CommandShell active="dashboard" user={user}>
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="command-label">Retail operating system</div>
            <h1 className="mt-2 text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">
              SMSM Command Center
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-white/55">
              Live store operations, inventory pressure, invoice movement, and shift status using current production data.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href="/sales/new" className="command-primary px-5 py-3 text-xs font-black uppercase tracking-[0.12em]">
              New Sale
            </Link>
            <Link href="/products" className="command-secondary px-5 py-3 text-xs font-black uppercase tracking-[0.12em]">
              Inventory Hub
            </Link>
            <Link href="/shift-close" className="command-secondary px-5 py-3 text-xs font-black uppercase tracking-[0.12em]">
              Shift Close
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
                <div className="command-label">Recent activity</div>
                <h2 className="mt-2 text-xl font-black uppercase tracking-tight text-white">
                  Latest Invoices
                </h2>
              </div>
              <Link href="/invoices" className="text-xs font-black uppercase tracking-[0.12em] text-[var(--primary-soft)] hover:text-white">
                View All
              </Link>
            </div>

            <div className="overflow-x-auto">
              <table className="command-table min-w-[760px] text-left text-sm">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Seller</th>
                    <th>Time</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {todaySales.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-12 text-center text-white/42">
                        No invoices recorded for the current Cairo business day.
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
                        <td className="text-right font-black text-white">{formatEGP(sale.total || 0)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-6">
            <div className={`command-panel-high p-5 ${afterAutoClose ? "border-l-4 border-[var(--primary)]" : "border-l-4 border-[var(--tertiary)]"}`}>
              <div className="command-label">Shift pulse</div>
              <h2 className="mt-2 text-xl font-black uppercase tracking-tight text-white">
                {afterAutoClose ? "Close Required" : "Open Window"}
              </h2>
              <p className="mt-3 text-sm leading-6 text-white/60">
                {afterAutoClose
                  ? `Auto-close time ${getShiftAutoCloseLabel()} has passed. Review and close the shift.`
                  : `Shift remains operational until ${getShiftAutoCloseLabel()}.`}
              </p>
              <div className="mt-4 text-xs font-bold text-white/45">Cairo date: {formatCairoDate(new Date())}</div>
            </div>

            <div className="command-panel-high p-5">
              <div className="command-label">Operational summary</div>
              <div className="mt-4 space-y-3">
                {[
                  ["Total invoices", invoicesCount],
                  ["Total returns", totalReturnsCount],
                  ["Users", usersCount],
                  ["Discounts today", formatEGP(todayDiscounts)],
                  ["Current role", role || "-"],
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
              <div className="command-label">Inventory alerts</div>
              <h2 className="mt-2 text-xl font-black uppercase tracking-tight text-white">
                Stock Pressure
              </h2>
            </div>
            <span className="command-badge bg-[var(--primary)]/15 text-[var(--primary-soft)]">
              {alertVariants.length} active alerts
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {alertVariants.length === 0 ? (
              <div className="col-span-full bg-black/20 px-4 py-8 text-center text-sm text-white/45">
                No low-stock products are currently visible.
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
                      {variant.stockQty} left
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
