import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import CommandShell from "@/components/CommandShell";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";
import PrintButton from "./PrintButton";
import { addDays, formatCairoDate, formatCairoDateTime } from "@/lib/cairo-time";

function money(n: number) {
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(n || 0);
}

function getCustomerName(sale: any) {
  return sale.customer || "عميل مباشر";
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

function itemTitle(item: any) {
  return [
    item.variant?.model?.brand || "",
    item.variant?.model?.name || "",
    item.variant?.grade || "",
    item.variant?.size || "",
    item.variant?.color || "",
  ]
    .filter(Boolean)
    .join(" - ");
}

export default async function InvoiceDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      seller: { select: { username: true, fullName: true } },
      items: {
        orderBy: { id: "asc" },
        include: { variant: { include: { model: true } } },
      },
      returns: {
        orderBy: { createdAt: "desc" },
        include: {
          items: true,
          replacements: { include: { variant: { include: { model: true } } } },
        },
      },
    },
  });

  if (!sale) notFound();

  const itemsSubtotal = sale.items.reduce((sum: number, item: any) => sum + getItemTotal(item), 0);
  const discount = sale.discount || 0;
  const finalTotal = sale.total ?? Math.max(0, itemsSubtotal - discount);
  const totalReturnedAmount = (sale.returns || []).reduce(
    (sum: number, r: any) => sum + (r.refundAmount || 0),
    0
  );
  const hasReturns = (sale.returns || []).length > 0;
  const returnLastDate = addDays(sale.createdAt, 10);

  return (
    <CommandShell active="invoices" user={user}>
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

      <div className="mx-auto max-w-5xl space-y-6 print:max-w-none">
        <div className="print-hidden flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="command-label">إيصال حراري</div>
            <h1 className="mt-2 text-2xl font-black uppercase tracking-tight text-white">
              تفاصيل الفاتورة
            </h1>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/invoices" className="command-secondary px-4 py-3 text-xs font-black uppercase tracking-[0.12em]">
              رجوع
            </Link>
            <Link
              href={`/returns?q=${encodeURIComponent(sale.id)}`}
              className={hasReturns ? "command-primary px-4 py-3 text-xs font-black uppercase tracking-[0.12em]" : "command-secondary px-4 py-3 text-xs font-black uppercase tracking-[0.12em]"}
            >
              مرتجع / استبدال
            </Link>
            <PrintButton />
          </div>
        </div>

        <div className="command-panel-high print-hidden grid gap-4 p-4 md:grid-cols-4">
          <div>
            <div className="command-label">الفاتورة</div>
            <div className="mt-2 break-all font-mono text-xs font-black text-white">{sale.id}</div>
          </div>
          <div>
            <div className="command-label">الدفع</div>
            <div className="mt-2 text-sm font-black text-white">
              {sale.paymentMethod === "TRANSFER" ? "تحويل" : "نقدي"}
            </div>
          </div>
          <div>
            <div className="command-label">الإجمالي</div>
            <div className="mt-2 text-lg font-black text-white">{money(finalTotal)} EGP</div>
          </div>
          <div>
            <div className="command-label">المرتجعات</div>
            <div className="mt-2 text-lg font-black text-white">{sale.returns.length}</div>
          </div>
        </div>

        <article className="receipt-paper mx-auto w-full max-w-[302px] overflow-hidden rounded-sm border border-neutral-200 text-black shadow-[0_30px_80px_rgba(0,0,0,0.45)] print:max-w-[80mm] print:rounded-none print:border-0 print:shadow-none">
          <header className="border-b border-neutral-200 bg-white px-4 py-5 text-center">
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
            <h2 className="text-xl font-black tracking-wide">SMSM STORE</h2>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.18em] text-neutral-500">
              فاتورة بيع
            </p>
          </header>

          <section className="space-y-2 border-b border-neutral-200 px-4 py-4 text-[12px]">
            <div className="flex items-start justify-between gap-3">
              <span className="text-neutral-500">رقم الفاتورة</span>
              <span className="max-w-[176px] break-all text-left font-black">{sale.id}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-neutral-500">توقيت القاهرة</span>
              <span className="font-black">{formatCairoDateTime(sale.createdAt)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-neutral-500">العميل</span>
              <span className="font-black">{getCustomerName(sale)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-neutral-500">البائع</span>
              <span className="font-black">{sale.seller?.fullName || sale.seller?.username || "-"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-neutral-500">الدفع</span>
              <span className="font-black">{sale.paymentMethod === "TRANSFER" ? "تحويل" : "نقدي"}</span>
            </div>
            {sale.paymentMethod === "TRANSFER" && sale.paymentDescription ? (
              <div className="flex items-start justify-between gap-3">
                <span className="shrink-0 text-neutral-500">التحويل</span>
                <span className="max-w-[176px] break-all text-left font-black">{sale.paymentDescription}</span>
              </div>
            ) : null}
          </section>

          <section className="px-4 py-4">
            <div className="mb-3 border-b border-dashed border-neutral-300 pb-2 text-center text-[12px] font-black uppercase tracking-[0.12em]">
              المنتجات
            </div>
            <div className="space-y-3">
              {sale.items.map((item: any, index: number) => (
                <div key={item.id ?? index} className="border-b border-dashed border-neutral-200 pb-3 text-[12px] last:border-b-0">
                  <div className="font-black leading-5">{itemTitle(item) || "منتج"}</div>
                  <div className="mt-2 space-y-1 text-neutral-600">
                    <div className="flex items-center justify-between">
                      <span>الكمية</span>
                      <span>{getItemQty(item)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>الوحدة</span>
                      <span>{money(getItemPrice(item))} EGP</span>
                    </div>
                    <div className="flex items-center justify-between font-black text-black">
                      <span>السطر</span>
                      <span>{money(getItemTotal(item))} EGP</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="border-t border-neutral-200 px-4 py-4 text-[12px]">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-neutral-600">إجمالي المنتجات</span>
                <span className="font-black">{money(itemsSubtotal)} EGP</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-600">الخصم</span>
                <span className="font-black">{money(discount)} EGP</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-600">إجمالي المرتجعات</span>
                <span className="font-black">{money(totalReturnedAmount)} EGP</span>
              </div>
              <div className="mt-3 border-t border-dashed border-neutral-300 pt-3">
                <div className="flex items-center justify-between text-base font-black">
                  <span>الإجمالي النهائي</span>
                  <span>{money(finalTotal)} EGP</span>
                </div>
              </div>
            </div>
          </section>

          {hasReturns ? (
            <section className="border-t border-neutral-200 px-4 py-4">
              <div className="mb-3 text-center text-[12px] font-black uppercase tracking-[0.12em]">
                المرتجعات / الاستبدالات
              </div>
              <div className="space-y-3">
                {sale.returns.map((ret: any) => (
                  <div key={ret.id} className="border border-neutral-200 bg-neutral-50 p-3 text-[12px]">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-black">{ret.type === "EXCHANGE" ? "استبدال" : "استرداد"}</span>
                      <span className="text-[10px] text-neutral-500">{formatCairoDateTime(ret.createdAt)}</span>
                    </div>
                    <div className="flex items-center justify-between text-neutral-600">
                      <span>استرداد</span>
                      <span>{money(ret.refundAmount || 0)} EGP</span>
                    </div>
                    <div className="flex items-center justify-between text-neutral-600">
                      <span>فرق</span>
                      <span>{money(ret.extraAmount || 0)} EGP</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="border-t border-neutral-200 bg-neutral-950 px-4 py-3 text-center text-[11px] font-bold leading-5 text-white">
            آخر موعد للمرتجع: <span className="font-black">{formatCairoDate(returnLastDate)}</span>
          </section>

          <footer className="border-t border-neutral-200 px-4 py-4 text-center text-[11px] leading-5 text-neutral-500">
            شكرًا لتسوقك من SMSM.
            <br />
            احتفظ بهذه الفاتورة حتى آخر موعد للمرتجع.
          </footer>
        </article>
      </div>
    </CommandShell>
  );
}
