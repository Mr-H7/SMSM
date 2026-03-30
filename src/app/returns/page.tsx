import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";
import { redirect } from "next/navigation";
import ReturnsClient from "./ReturnsClient";

type SearchParams = {
  q?: string;
  saleId?: string;
};

export default async function ReturnsPage(props: { searchParams: Promise<SearchParams> }) {
  await requireUser();

  const sp = await props.searchParams;
  const q = String(sp.q ?? "").trim();
  const saleId = String(sp.saleId ?? "").trim();

  const searchResults = q
    ? await prisma.sale.findMany({
        where: {
          OR: [
            { id: { contains: q } },
            { customer: { contains: q } },
            { seller: { username: { contains: q } } },
            { seller: { fullName: { contains: q } } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          createdAt: true,
          total: true,
          customer: true,
          seller: { select: { username: true, fullName: true } },
          returns: {
            select: {
              id: true,
            },
          },
        },
      })
    : [];

  const recentReturns = await prisma.saleReturn.findMany({
    orderBy: { createdAt: "desc" },
    take: 15,
    select: {
      id: true,
      type: true,
      createdAt: true,
      returnedValue: true,
      replacementValue: true,
      refundAmount: true,
      extraAmount: true,
      sale: {
        select: {
          id: true,
          customer: true,
        },
      },
      createdBy: {
        select: {
          username: true,
          fullName: true,
        },
      },
    },
  });

  let selectedSale: Awaited<ReturnType<typeof prisma.sale.findUnique>> | null = null;

  let replacementVariants: Array<{
    id: string;
    sellPrice: number;
    stockQty: number;
    grade: string;
    size: string | null;
    color: string | null;
    sku: string | null;
    model: {
      name: string;
      brand: string | null;
    };
  }> = [];

  if (saleId) {
    selectedSale = await prisma.sale.findUnique({
      where: { id: saleId },
      select: {
        id: true,
        createdAt: true,
        customer: true,
        total: true,
        discount: true,
        seller: { select: { username: true, fullName: true } },
        items: {
          select: {
            id: true,
            qty: true,
            sellPrice: true,
            variantId: true,
            returnItems: {
              select: {
                qty: true,
              },
            },
            variant: {
              select: {
                grade: true,
                size: true,
                color: true,
                sku: true,
                model: { select: { name: true, brand: true } },
              },
            },
          },
        },
      },
    });

    if (!selectedSale) redirect("/returns");

    replacementVariants = await prisma.productVariant.findMany({
      where: {
        isActive: true,
        stockQty: { gt: 0 },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 400,
      select: {
        id: true,
        sellPrice: true,
        stockQty: true,
        grade: true,
        size: true,
        color: true,
        sku: true,
        model: { select: { name: true, brand: true } },
      },
    });
  }

  return (
    <div className="min-h-screen bg-black text-white" dir="rtl">
      <div className="mx-auto w-full max-w-7xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">المرتجعات والاستبدال</h1>
            <p className="mt-1 text-sm text-white/60">
              ابحث عن الفاتورة أولًا، ثم نفّذ مرتجع جزئي أو كامل أو استبدال مع تحديث المخزون تلقائيًا.
            </p>
          </div>

          <a
            href="/dashboard"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
          >
            رجوع
          </a>
        </div>

        <div className="grid gap-5 xl:grid-cols-12">
          <div className="xl:col-span-8 space-y-5">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <form action="/returns" method="get" className="grid gap-3 md:grid-cols-12">
                <div className="md:col-span-9">
                  <label className="mb-1 block text-sm text-white/70">ابحث عن الفاتورة</label>
                  <input
                    name="q"
                    defaultValue={q}
                    placeholder="Invoice ID / اسم العميل / اسم البائع"
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
                  />
                </div>

                <div className="md:col-span-3 flex items-end gap-2">
                  <button className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-bold hover:bg-red-500">
                    بحث
                  </button>
                </div>
              </form>
            </div>

            {q && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-bold">نتائج البحث</h2>
                  <span className="text-xs text-white/50">{searchResults.length} نتيجة</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[850px] border-collapse text-right text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-white/70">
                        <th className="py-3">التاريخ</th>
                        <th className="py-3">Invoice</th>
                        <th className="py-3">العميل</th>
                        <th className="py-3">البائع</th>
                        <th className="py-3">الإجمالي</th>
                        <th className="py-3">مرات المرتجع</th>
                        <th className="py-3">فتح</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchResults.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-white/50">
                            لا توجد فواتير مطابقة
                          </td>
                        </tr>
                      ) : (
                        searchResults.map((sale) => (
                          <tr key={sale.id} className="border-b border-white/5">
                            <td className="py-3 text-white/70">
                              {new Date(sale.createdAt).toLocaleString("ar-EG")}
                            </td>
                            <td className="py-3 font-mono text-xs">{sale.id}</td>
                            <td className="py-3">{sale.customer ?? "-"}</td>
                            <td className="py-3">{sale.seller.fullName ?? sale.seller.username}</td>
                            <td className="py-3 font-bold text-red-300">{sale.total}</td>
                            <td className="py-3">{sale.returns.length}</td>
                            <td className="py-3">
                              <a
                                href={`/returns?saleId=${sale.id}`}
                                className="inline-flex rounded-lg bg-red-600 px-3 py-2 text-xs font-bold hover:bg-red-500"
                              >
                                فتح المرتجع
                              </a>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {selectedSale && (
              <ReturnsClient
                sale={{
                  id: selectedSale.id,
                  customer: selectedSale.customer,
                  discount: selectedSale.discount,
                  total: selectedSale.total,
                  createdAtLabel: new Date(selectedSale.createdAt).toLocaleString("ar-EG"),
                  sellerName: selectedSale.seller.fullName ?? selectedSale.seller.username,
                  items: selectedSale.items.map((item) => {
                    const alreadyReturnedQty = item.returnItems.reduce(
                      (sum, row) => sum + row.qty,
                      0
                    );

                    return {
                      id: item.id,
                      qty: item.qty,
                      sellPrice: item.sellPrice,
                      alreadyReturnedQty,
                      remainingQty: Math.max(0, item.qty - alreadyReturnedQty),
                      variantId: item.variantId,
                      variant: item.variant,
                    };
                  }),
                }}
                replacementVariants={replacementVariants}
              />
            )}
          </div>

          <div className="xl:col-span-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-bold">آخر المرتجعات</h2>
                <span className="text-xs text-white/50">آخر 15 عملية</span>
              </div>

              <div className="space-y-3">
                {recentReturns.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/50">
                    لا توجد عمليات مرتجع حتى الآن.
                  </div>
                ) : (
                  recentReturns.map((row) => (
                    <div key={row.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${
                            row.type === "EXCHANGE"
                              ? "bg-red-600/20 text-red-300 border border-red-500/30"
                              : "bg-white/10 text-white/80 border border-white/10"
                          }`}
                        >
                          {row.type === "EXCHANGE" ? "استبدال" : "مرتجع"}
                        </span>

                        <span className="text-xs text-white/45">
                          {new Date(row.createdAt).toLocaleString("ar-EG")}
                        </span>
                      </div>

                      <div className="mt-3 text-sm text-white/70">
                        الفاتورة:{" "}
                        <span className="font-mono text-white text-xs">{row.sale.id}</span>
                      </div>
                      <div className="mt-1 text-sm text-white/70">
                        العميل: {row.sale.customer ?? "-"}
                      </div>
                      <div className="mt-1 text-sm text-white/70">
                        منفذ العملية: {row.createdBy.fullName ?? row.createdBy.username}
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                          <div className="text-white/50">صافي المرتجع</div>
                          <div className="mt-1 font-bold">{row.returnedValue}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                          <div className="text-white/50">قيمة الاستبدال</div>
                          <div className="mt-1 font-bold">{row.replacementValue}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                          <div className="text-white/50">مسترد</div>
                          <div className="mt-1 font-bold">{row.refundAmount}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                          <div className="text-white/50">إضافي</div>
                          <div className="mt-1 font-bold text-red-300">{row.extraAmount}</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}