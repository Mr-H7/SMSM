import CommandShell from "@/components/CommandShell";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";
import { formatCairoDateTime } from "@/lib/cairo-time";

type SearchParams = { q?: string };

function formatEGP(value: number) {
  return new Intl.NumberFormat("en-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function getReturnBadge(returns: Array<{ type: "REFUND" | "EXCHANGE" }>) {
  if (returns.length === 0) {
    return {
      label: "Clear",
      className: "bg-white/[0.055] text-white/55",
    };
  }

  const hasRefund = returns.some((r) => r.type === "REFUND");
  const hasExchange = returns.some((r) => r.type === "EXCHANGE");

  if (hasRefund && hasExchange) {
    return {
      label: `Mixed (${returns.length})`,
      className: "bg-[var(--primary)]/15 text-[var(--primary-soft)]",
    };
  }

  if (hasExchange) {
    return {
      label: returns.length > 1 ? `Exchange (${returns.length})` : "Exchange",
      className: "bg-[#ffb4aa]/12 text-[#ffb4aa]",
    };
  }

  return {
    label: returns.length > 1 ? `Refund (${returns.length})` : "Refund",
    className: "bg-[var(--tertiary)]/12 text-[var(--tertiary)]",
  };
}

export default async function InvoicesPage(props: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
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
      paymentMethod: true,
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
  const refundInvoices = sales.filter((s) => s.returns.some((r) => r.type === "REFUND")).length;
  const exchangeInvoices = sales.filter((s) => s.returns.some((r) => r.type === "EXCHANGE")).length;
  const totalValue = sales.reduce((sum, sale) => sum + (sale.total || 0), 0);

  return (
    <CommandShell active="invoices" user={user}>
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="command-label">Receipt control</div>
            <h1 className="mt-2 text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">
              Invoices
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-white/55">
              Search, inspect, print thermal receipts, and launch refund or exchange workflows.
            </p>
          </div>
          <a href="/sales/new" className="command-primary px-5 py-3 text-xs font-black uppercase tracking-[0.12em]">
            New Sale
          </a>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="command-card border-l-4 border-[var(--primary)] p-5">
            <div className="command-label">Invoices</div>
            <div className="mt-3 text-3xl font-black text-white">{totalInvoices}</div>
          </div>
          <div className="command-card border-l-4 border-[var(--tertiary)] p-5">
            <div className="command-label">Visible Value</div>
            <div className="mt-3 text-2xl font-black text-white">{formatEGP(totalValue)}</div>
          </div>
          <div className="command-card border-l-4 border-[var(--primary)] p-5">
            <div className="command-label">With Returns</div>
            <div className="mt-3 text-3xl font-black text-white">{invoicesWithReturns}</div>
          </div>
          <div className="command-card p-5">
            <div className="command-label">Return Split</div>
            <div className="mt-3 text-lg font-black text-white">
              {refundInvoices} refund / {exchangeInvoices} exchange
            </div>
          </div>
        </section>

        <form action="/invoices" method="get" className="command-panel-high grid gap-3 p-4 md:grid-cols-12">
          <div className="md:col-span-10">
            <label className="command-label mb-2 block">Search</label>
            <input
              name="q"
              defaultValue={q}
              placeholder="Invoice ID, customer, seller..."
              className="command-input h-12 w-full px-4 text-sm placeholder:text-white/30"
            />
          </div>
          <div className="flex items-end md:col-span-2">
            <button className="command-primary h-12 w-full text-xs font-black uppercase tracking-[0.12em]">
              Search
            </button>
          </div>
          {q ? (
            <div className="md:col-span-12">
              <a href="/invoices" className="text-xs font-black uppercase tracking-[0.12em] text-white/50 hover:text-white">
                Clear filters
              </a>
            </div>
          ) : null}
        </form>

        <section className="command-panel overflow-hidden">
          <div className="bg-[var(--surface-lowest)] px-5 py-4">
            <div className="command-label">Invoice register</div>
            <h2 className="mt-1 text-lg font-black uppercase tracking-tight text-white">Thermal Receipt Index</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="command-table min-w-[1180px] text-left text-sm">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoice ID</th>
                  <th>Customer</th>
                  <th>Seller</th>
                  <th>Payment</th>
                  <th>Discount</th>
                  <th>Total</th>
                  <th>Returns</th>
                  <th>Last Movement</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {sales.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-white/42">
                      No invoices found.
                    </td>
                  </tr>
                ) : (
                  sales.map((s) => {
                    const badge = getReturnBadge(
                      s.returns.map((r) => ({ type: r.type as "REFUND" | "EXCHANGE" }))
                    );
                    const latestReturn = s.returns[0] ?? null;

                    return (
                      <tr key={s.id}>
                        <td className="text-white/58">{formatCairoDateTime(s.createdAt)}</td>
                        <td className="max-w-[220px] break-all font-mono text-xs font-bold text-white">{s.id}</td>
                        <td className="text-white/70">{s.customer || "-"}</td>
                        <td className="text-white/70">{s.seller.fullName ?? s.seller.username}</td>
                        <td>
                          <span className="command-badge bg-white/[0.055] text-white/65">
                            {s.paymentMethod === "TRANSFER" ? "Transfer" : "Cash"}
                          </span>
                        </td>
                        <td className="text-white/58">{formatEGP(s.discount || 0)}</td>
                        <td className="font-black text-white">{formatEGP(s.total || 0)}</td>
                        <td>
                          <span className={`command-badge ${badge.className}`}>{badge.label}</span>
                        </td>
                        <td>
                          {latestReturn ? (
                            <div className="space-y-1 text-xs">
                              <div className={latestReturn.type === "EXCHANGE" ? "text-[#ffb4aa]" : "text-[var(--tertiary)]"}>
                                {latestReturn.type === "EXCHANGE" ? "Exchange" : "Refund"}
                              </div>
                              <div className="text-white/40">{formatCairoDateTime(latestReturn.createdAt)}</div>
                              <div className="text-white/60">
                                Refund {formatEGP(latestReturn.refundAmount || 0)} / Extra {formatEGP(latestReturn.extraAmount || 0)}
                              </div>
                            </div>
                          ) : (
                            <span className="text-white/30">-</span>
                          )}
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-2">
                            <a href={`/invoices/${s.id}`} className="command-secondary px-3 py-2 text-[10px] font-black uppercase tracking-[0.1em]">
                              View
                            </a>
                            <a href={`/returns?q=${encodeURIComponent(s.id)}`} className="command-primary px-3 py-2 text-[10px] font-black uppercase tracking-[0.1em]">
                              Return
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
        </section>
      </div>
    </CommandShell>
  );
}
