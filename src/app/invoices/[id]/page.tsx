import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";
import PrintButton from "./PrintButton";

function money(n: number) {
  return new Intl.NumberFormat("ar-EG").format(n || 0);
}

function dateTime(d: Date | string) {
  const value = new Date(d);
  return new Intl.DateTimeFormat("ar-EG", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function getCustomerName(sale: any) {
  return (
    sale.customerName ||
    sale.clientName ||
    sale.customer ||
    sale.buyerName ||
    "عميل نقدي"
  );
}

function getItemQty(item: any) {
  return item.qty ?? item.quantity ?? 0;
}

function getItemPrice(item: any) {
  return item.price ?? item.unitPrice ?? item.sellPrice ?? 0;
}

function getItemTotal(item: any) {
  if (typeof item.lineTotal === "number") return item.lineTotal;
  if (typeof item.total === "number") return item.total;
  return getItemQty(item) * getItemPrice(item);
}

export default async function InvoiceDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();

  const { id } = await params;

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      seller: {
        select: {
          username: true,
        },
      },
      items: {
        orderBy: { id: "asc" },
        include: {
          variant: {
            include: {
              model: true,
            },
          },
        },
      },
      returns: {
        orderBy: { createdAt: "desc" },
        include: {
          items: true,
          replacements: {
            include: {
              variant: {
                include: {
                  model: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!sale) {
    notFound();
  }

  const itemsSubtotal = sale.items.reduce(
    (sum, item: any) => sum + getItemTotal(item),
    0
  );

  const discount = sale.discount || 0;
  const finalTotal =
    typeof sale.total === "number"
      ? sale.total
      : Math.max(0, itemsSubtotal - discount);

  const totalReturnedAmount = (sale.returns || []).reduce(
    (sum: number, r: any) => sum + (r.refundAmount || 0),
    0
  );

  const hasReturns = (sale.returns || []).length > 0;

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-black text-white print:bg-white print:text-black"
    >
      <div className="mx-auto max-w-5xl px-4 py-8 print:max-w-none print:px-0 print:py-0">
        <div className="mb-6 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-3">
            <Link
              href="/invoices"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
            >
              رجوع للفواتير
            </Link>

            <Link
              href={`/returns?saleId=${sale.id}`}
              className={`rounded-xl px-4 py-2 text-sm ${
                hasReturns
                  ? "border border-red-500/30 bg-red-600/15 text-red-200 hover:bg-red-600/25"
                  : "border border-white/10 bg-white/5 hover:bg-white/10"
              }`}
            >
              مرتجع / استبدال
            </Link>
          </div>

          <PrintButton />
        </div>

        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white text-black shadow-2xl print:rounded-none print:border-0 print:shadow-none">
          <div className="border-b border-neutral-200 px-6 py-6">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-neutral-200 bg-white">
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
                  <h1 className="text-3xl font-black">فاتورة بيع</h1>
                  <p className="mt-1 text-sm text-neutral-600">SMSM Shoes Store</p>
                  <p className="mt-1 text-sm text-neutral-500">
                    نظام إدارة محل الأحذية
                  </p>
                </div>
              </div>

              <div className="text-left">
                <div className="text-sm text-neutral-500">رقم الفاتورة</div>
                <div className="mt-1 break-all text-lg font-black">{sale.id}</div>
                <div className="mt-3 text-sm text-neutral-500">تاريخ الإنشاء</div>
                <div className="mt-1 font-bold">{dateTime(sale.createdAt)}</div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 border-b border-neutral-200 px-6 py-5 md:grid-cols-3">
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="text-sm text-neutral-500">اسم العميل</div>
              <div className="mt-2 text-lg font-bold">{getCustomerName(sale)}</div>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="text-sm text-neutral-500">البائع</div>
              <div className="mt-2 text-lg font-bold">
                {sale.seller?.username || "-"}
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="text-sm text-neutral-500">عدد المنتجات</div>
              <div className="mt-2 text-lg font-bold">{sale.items.length}</div>
            </div>
          </div>

          <div className="px-6 py-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-black">تفاصيل المنتجات</h2>
              <span className="rounded-full border border-neutral-200 px-3 py-1 text-xs font-bold text-neutral-600">
                {sale.items.length} عنصر
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-right text-sm">
                <thead>
                  <tr className="bg-neutral-100 text-neutral-700">
                    <th className="border border-neutral-200 px-3 py-3">#</th>
                    <th className="border border-neutral-200 px-3 py-3">الموديل</th>
                    <th className="border border-neutral-200 px-3 py-3">البراند</th>
                    <th className="border border-neutral-200 px-3 py-3">الصنف</th>
                    <th className="border border-neutral-200 px-3 py-3">المقاس</th>
                    <th className="border border-neutral-200 px-3 py-3">اللون</th>
                    <th className="border border-neutral-200 px-3 py-3">SKU</th>
                    <th className="border border-neutral-200 px-3 py-3">الكمية</th>
                    <th className="border border-neutral-200 px-3 py-3">سعر الوحدة</th>
                    <th className="border border-neutral-200 px-3 py-3">الإجمالي</th>
                  </tr>
                </thead>

                <tbody>
                  {sale.items.map((item: any, index: number) => (
                    <tr
                      key={item.id ?? index}
                      className="odd:bg-white even:bg-neutral-50/60"
                    >
                      <td className="border border-neutral-200 px-3 py-3 font-bold">
                        {index + 1}
                      </td>
                      <td className="border border-neutral-200 px-3 py-3 font-semibold">
                        {item.variant?.model?.name || "-"}
                      </td>
                      <td className="border border-neutral-200 px-3 py-3">
                        {item.variant?.model?.brand || "-"}
                      </td>
                      <td className="border border-neutral-200 px-3 py-3">
                        {item.variant?.grade || "-"}
                      </td>
                      <td className="border border-neutral-200 px-3 py-3">
                        {item.variant?.size || "-"}
                      </td>
                      <td className="border border-neutral-200 px-3 py-3">
                        {item.variant?.color || "-"}
                      </td>
                      <td className="border border-neutral-200 px-3 py-3">
                        {item.variant?.sku || "-"}
                      </td>
                      <td className="border border-neutral-200 px-3 py-3 font-bold">
                        {getItemQty(item)}
                      </td>
                      <td className="border border-neutral-200 px-3 py-3">
                        {money(getItemPrice(item))}
                      </td>
                      <td className="border border-neutral-200 px-3 py-3 font-black">
                        {money(getItemTotal(item))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4 border-t border-neutral-200 px-6 py-6 md:grid-cols-2">
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
              <h3 className="mb-4 text-lg font-black">ملاحظات</h3>
              <div className="text-sm leading-7 text-neutral-600">
                شكرًا لتعاملكم مع SMSM.
                <br />
                هذه الفاتورة صادرة من النظام التجاري الداخلي للمتجر.
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
              <h3 className="mb-4 text-lg font-black">الملخص المالي</h3>

              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between border-b border-neutral-200 pb-2">
                  <span className="text-neutral-600">إجمالي المنتجات</span>
                  <span className="font-bold">{money(itemsSubtotal)} ج.م</span>
                </div>

                <div className="flex items-center justify-between border-b border-neutral-200 pb-2">
                  <span className="text-neutral-600">الخصم</span>
                  <span className="font-bold">{money(discount)} ج.م</span>
                </div>

                <div className="flex items-center justify-between border-b border-neutral-200 pb-2">
                  <span className="text-neutral-600">إجمالي المرتجعات</span>
                  <span className="font-bold">{money(totalReturnedAmount)} ج.م</span>
                </div>

                <div className="flex items-center justify-between pt-1 text-lg">
                  <span className="font-black">الصافي النهائي</span>
                  <span className="font-black">{money(finalTotal)} ج.م</span>
                </div>
              </div>
            </div>
          </div>

          {hasReturns && (
            <div className="border-t border-neutral-200 px-6 py-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-black">سجل المرتجعات / الاستبدال</h2>
                <span className="rounded-full border border-neutral-200 px-3 py-1 text-xs font-bold text-neutral-600">
                  {(sale.returns || []).length} عملية
                </span>
              </div>

              <div className="space-y-4">
                {(sale.returns || []).map((ret: any) => (
                  <div
                    key={ret.id}
                    className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4"
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-black px-3 py-1 text-xs font-bold text-white">
                          {ret.type === "REFUND" ? "استرجاع" : "استبدال"}
                        </span>
                        <span className="text-sm text-neutral-500">
                          {dateTime(ret.createdAt)}
                        </span>
                      </div>

                      <div className="text-sm">
                        <span className="text-neutral-500">مبلغ الاسترجاع: </span>
                        <span className="font-bold">
                          {money(ret.refundAmount || 0)} ج.م
                        </span>
                        <span className="mx-2 text-neutral-300">|</span>
                        <span className="text-neutral-500">فرق إضافي: </span>
                        <span className="font-bold">
                          {money(ret.extraAmount || 0)} ج.م
                        </span>
                      </div>
                    </div>

                    {ret.items?.length > 0 && (
                      <div className="mb-3">
                        <div className="mb-2 text-sm font-bold text-neutral-700">
                          العناصر المرتجعة
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {ret.items.map((item: any, idx: number) => (
                            <span
                              key={item.id ?? idx}
                              className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs"
                            >
                              الكمية: {item.qty ?? item.quantity ?? 0}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {ret.replacements?.length > 0 && (
                      <div>
                        <div className="mb-2 text-sm font-bold text-neutral-700">
                          المنتجات البديلة
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {ret.replacements.map((rep: any, idx: number) => (
                            <span
                              key={rep.id ?? idx}
                              className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs"
                            >
                              {rep.variant?.model?.name || "منتج بديل"} /{" "}
                              {rep.variant?.size || "-"} /{" "}
                              {rep.variant?.color || "-"} / كمية:{" "}
                              {rep.qty ?? rep.quantity ?? 0}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-neutral-200 px-6 py-4 text-center text-xs text-neutral-500">
            SMSM Store — فاتورة صادرة من النظام
          </div>
        </div>
      </div>
    </div>
  );
}