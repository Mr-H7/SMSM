import { prisma } from "@/lib/prisma";
import * as rbac from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ReturnType as PrismaReturnType } from "@prisma/client";

export const dynamic = "force-dynamic";

type SearchParamsLike =
  | Record<string, string | string[] | undefined>
  | Promise<Record<string, string | string[] | undefined>>;

function formatEGP(value: number) {
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function toNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

async function getCurrentUser() {
  const requireUser = (rbac as any).requireUser;
  if (typeof requireUser === "function") {
    try {
      return await requireUser();
    } catch {
      return null;
    }
  }

  const getSessionUser =
    (rbac as any).getCurrentUser ??
    (rbac as any).getSessionUser ??
    (rbac as any).getUserFromSession;

  if (typeof getSessionUser === "function") {
    return await getSessionUser();
  }

  return null;
}

async function ensureLoggedIn() {
  const requireUser = (rbac as any).requireUser;
  if (typeof requireUser === "function") {
    await requireUser();
  }
}

async function processReturnAction(formData: FormData) {
  "use server";

  const user = await getCurrentUser();
  if (!user?.id) {
    redirect("/login");
  }

  const saleId = String(formData.get("saleId") ?? "").trim();
  const searchQ = String(formData.get("searchQ") ?? "").trim();
  const mode = String(formData.get("mode") ?? "REFUND").trim().toUpperCase();
  const note = String(formData.get("note") ?? "").trim();

  if (!saleId) {
    redirect(`/returns?result=notfound&q=${encodeURIComponent(searchQ)}`);
  }

  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      items: {
        include: {
          variant: {
            include: {
              model: true,
            },
          },
          returnItems: true,
        },
      },
      seller: true,
      returns: {
        include: {
          items: true,
          replacements: true,
        },
      },
    },
  });

  if (!sale) {
    redirect(`/returns?result=notfound&q=${encodeURIComponent(searchQ)}`);
  }

  let returnedGross = 0;
  let replacementValue = 0;
  let hasAnyRow = false;

  const selectedRows: Array<{
    saleItemId: string;
    variantId: string;
    qty: number;
    unitPrice: number;
    lineTotal: number;
  }> = [];

  const replacementRows: Array<{
    variantId: string;
    qty: number;
    unitPrice: number;
    lineTotal: number;
  }> = [];

  for (const item of sale.items) {
    const returnQty = Math.max(0, toNumber(formData.get(`returnQty_${item.id}`)));
    if (returnQty <= 0) continue;

    const alreadyReturned = item.returnItems.reduce((sum, row) => {
      if (row.saleItemId === item.id) return sum + row.qty;
      return sum;
    }, 0);

    const remainingQty = Math.max(0, item.qty - alreadyReturned);

    if (returnQty > remainingQty) {
      redirect(`/returns?result=qty_error&q=${encodeURIComponent(searchQ)}`);
    }

    hasAnyRow = true;

    const lineTotal = returnQty * item.sellPrice;
    returnedGross += lineTotal;

    selectedRows.push({
      saleItemId: item.id,
      variantId: item.variantId,
      qty: returnQty,
      unitPrice: item.sellPrice,
      lineTotal,
    });

    if (mode === "EXCHANGE") {
      const replacementVariantId = String(formData.get(`replacement_${item.id}`) ?? "").trim();

      if (!replacementVariantId) {
        redirect(`/returns?result=replacement_required&q=${encodeURIComponent(searchQ)}`);
      }

      const replacement = await prisma.productVariant.findUnique({
        where: { id: replacementVariantId },
        include: { model: true },
      });

      if (!replacement) {
        redirect(`/returns?result=replacement_notfound&q=${encodeURIComponent(searchQ)}`);
      }

      if (!replacement.isActive) {
        redirect(`/returns?result=replacement_inactive&q=${encodeURIComponent(searchQ)}`);
      }

      if (replacement.stockQty < returnQty) {
        redirect(`/returns?result=stock_error&q=${encodeURIComponent(searchQ)}`);
      }

      const replacementLineTotal = replacement.sellPrice * returnQty;
      replacementValue += replacementLineTotal;

      replacementRows.push({
        variantId: replacement.id,
        qty: returnQty,
        unitPrice: replacement.sellPrice,
        lineTotal: replacementLineTotal,
      });
    }
  }

  if (!hasAnyRow) {
    redirect(`/returns?result=empty&q=${encodeURIComponent(searchQ)}`);
  }

  const discountRatio = sale.total > 0 ? sale.discount / sale.total : 0;
  const returnedDiscountShare = Math.round(returnedGross * discountRatio);
  const returnedValue = Math.max(0, returnedGross - returnedDiscountShare);

  const refundAmount =
    mode === "REFUND"
      ? returnedValue
      : Math.max(0, returnedValue - replacementValue);

  const extraAmount =
    mode === "EXCHANGE"
      ? Math.max(0, replacementValue - returnedValue)
      : 0;

  await prisma.$transaction(async (tx) => {
    const createdReturn = await tx.saleReturn.create({
      data: {
        saleId: sale.id,
        createdById: user.id,
        type:
          mode === "EXCHANGE"
            ? PrismaReturnType.EXCHANGE
            : PrismaReturnType.REFUND,
        notes: note || null,
        returnedGross,
        returnedDiscountShare,
        returnedValue,
        replacementValue,
        refundAmount,
        extraAmount,
      },
    });

    for (const row of selectedRows) {
      await tx.saleReturnItem.create({
        data: {
          returnId: createdReturn.id,
          saleItemId: row.saleItemId,
          variantId: row.variantId,
          qty: row.qty,
          unitPrice: row.unitPrice,
          lineTotal: row.lineTotal,
        },
      });

      await tx.productVariant.update({
        where: { id: row.variantId },
        data: {
          stockQty: {
            increment: row.qty,
          },
        },
      });
    }

    for (const row of replacementRows) {
      await tx.saleReturnReplacement.create({
        data: {
          returnId: createdReturn.id,
          variantId: row.variantId,
          qty: row.qty,
          unitPrice: row.unitPrice,
          lineTotal: row.lineTotal,
        },
      });

      await tx.productVariant.update({
        where: { id: row.variantId },
        data: {
          stockQty: {
            decrement: row.qty,
          },
        },
      });
    }
  });

  revalidatePath("/returns");
  revalidatePath("/products");
  revalidatePath("/dashboard");
  revalidatePath("/invoices");

  redirect(
    `/returns?q=${encodeURIComponent(searchQ)}&result=ok&refund=${encodeURIComponent(
      String(refundAmount)
    )}&extra=${encodeURIComponent(String(extraAmount))}`
  );
}

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams?: SearchParamsLike;
}) {
  await ensureLoggedIn();

  const params = await Promise.resolve(searchParams ?? {});
  const q = String(params?.q ?? "").trim();
  const result = String(params?.result ?? "").trim();
  const refund = toNumber(params?.refund);
  const extra = toNumber(params?.extra);

  const recentSales = await prisma.sale.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    include: {
      seller: true,
      items: {
        include: {
          variant: {
            include: {
              model: true,
            },
          },
        },
      },
    },
  });

  let foundSale:
    | (Awaited<ReturnType<typeof prisma.sale.findFirst>> & {
        seller: any;
        items: any[];
      })
    | null = null;

  if (q) {
    foundSale = await prisma.sale.findFirst({
      where: {
        OR: [
          { id: { contains: q, mode: "insensitive" } },
          { customer: { contains: q, mode: "insensitive" } },
        ],
      },
      include: {
        seller: true,
        items: {
          include: {
            variant: {
              include: {
                model: true,
                returnItems: true,
              },
            },
            returnItems: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  const replacementVariants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      model: true,
    },
  });

  return (
    <main dir="rtl" className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <Link
            href="/dashboard"
            className="inline-flex h-11 items-center rounded-2xl border border-white/10 bg-white/5 px-5 text-sm font-bold text-white transition hover:bg-white/10"
          >
            رجوع
          </Link>
        </div>

        <div className="mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight">المرتجعات والاستبدال</h1>
          <p className="mt-2 text-sm text-white/60">
            بحث بالفاتورة أو العميل، ثم تنفيذ الاسترداد أو الاستبدال بشكل صحيح ومربوط بالمخزون.
          </p>
        </div>

        {result === "ok" ? (
          <div className="mb-6 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-5">
            <div className="text-lg font-extrabold text-emerald-300">تم تنفيذ العملية بنجاح</div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-emerald-100/90">
              <span>المبلغ المسترد: {formatEGP(refund)}</span>
              <span>المبلغ الإضافي: {formatEGP(extra)}</span>
            </div>
          </div>
        ) : null}

        {[
          "qty_error",
          "stock_error",
          "replacement_required",
          "replacement_notfound",
          "replacement_inactive",
          "empty",
          "notfound",
        ].includes(result) ? (
          <div className="mb-6 rounded-3xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
            {result === "qty_error" && "الكمية المطلوبة أكبر من الكمية المتبقية القابلة للمرتجع."}
            {result === "stock_error" && "المخزون غير كافٍ في المنتج البديل."}
            {result === "replacement_required" && "يجب اختيار منتج بديل لكل عنصر في وضع الاستبدال."}
            {result === "replacement_notfound" && "المنتج البديل المحدد غير موجود."}
            {result === "replacement_inactive" && "المنتج البديل غير نشط."}
            {result === "empty" && "لم يتم تحديد أي كمية مرتجع."}
            {result === "notfound" && "الفاتورة أو العميل غير موجود."}
          </div>
        ) : null}

        <section className="mb-8 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
          <form method="GET" className="grid gap-4 lg:grid-cols-[1fr_auto]">
            <div>
              <label className="mb-2 block text-sm text-white/65">
                ابحث برقم البيع أو اسم العميل
              </label>
              <input
                name="q"
                defaultValue={q}
                placeholder="مثال: haytham أو cmnha8..."
                className="h-12 w-full rounded-2xl border border-white/10 bg-black/40 px-4 outline-none placeholder:text-white/35 focus:border-red-500/60"
              />
            </div>

            <button className="h-12 self-end rounded-2xl bg-red-600 px-6 text-sm font-extrabold transition hover:bg-red-500">
              بحث
            </button>
          </form>
        </section>

        {!q ? (
          <section className="mb-8 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-4">
              <h2 className="text-xl font-extrabold">آخر الفواتير</h2>
              <p className="mt-1 text-sm text-white/55">
                للوصول السريع إلى أحدث المبيعات قبل تنفيذ المرتجع أو الاستبدال.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {recentSales.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/30 p-5 text-sm text-white/45">
                  لا توجد مبيعات بعد.
                </div>
              ) : (
                recentSales.map((sale) => (
                  <Link
                    key={sale.id}
                    href={`/returns?q=${encodeURIComponent(sale.id)}`}
                    className="rounded-2xl border border-white/10 bg-black/30 p-5 transition hover:border-red-500/40 hover:bg-white/[0.04]"
                  >
                    <div className="text-sm text-white/55">رقم الفاتورة</div>
                    <div className="mt-1 break-all text-lg font-extrabold">{sale.id}</div>
                    <div className="mt-3 text-sm text-white/70">العميل: {sale.customer || "بدون اسم"}</div>
                    <div className="mt-1 text-sm text-white/70">البائع: {sale.seller?.username || "-"}</div>
                    <div className="mt-3 text-sm font-bold">{formatEGP(sale.total)}</div>
                    <div className="mt-2 text-xs text-white/45">
                      {new Date(sale.createdAt).toLocaleString("ar-EG")}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </section>
        ) : null}

        {foundSale ? (
          <>
            <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="text-sm text-white/60">رقم الفاتورة</div>
                <div className="mt-2 break-all text-xl font-black">{foundSale.id}</div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="text-sm text-white/60">العميل</div>
                <div className="mt-2 text-lg font-bold">{foundSale.customer || "بدون اسم"}</div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="text-sm text-white/60">البائع</div>
                <div className="mt-2 text-lg font-bold">{foundSale.seller?.username || "-"}</div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="text-sm text-white/60">إجمالي الفاتورة</div>
                <div className="mt-2 text-2xl font-black">{formatEGP(foundSale.total)}</div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="text-sm text-white/60">الخصم / التاريخ</div>
                <div className="mt-2 text-sm font-bold text-white/85">
                  {formatEGP(foundSale.discount)}
                  <div className="mt-1 text-white/55">
                    {new Date(foundSale.createdAt).toLocaleString("ar-EG")}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
              <div className="mb-5">
                <h2 className="text-xl font-extrabold">تنفيذ مرتجع أو استبدال</h2>
                <p className="mt-1 text-sm text-white/55">
                  حدّد الكميات بدقة. النظام يتحقق من المتبقي ويحدّث المخزون ويسجل العملية.
                </p>
              </div>

              <form action={processReturnAction} className="space-y-6">
                <input type="hidden" name="saleId" value={foundSale.id} />
                <input type="hidden" name="searchQ" value={q} />

                <div className="grid gap-4 lg:grid-cols-3">
                  <label className="rounded-2xl border border-white/10 bg-black/40 p-4">
                    <span className="mb-2 block text-sm text-white/65">نوع العملية</span>
                    <select
                      name="mode"
                      defaultValue="REFUND"
                      className="h-11 w-full rounded-xl border border-white/10 bg-black/50 px-4 outline-none focus:border-red-500/60"
                    >
                      <option value="REFUND" className="bg-black">
                        استرداد
                      </option>
                      <option value="EXCHANGE" className="bg-black">
                        استبدال
                      </option>
                    </select>
                  </label>

                  <label className="rounded-2xl border border-white/10 bg-black/40 p-4 lg:col-span-2">
                    <span className="mb-2 block text-sm text-white/65">ملاحظة داخلية</span>
                    <textarea
                      name="note"
                      rows={2}
                      placeholder="سبب المرتجع أو ملاحظة تشغيلية"
                      className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 outline-none placeholder:text-white/35 focus:border-red-500/60"
                    />
                  </label>
                </div>

                <div className="overflow-x-auto rounded-3xl border border-white/10">
                  <table className="min-w-[1250px] w-full text-right">
                    <thead className="bg-white/[0.03] text-sm text-white/70">
                      <tr>
                        <th className="px-4 py-4">العنصر</th>
                        <th className="px-4 py-4">سعر الوحدة</th>
                        <th className="px-4 py-4">المباع</th>
                        <th className="px-4 py-4">مرتجع سابق</th>
                        <th className="px-4 py-4">المتبقي</th>
                        <th className="px-4 py-4">كمية المرتجع</th>
                        <th className="px-4 py-4">المنتج البديل</th>
                      </tr>
                    </thead>

                    <tbody>
                      {foundSale.items.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-16 text-center text-sm text-white/45">
                            لا توجد عناصر داخل هذه الفاتورة.
                          </td>
                        </tr>
                      ) : (
                        foundSale.items.map((item) => {
                          const alreadyReturned = item.returnItems.reduce((sum, row) => sum + row.qty, 0);
                          const remainingQty = Math.max(0, item.qty - alreadyReturned);

                          const title = [
                            item.variant.model?.name || "",
                            item.variant.model?.brand || "",
                            item.variant.grade || "",
                            item.variant.size || "",
                            item.variant.color || "",
                            item.variant.sku || "",
                          ]
                            .filter(Boolean)
                            .join(" - ");

                          return (
                            <tr key={item.id} className="border-t border-white/10 align-top">
                              <td className="px-4 py-4">
                                <div className="font-bold">{title || "عنصر"}</div>
                              </td>

                              <td className="px-4 py-4">{formatEGP(item.sellPrice)}</td>
                              <td className="px-4 py-4 font-bold">{item.qty}</td>
                              <td className="px-4 py-4 text-white/65">{alreadyReturned}</td>
                              <td className="px-4 py-4">
                                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">
                                  {remainingQty}
                                </span>
                              </td>

                              <td className="px-4 py-4">
                                <input
                                  name={`returnQty_${item.id}`}
                                  type="number"
                                  min="0"
                                  max={remainingQty}
                                  defaultValue={0}
                                  className="h-11 w-28 rounded-xl border border-white/10 bg-black/40 px-3 outline-none focus:border-red-500/60"
                                />
                              </td>

                              <td className="px-4 py-4">
                                <select
                                  name={`replacement_${item.id}`}
                                  defaultValue=""
                                  className="h-11 min-w-[360px] rounded-xl border border-white/10 bg-black/40 px-3 outline-none focus:border-red-500/60"
                                >
                                  <option value="" className="bg-black">
                                    اختر بديلًا عند الاستبدال
                                  </option>

                                  {replacementVariants.map((variant) => (
                                    <option key={variant.id} value={variant.id} className="bg-black">
                                      {[
                                        variant.model.name,
                                        variant.model.brand || "",
                                        variant.grade,
                                        variant.size || "",
                                        variant.color || "",
                                        `مخزون ${variant.stockQty}`,
                                      ]
                                        .filter(Boolean)
                                        .join(" - ")}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end">
                  <button className="h-12 rounded-2xl bg-red-600 px-8 text-sm font-extrabold transition hover:bg-red-500">
                    تنفيذ العملية
                  </button>
                </div>
              </form>
            </section>
          </>
        ) : q ? (
          <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-10 text-center">
            <div className="text-lg font-extrabold">لا توجد فاتورة مطابقة</div>
            <p className="mt-2 text-sm text-white/55">جرّب رقم بيع أو اسم عميل مختلف.</p>
          </section>
        ) : null}
      </div>
    </main>
  );
}