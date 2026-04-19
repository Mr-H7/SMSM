import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";
import PrintButton from "./PrintButton";
import {
  addDays,
  formatCairoDate,
  formatCairoDateTime,
} from "@/lib/cairo-time";

function money(n: number) {
  return new Intl.NumberFormat("ar-EG").format(n || 0);
}

function getCustomerName(sale: any) {
  return sale.customer || "عميل نقدي";
}

function getItemQty(item: any) {
  return item.qty ?? 0;
}

function getItemPrice(item: any) {
  return item.sellPrice ?? 0;
}

function getItemTotal(item: any) {
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
          fullName: true,
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

  if (!sale) notFound();

  const itemsSubtotal = sale.items.reduce(
    (sum: number, item: any) => sum + getItemTotal(item),
    0
  );

  const discount = sale.discount || 0;
  const finalTotal = sale.total ?? Math.max(0, itemsSubtotal - discount);

  const totalReturnedAmount = (sale.returns || []).reduce(
    (sum: number, r: any) => sum + (r.refundAmount || 0),
    0
  );

  const hasReturns = (sale.returns || []).length > 0;
  const returnLastDate = addDays(sale.createdAt, 10);

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-black text-white print:bg-white print:text-black"
    >
      <style>
        {`
          @page {
            size: 80mm 210mm;
            margin: 0;
          }

          @media print {
            html, body {
              width: 80mm;
              background: #ffffff !important;
            }

            body {
              margin: 0 !important;
              padding: 0 !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }

            * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
          }
        `}
      </style>

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
              href={`/returns?q=${sale.id}`}
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

        <div className="mx-auto w-full max-w-[302px] overflow-hidden rounded-2xl border border-neutral-200 bg-white text-black shadow-2xl print:max-w-[80mm] print:rounded-none print:border-0 print:shadow-none">
          <div className="border-b border-neutral-200 bg-white px-4 py-4 text-center">
            <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-neutral-200 bg-white">
              <Image
                src="/smsm-logo.png"
                alt="SMSM Logo"
                width={80}
                height={80}
                className="h-full w-full object-contain p-2"
                priority
                unoptimized
              />
            </div>

            <h1 className="text-xl font-black tracking-wide">SMSM</h1>
            <p className="mt-1 text-xs text-neutral-700">فاتورة بيع</p>
            <p className="text-[11px] text-neutral-500">Shoes Store Management</p>
          </div>

          <div className="space-y-2 border-b border-neutral-200 px-4 py-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <span className="text-neutral-500">رقم الفاتورة</span>
              <span className="max-w-[180px] break-all text-left font-bold">
                {sale.id}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-neutral-500">التاريخ</span>
              <span className="font-bold">
                {formatCairoDateTime(sale.createdAt)}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-neutral-500">العميل</span>
              <span className="font-bold">{getCustomerName(sale)}</span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-neutral-500">البائع</span>
              <span className="font-bold">
                {sale.seller?.fullName || sale.seller?.username || "-"}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-neutral-500">طريقة الدفع</span>
              <span className="font-bold">
                {sale.paymentMethod === "TRANSFER" ? "تحويل" : "كاش"}
              </span>
            </div>

            {sale.paymentMethod === "TRANSFER" && sale.paymentDescription ? (
              <div className="flex items-start justify-between gap-3">
                <span className="text-neutral-500 shrink-0">تفاصيل التحويل</span>
                <span className="font-bold text-left break-all max-w-[180px]">
                  {sale.paymentDescription}
                </span>
              </div>
            ) : null}
          </div>

          <div className="px-4 py-4">
            <div className="mb-3 border-b border-dashed border-neutral-300 pb-2 text-center text-sm font-black">
              تفاصيل المنتجات
            </div>

            <div className="space-y-3">
              {sale.items.map((item: any, index: number) => {
                const title = [
                  item.variant?.model?.name || "",
                  item.variant?.model?.brand || "",
                  item.variant?.grade || "",
                  item.variant?.size || "",
                  item.variant?.color || "",
                ]
                  .filter(Boolean)
                  .join(" - ");

                return (
                  <div
                    key={item.id ?? index}
                    className="border-b border-dashed border-neutral-200 pb-3 text-sm last:border-b-0"
                  >
                    <div className="font-bold leading-6">{title || "منتج"}</div>

                    <div className="mt-2 flex items-center justify-between text-neutral-600">
                      <span>الكمية</span>
                      <span>{getItemQty(item)}</span>
                    </div>

                    <div className="flex items-center justify-between text-neutral-600">
                      <span>اللون</span>
                      <span>{item.variant?.color || "-"}</span>
                    </div>

                    <div className="flex items-center justify-between text-neutral-600">
                      <span>سعر الوحدة</span>
                      <span>{money(getItemPrice(item))} ج.م</span>
                    </div>

                    <div className="mt-1 flex items-center justify-between font-black">
                      <span>الإجمالي</span>
                      <span>{money(getItemTotal(item))} ج.م</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t border-neutral-200 px-4 py-4">
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-neutral-600">إجمالي المنتجات</span>
                <span className="font-bold">{money(itemsSubtotal)} ج.م</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-neutral-600">الخصم</span>
                <span className="font-bold">{money(discount)} ج.م</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-neutral-600">إجمالي المرتجعات</span>
                <span className="font-bold">{money(totalReturnedAmount)} ج.م</span>
              </div>

              <div className="mt-3 border-t border-dashed border-neutral-300 pt-3">
                <div className="flex items-center justify-between text-base font-black">
                  <span>الصافي النهائي</span>
                  <span>{money(finalTotal)} ج.م</span>
                </div>
              </div>
            </div>
          </div>

          {hasReturns ? (
            <div className="border-t border-neutral-200 px-4 py-4">
              <div className="mb-3 text-center text-sm font-black">
                المرتجعات / الاستبدال
              </div>

              <div className="space-y-3">
                {sale.returns.map((ret: any) => (
                  <div
                    key={ret.id}
                    className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-bold">
                        {ret.type === "EXCHANGE" ? "استبدال" : "مرتجع"}
                      </span>
                      <span className="text-xs text-neutral-500">
                        {formatCairoDateTime(ret.createdAt)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-neutral-600">
                      <span>مبلغ مسترد</span>
                      <span>{money(ret.refundAmount || 0)} ج.م</span>
                    </div>

                    <div className="flex items-center justify-between text-neutral-600">
                      <span>فرق إضافي</span>
                      <span>{money(ret.extraAmount || 0)} ج.م</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="border-t border-neutral-200 bg-red-50 px-4 py-3 text-center text-[11px] leading-6 text-red-700">
            آخر موعد للاسترجاع:{"10 أيام "}
            <span className="font-black">{formatCairoDate(returnLastDate)}</span>
          </div>

          <div className="border-t border-neutral-200 px-4 py-4 text-center text-[11px] leading-6 text-neutral-500">
            شكرًا لتعاملكم مع SMSM
            <br />
            يرجى الاحتفاظ بالفاتورة حتى آخر موعد للاسترجاع
          </div>
        </div>
      </div>
    </div>
  );
}