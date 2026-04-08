import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import * as rbac from "@/lib/rbac";
import {
  formatCairoDate,
  formatCairoDateTime,
  getCairoDayRange,
  getShiftAutoCloseLabel,
} from "@/lib/cairo-time";

export const dynamic = "force-dynamic";

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

async function endShiftAction() {
  "use server";
  redirect("/dashboard");
}

function formatEGP(value: number) {
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

export default async function ShiftClosePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const range = getCairoDayRange();

  const [sales, returns] = await Promise.all([
    prisma.sale.findMany({
      where: {
        createdAt: {
          gte: range.start,
          lt: range.end,
        },
      },
      include: {
        seller: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.saleReturn.findMany({
      where: {
        createdAt: {
          gte: range.start,
          lt: range.end,
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const totalSales = sales.reduce((sum, sale) => sum + (sale.total || 0), 0);
  const totalDiscounts = sales.reduce((sum, sale) => sum + (sale.discount || 0), 0);
  const totalReturns = returns.reduce((sum, ret) => sum + (ret.refundAmount || 0), 0);

  const sellersMap = new Map<
    string,
    { name: string; invoices: number; total: number }
  >();

  for (const sale of sales) {
    const key = sale.sellerId;
    const name = sale.seller?.fullName || sale.seller?.username || "مستخدم";

    if (!sellersMap.has(key)) {
      sellersMap.set(key, {
        name,
        invoices: 0,
        total: 0,
      });
    }

    const current = sellersMap.get(key)!;
    current.invoices += 1;
    current.total += sale.total || 0;
  }

  const sellers = Array.from(sellersMap.values()).sort((a, b) => b.total - a.total);

  return (
    <main dir="rtl" className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/dashboard"
            className="inline-flex h-11 items-center rounded-2xl border border-white/10 bg-white/5 px-5 text-sm font-bold text-white transition hover:bg-white/10"
          >
            رجوع للداشبورد
          </Link>

          <div className="rounded-full border border-red-500/30 bg-red-600/10 px-4 py-2 text-sm font-bold text-red-200">
            الإغلاق اليومي الموصى به: {getShiftAutoCloseLabel()}
          </div>
        </div>

        <section className="mb-8 rounded-[28px] border border-red-500/20 bg-gradient-to-b from-red-950/20 to-white/[0.02] p-5">
          <h1 className="text-3xl font-black">إنهاء الشيفت</h1>
          <p className="mt-2 text-sm text-white/60">
            هذه الصفحة تعرض ملخص اليوم الحالي حسب توقيت القاهرة. إنهاء الشيفت هنا
            هو إغلاق تشغيلي ومراجعة نهائية لليوم.
          </p>
          <div className="mt-4 inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold">
            تاريخ اليوم: {formatCairoDate(new Date())}
          </div>
        </section>

        <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-white/60">عدد الفواتير اليوم</div>
            <div className="mt-3 text-3xl font-black">{sales.length}</div>
          </div>

          <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-5">
            <div className="text-sm text-emerald-100/80">إجمالي المبيعات</div>
            <div className="mt-3 text-3xl font-black text-emerald-300">
              {formatEGP(totalSales)}
            </div>
          </div>

          <div className="rounded-3xl border border-yellow-500/20 bg-yellow-500/10 p-5">
            <div className="text-sm text-yellow-100/80">إجمالي الخصومات</div>
            <div className="mt-3 text-3xl font-black text-yellow-300">
              {formatEGP(totalDiscounts)}
            </div>
          </div>

          <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-5">
            <div className="text-sm text-red-100/80">إجمالي المرتجعات</div>
            <div className="mt-3 text-3xl font-black text-red-300">
              {formatEGP(totalReturns)}
            </div>
          </div>
        </section>

        <section className="mb-8 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
          <h2 className="mb-5 text-2xl font-extrabold">حركة اليوم</h2>

          {sales.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-8 text-center text-white/60">
              لا توجد فواتير اليوم.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full text-right">
                <thead className="bg-white/[0.03] text-sm text-white/70">
                  <tr>
                    <th className="px-4 py-4">رقم الفاتورة</th>
                    <th className="px-4 py-4">الوقت</th>
                    <th className="px-4 py-4">العميل</th>
                    <th className="px-4 py-4">البائع</th>
                    <th className="px-4 py-4">الإجمالي</th>
                    <th className="px-4 py-4">الخصم</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.id} className="border-t border-white/10">
                      <td className="px-4 py-4 font-bold">{sale.id}</td>
                      <td className="px-4 py-4">{formatCairoDateTime(sale.createdAt)}</td>
                      <td className="px-4 py-4">{sale.customer || "عميل نقدي"}</td>
                      <td className="px-4 py-4">
                        {sale.seller?.fullName || sale.seller?.username || "-"}
                      </td>
                      <td className="px-4 py-4">{formatEGP(sale.total || 0)}</td>
                      <td className="px-4 py-4">{formatEGP(sale.discount || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mb-8 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
          <h2 className="mb-5 text-2xl font-extrabold">أداء البائعين اليوم</h2>

          {sellers.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-8 text-center text-white/60">
              لا توجد حركة بيع اليوم.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sellers.map((seller, idx) => (
                <div
                  key={`${seller.name}-${idx}`}
                  className="rounded-2xl border border-white/10 bg-black/30 p-5"
                >
                  <div className="text-lg font-extrabold">{seller.name}</div>
                  <div className="mt-3 text-sm text-white/60">
                    عدد الفواتير: <span className="font-black text-white">{seller.invoices}</span>
                  </div>
                  <div className="mt-2 text-sm text-white/60">
                    إجمالي البيع: <span className="font-black text-white">{formatEGP(seller.total)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-[28px] border border-red-500/20 bg-gradient-to-b from-red-950/20 to-white/[0.02] p-5">
          <h2 className="text-2xl font-extrabold">تأكيد إنهاء الشيفت</h2>
          <p className="mt-2 text-sm text-white/60">
            جميع بيانات البيع محفوظة بالفعل داخل النظام. هذا الإجراء هو إنهاء تشغيلي
            والرجوع إلى لوحة التحكم بعد مراجعة الملخص.
          </p>

          <form action={endShiftAction} className="mt-5">
            <button
              type="submit"
              className="rounded-2xl bg-red-600 px-6 py-3 text-sm font-extrabold text-white transition hover:bg-red-500"
            >
              إنهاء الشيفت الآن
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}