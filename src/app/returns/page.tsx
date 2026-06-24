import Link from "next/link";
import CommandShell from "@/components/CommandShell";
import { EmptyState, MetricCard, PageHeader, StatusBadge } from "@/components/CommandUI";
import { formatCairoDateTime, getCairoDayRange } from "@/lib/cairo-time";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";
import { ReturnType as PrismaReturnType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

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

const boundedQty = z.coerce.number().int().min(0).max(999);

const inlineReturnActionSchema = z.object({
  saleId: z.string().trim().max(128).default(""),
  searchQ: z.string().trim().max(120).default(""),
  mode: z.preprocess(
    (value) => String(value ?? "REFUND").trim().toUpperCase(),
    z.enum(["REFUND", "EXCHANGE"])
  ),
  note: z.string().trim().max(1000).default(""),
});

const returnsSearchSchema = z.object({
  q: z.preprocess((value) => Array.isArray(value) ? value[0] : value, z.string().trim().max(120).optional().default("")),
  result: z.preprocess((value) => Array.isArray(value) ? value[0] : value, z.string().trim().max(80).optional().default("")),
  refund: z.preprocess((value) => Array.isArray(value) ? value[0] : value, z.coerce.number().min(0).max(100_000_000).optional().default(0)),
  extra: z.preprocess((value) => Array.isArray(value) ? value[0] : value, z.coerce.number().min(0).max(100_000_000).optional().default(0)),
});

function formObject(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

async function processReturnAction(formData: FormData) {
  "use server";

  const user = await requireUser();
  const { saleId, searchQ, mode, note } = inlineReturnActionSchema.parse(formObject(formData));

  if (!saleId) redirect(`/returns?result=notfound&q=${encodeURIComponent(searchQ)}`);

  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      items: {
        include: {
          variant: { include: { model: true } },
          returnItems: true,
        },
      },
    },
  });

  if (!sale) redirect(`/returns?result=notfound&q=${encodeURIComponent(searchQ)}`);

  let returnedGross = 0;
  let replacementValue = 0;
  let hasAnyRow = false;
  const selectedRows: Array<{ saleItemId: string; variantId: string; qty: number; unitPrice: number; lineTotal: number }> = [];
  const replacementRows: Array<{ variantId: string; qty: number; unitPrice: number; lineTotal: number }> = [];

  for (const item of sale.items) {
    const returnQty = boundedQty.parse(formData.get(`returnQty_${item.id}`) ?? 0);
    if (returnQty <= 0) continue;

    const alreadyReturned = item.returnItems.reduce((sum, row) => sum + row.qty, 0);
    const remainingQty = Math.max(0, item.qty - alreadyReturned);
    if (returnQty > remainingQty) redirect(`/returns?result=qty_error&q=${encodeURIComponent(searchQ)}`);

    hasAnyRow = true;
    const lineTotal = returnQty * item.sellPrice;
    returnedGross += lineTotal;
    selectedRows.push({ saleItemId: item.id, variantId: item.variantId, qty: returnQty, unitPrice: item.sellPrice, lineTotal });

    if (mode === "EXCHANGE") {
      const replacementVariantId = String(formData.get(`replacement_${item.id}`) ?? "").trim();
      if (!replacementVariantId) redirect(`/returns?result=replacement_required&q=${encodeURIComponent(searchQ)}`);

      const replacement = await prisma.productVariant.findUnique({ where: { id: replacementVariantId } });
      if (!replacement) redirect(`/returns?result=replacement_notfound&q=${encodeURIComponent(searchQ)}`);
      if (!replacement.isActive) redirect(`/returns?result=replacement_inactive&q=${encodeURIComponent(searchQ)}`);
      if (replacement.stockQty < returnQty) redirect(`/returns?result=stock_error&q=${encodeURIComponent(searchQ)}`);

      const replacementLineTotal = replacement.sellPrice * returnQty;
      replacementValue += replacementLineTotal;
      replacementRows.push({ variantId: replacement.id, qty: returnQty, unitPrice: replacement.sellPrice, lineTotal: replacementLineTotal });
    }
  }

  if (!hasAnyRow) redirect(`/returns?result=empty&q=${encodeURIComponent(searchQ)}`);

  const discountRatio = sale.total > 0 ? sale.discount / sale.total : 0;
  const returnedDiscountShare = Math.round(returnedGross * discountRatio);
  const returnedValue = Math.max(0, returnedGross - returnedDiscountShare);
  const refundAmount = mode === "REFUND" ? returnedValue : Math.max(0, returnedValue - replacementValue);
  const extraAmount = mode === "EXCHANGE" ? Math.max(0, replacementValue - returnedValue) : 0;

  await prisma.$transaction(async (tx) => {
    const createdReturn = await tx.saleReturn.create({
      data: {
        saleId: sale.id,
        createdById: user.id,
        type: mode === "EXCHANGE" ? PrismaReturnType.EXCHANGE : PrismaReturnType.REFUND,
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
      await tx.productVariant.update({ where: { id: row.variantId }, data: { stockQty: { increment: row.qty } } });
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
      await tx.productVariant.update({ where: { id: row.variantId }, data: { stockQty: { decrement: row.qty } } });
    }
  });

  revalidatePath("/returns");
  revalidatePath("/products");
  revalidatePath("/dashboard");
  revalidatePath("/invoices");

  redirect(`/returns?q=${encodeURIComponent(searchQ)}&result=ok&refund=${refundAmount}&extra=${extraAmount}`);
}

function resultMessage(result: string) {
  const messages: Record<string, string> = {
    qty_error: "الكمية المطلوبة أكبر من المتبقي القابل للمرتجع.",
    stock_error: "المخزون غير كاف في المنتج البديل.",
    replacement_required: "اختيار منتج بديل مطلوب عند تنفيذ استبدال.",
    replacement_notfound: "المنتج البديل غير موجود.",
    replacement_inactive: "المنتج البديل غير نشط.",
    empty: "لم يتم تحديد أي كمية مرتجع.",
    notfound: "لم يتم العثور على فاتورة مطابقة.",
  };
  return messages[result] ?? "";
}

export default async function ReturnsPage({ searchParams }: { searchParams?: SearchParamsLike }) {
  const user = await requireUser();
  const params = returnsSearchSchema.parse(await Promise.resolve(searchParams ?? {}));
  const q = params.q;
  const result = params.result;
  const refund = params.refund;
  const extra = params.extra;
  const today = getCairoDayRange();

  const [recentSales, recentReturns, replacementVariants, todayReturns] = await Promise.all([
    prisma.sale.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { seller: true, items: { include: { variant: { include: { model: true } } } } },
    }),
    prisma.saleReturn.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      include: {
        sale: { select: { id: true, customer: true } },
        createdBy: { select: { username: true, fullName: true } },
        items: true,
        replacements: true,
      },
    }),
    prisma.productVariant.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { model: true },
    }),
    prisma.saleReturn.findMany({ where: { createdAt: { gte: today.start, lt: today.end } } }),
  ]);

  const foundSale = q
    ? await prisma.sale.findFirst({
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
              variant: { include: { model: true } },
              returnItems: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      })
    : null;

  const todayRefund = todayReturns.reduce((sum, row) => sum + (row.refundAmount || 0), 0);
  const todayExtra = todayReturns.reduce((sum, row) => sum + (row.extraAmount || 0), 0);
  const totalRefund = recentReturns.reduce((sum, row) => sum + (row.refundAmount || 0), 0);

  return (
    <CommandShell active="returns" user={user}>
      <div className="mx-auto max-w-7xl space-y-8">
        <PageHeader
          eyebrow="إدارة المرتجعات"
          title="المرتجعات والاستبدال"
          description="بحث عن الفاتورة أو العميل، مراجعة سجل المرتجعات، وتنفيذ استرداد أو استبدال مع تحديث المخزون من البيانات الحقيقية فقط."
          actions={
            <Link href="/invoices" className="command-secondary px-5 py-3 text-xs font-black uppercase tracking-[0.12em]">
              الفواتير
            </Link>
          }
        />

        {result === "ok" ? (
          <div className="command-panel-high border-r-4 border-[var(--tertiary)] p-5">
            <div className="text-lg font-black text-[var(--tertiary)]">تم تنفيذ العملية بنجاح</div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-white/70">
              <span>المبلغ المسترد: {formatEGP(refund)}</span>
              <span>الإضافي المدفوع: {formatEGP(extra)}</span>
            </div>
          </div>
        ) : resultMessage(result) ? (
          <div className="command-panel-high border-r-4 border-[var(--primary)] p-5 text-sm text-[var(--primary-soft)]">
            {resultMessage(result)}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="مرتجعات اليوم" value={todayReturns.length} meta="استرداد واستبدال" tone="red" />
          <MetricCard label="مبالغ مستردة اليوم" value={formatEGP(todayRefund)} meta="فلوس راجعة للعميل" />
          <MetricCard label="فروق استبدال اليوم" value={formatEGP(todayExtra)} meta="مبالغ إضافية مدفوعة" tone="blue" />
          <MetricCard label="آخر سجل مرتجعات" value={recentReturns.length} meta={`إجمالي ظاهر ${formatEGP(totalRefund)}`} />
        </section>

        <form method="GET" className="command-panel-high grid gap-3 p-4 lg:grid-cols-12">
          <div className="lg:col-span-10">
            <label className="command-label mb-2 block">بحث المرتجع</label>
            <input
              name="q"
              defaultValue={q}
              placeholder="رقم الفاتورة أو اسم العميل..."
              className="command-input h-12 w-full px-4 text-sm placeholder:text-white/30"
            />
          </div>
          <button className="command-primary h-12 self-end text-xs font-black uppercase tracking-[0.12em] lg:col-span-2">
            بحث
          </button>
        </form>

        <section className="grid gap-6 xl:grid-cols-3">
          <div className="command-panel overflow-hidden xl:col-span-2">
            <div className="bg-[var(--surface-lowest)] px-5 py-4">
              <div className="command-label">سجل المرتجعات</div>
              <h2 className="mt-1 text-lg font-black text-white">آخر عمليات الاسترداد والاستبدال</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="command-table min-w-[980px] text-right text-sm">
                <thead>
                  <tr>
                    <th>الوقت</th>
                    <th>المرتجع</th>
                    <th>الفاتورة</th>
                    <th>النوع</th>
                    <th>القيمة</th>
                    <th>منفذ العملية</th>
                  </tr>
                </thead>
                <tbody>
                  {recentReturns.length === 0 ? (
                    <tr><td colSpan={6}><EmptyState>لا توجد مرتجعات مسجلة.</EmptyState></td></tr>
                  ) : (
                    recentReturns.map((row) => (
                      <tr key={row.id}>
                        <td className="text-white/58">{formatCairoDateTime(row.createdAt)}</td>
                        <td className="max-w-[180px] break-all font-mono text-xs font-bold text-white">{row.id}</td>
                        <td className="max-w-[180px] break-all font-mono text-xs text-white/60">{row.sale.id}</td>
                        <td><StatusBadge tone={row.type === "EXCHANGE" ? "blue" : "red"}>{row.type === "EXCHANGE" ? "استبدال" : "استرداد"}</StatusBadge></td>
                        <td className="font-black text-white">{formatEGP(row.refundAmount || row.extraAmount || row.returnedValue)}</td>
                        <td className="text-white/60">{row.createdBy.fullName || row.createdBy.username}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="command-panel-high p-5">
            <div className="command-label">وصول سريع</div>
            <h2 className="mt-2 text-xl font-black text-white">آخر الفواتير</h2>
            <div className="mt-5 space-y-3">
              {recentSales.length === 0 ? (
                <EmptyState>لا توجد فواتير بعد.</EmptyState>
              ) : (
                recentSales.map((sale) => (
                  <Link key={sale.id} href={`/returns?q=${encodeURIComponent(sale.id)}`} className="block bg-black/20 p-4 transition hover:bg-white/[0.045]">
                    <div className="max-w-full break-all font-mono text-[11px] font-black text-white">{sale.id}</div>
                    <div className="mt-2 text-xs text-white/58">{sale.customer || "عميل نقدي"} / {sale.seller?.username || "-"}</div>
                    <div className="mt-2 text-sm font-black text-white">{formatEGP(sale.total)}</div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </section>

        {foundSale ? (
          <section className="command-panel-high p-5">
            <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="command-label">تنفيذ عملية</div>
                <h2 className="mt-2 text-xl font-black text-white">فاتورة جاهزة للمرتجع</h2>
                <p className="mt-2 text-sm text-white/55">
                  العميل: {foundSale.customer || "عميل نقدي"} / البائع: {foundSale.seller?.fullName || foundSale.seller?.username || "-"}
                </p>
              </div>
              <div className="text-left">
                <div className="command-label">إجمالي الفاتورة</div>
                <div className="mt-2 text-2xl font-black text-white">{formatEGP(foundSale.total)}</div>
              </div>
            </div>

            <form action={processReturnAction} className="space-y-5">
              <input type="hidden" name="saleId" value={foundSale.id} />
              <input type="hidden" name="searchQ" value={q} />
              <div className="grid gap-3 lg:grid-cols-3">
                <select name="mode" defaultValue="REFUND" className="command-input h-12 px-4 text-sm">
                  <option value="REFUND" className="bg-[#201f1f]">استرداد</option>
                  <option value="EXCHANGE" className="bg-[#201f1f]">استبدال</option>
                </select>
                <textarea name="note" rows={2} placeholder="ملاحظة داخلية أو سبب المرتجع" className="command-input min-h-12 px-4 py-3 text-sm placeholder:text-white/30 lg:col-span-2" />
              </div>

              <div className="overflow-x-auto">
                <table className="command-table min-w-[1250px] text-right text-sm">
                  <thead>
                    <tr>
                      <th>الصنف</th>
                      <th>سعر الوحدة</th>
                      <th>المباع</th>
                      <th>مرتجع سابق</th>
                      <th>المتبقي</th>
                      <th>كمية المرتجع</th>
                      <th>بديل الاستبدال</th>
                    </tr>
                  </thead>
                  <tbody>
                    {foundSale.items.map((item) => {
                      const alreadyReturned = item.returnItems.reduce((sum, row) => sum + row.qty, 0);
                      const remainingQty = Math.max(0, item.qty - alreadyReturned);
                      const title = [
                        item.variant.model.brand,
                        item.variant.model.name,
                        item.variant.grade,
                        item.variant.size,
                        item.variant.color,
                        item.variant.sku ? `SKU ${item.variant.sku}` : "",
                      ].filter(Boolean).join(" - ");
                      return (
                        <tr key={item.id}>
                          <td className="font-black text-white">{title}</td>
                          <td>{formatEGP(item.sellPrice)}</td>
                          <td>{item.qty}</td>
                          <td className="text-white/58">{alreadyReturned}</td>
                          <td><StatusBadge tone={remainingQty > 0 ? "blue" : "neutral"}>{remainingQty}</StatusBadge></td>
                          <td>
                            <input name={`returnQty_${item.id}`} type="number" min="0" max={remainingQty} defaultValue={0} className="command-input h-10 w-24 px-3 text-sm" />
                          </td>
                          <td>
                            <select name={`replacement_${item.id}`} defaultValue="" className="command-input h-10 min-w-[360px] px-3 text-xs">
                              <option value="" className="bg-[#201f1f]">اختر بديل عند الاستبدال</option>
                              {replacementVariants.map((variant) => (
                                <option key={variant.id} value={variant.id} className="bg-[#201f1f]">
                                  {[variant.model.brand, variant.model.name, variant.grade, variant.size, variant.color, `مخزون ${variant.stockQty}`].filter(Boolean).join(" - ")}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end">
                <button className="command-primary px-8 py-4 text-xs font-black uppercase tracking-[0.14em]">
                  تنفيذ العملية
                </button>
              </div>
            </form>
          </section>
        ) : q ? (
          <section className="command-panel-high p-10">
            <EmptyState>لا توجد فاتورة مطابقة. جرّب رقم فاتورة أو اسم عميل مختلف.</EmptyState>
          </section>
        ) : null}
      </div>
    </CommandShell>
  );
}
