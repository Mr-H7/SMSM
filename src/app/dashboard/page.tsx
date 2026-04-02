import Link from "next/link";
import { prisma } from "@/lib/prisma";
import * as rbac from "@/lib/rbac";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

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

async function logoutAction() {
  "use server";

  const cookieStore = await cookies();
  cookieStore.set("smsm_session", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });

  redirect("/login");
}

function formatEGP(value: number) {
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const today = startOfToday();

  const [productsCount, lowStockCount, todaySales, todayReturns, usersCount, invoicesCount] =
    await Promise.all([
      prisma.productVariant.count(),
      prisma.productVariant.count({
        where: {
          stockQty: {
            lte: 7,
          },
        },
      }),
      prisma.sale.findMany({
        where: {
          createdAt: {
            gte: today,
          },
        },
      }),
      prisma.saleReturn.findMany({
        where: {
          createdAt: {
            gte: today,
          },
        },
      }),
      prisma.user.count(),
      prisma.sale.count(),
    ]);

  const todaySalesValue = todaySales.reduce((sum, sale) => sum + (sale.total || 0), 0);
  const todayDiscounts = todaySales.reduce((sum, sale) => sum + (sale.discount || 0), 0);
  const todayReturnsValue = todayReturns.reduce((sum, r) => sum + (r.refundAmount || 0), 0);

  const role = String(user.role ?? user.userRole ?? "").toUpperCase();
  const isOwner = role === "OWNER";

  return (
    <main dir="rtl" className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="mb-8 rounded-[28px] border border-red-500/20 bg-gradient-to-b from-red-950/20 to-white/[0.02] p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-3">
              <Link
                href="/sales/new"
                className="inline-flex h-12 items-center rounded-2xl bg-red-600 px-5 text-sm font-extrabold transition hover:bg-red-500"
              >
                بيع جديد
              </Link>
              <Link
                href="/products"
                className="inline-flex h-12 items-center rounded-2xl border border-white/10 bg-white/5 px-5 text-sm font-bold transition hover:bg-white/10"
              >
                المنتجات
              </Link>
              <Link
                href="/invoices"
                className="inline-flex h-12 items-center rounded-2xl border border-white/10 bg-white/5 px-5 text-sm font-bold transition hover:bg-white/10"
              >
                الفواتير
              </Link>
              <Link
                href="/returns"
                className="inline-flex h-12 items-center rounded-2xl border border-white/10 bg-white/5 px-5 text-sm font-bold transition hover:bg-white/10"
              >
                المرتجعات
              </Link>
              {isOwner ? (
                <>
                  <Link
                    href="/targets"
                    className="inline-flex h-12 items-center rounded-2xl border border-white/10 bg-white/5 px-5 text-sm font-bold transition hover:bg-white/10"
                  >
                    الأهداف
                  </Link>
                  <Link
                    href="/users"
                    className="inline-flex h-12 items-center rounded-2xl border border-white/10 bg-white/5 px-5 text-sm font-bold transition hover:bg-white/10"
                  >
                    المستخدمون
                  </Link>
                </>
              ) : null}

              <form action={logoutAction}>
                <button className="inline-flex h-12 items-center rounded-2xl border border-red-500/30 bg-red-600/15 px-5 text-sm font-extrabold text-red-200 transition hover:bg-red-600/25">
                  تسجيل الخروج
                </button>
              </form>
            </div>

            <div className="text-right">
              <h1 className="text-4xl font-black tracking-tight">لوحة تحكم SMSM</h1>
              <p className="mt-2 text-sm text-white/60">
                نظام إدارة محل الأحذية — واجهة تشغيل تجارية عربية منظمة
              </p>
              <div className="mt-3 inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold">
                {user.username} · {role}
              </div>
            </div>
          </div>
        </section>

        <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-white/60">مبيعات اليوم</div>
            <div className="mt-3 text-3xl font-black">{todaySales.length}</div>
            <div className="mt-2 text-sm text-white/50">عدد الفواتير اليوم</div>
          </div>

          <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-5">
            <div className="text-sm text-red-100/80">نفد المخزون</div>
            <div className="mt-3 text-3xl font-black text-red-300">
              {await prisma.productVariant.count({ where: { stockQty: 0 } })}
            </div>
            <div className="mt-2 text-sm text-red-100/60">يحتاج إعادة تخزين</div>
          </div>

          <div className="rounded-3xl border border-yellow-500/20 bg-yellow-500/10 p-5">
            <div className="text-sm text-yellow-100/80">مخزون منخفض</div>
            <div className="mt-3 text-3xl font-black text-yellow-300">{lowStockCount}</div>
            <div className="mt-2 text-sm text-yellow-100/60">من 1 إلى 7</div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-white/60">إجمالي المنتجات</div>
            <div className="mt-3 text-3xl font-black">{productsCount}</div>
            <div className="mt-2 text-sm text-white/50">عدد النسخ الموجودة في النظام</div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-3">
          <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
            <h2 className="mb-5 text-2xl font-extrabold">ملخص التشغيل</h2>

            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 py-4">
                <span className="text-white/70">إجمالي الفواتير</span>
                <span className="text-xl font-black">{invoicesCount}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 py-4">
                <span className="text-white/70">مرتجعات مسجلة</span>
                <span className="text-xl font-black">{await prisma.saleReturn.count()}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 py-4">
                <span className="text-white/70">عدد المستخدمين</span>
                <span className="text-xl font-black">{usersCount}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 py-4">
                <span className="text-white/70">فواتير اليوم</span>
                <span className="text-xl font-black">{todaySales.length}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 py-4">
                <span className="text-white/70">مرتجعات اليوم</span>
                <span className="text-xl font-black">{todayReturns.length}</span>
              </div>
            </div>
          </section>

          <section className="xl:col-span-2 space-y-6">
            <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
              <h2 className="mb-5 text-2xl font-extrabold">ملخص اليوم</h2>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
                  <div className="text-sm text-white/60">إجمالي مبيعات اليوم</div>
                  <div className="mt-3 text-3xl font-black">{formatEGP(todaySalesValue)}</div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
                  <div className="text-sm text-white/60">خصومات اليوم</div>
                  <div className="mt-3 text-3xl font-black">{formatEGP(todayDiscounts)}</div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
                  <div className="text-sm text-white/60">مرتجعات اليوم</div>
                  <div className="mt-3 text-3xl font-black">{formatEGP(todayReturnsValue)}</div>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
              <h2 className="mb-5 text-2xl font-extrabold">الوصول السريع</h2>

              <div className="grid gap-4 md:grid-cols-2">
                <Link
                  href="/products"
                  className="rounded-2xl border border-white/10 bg-black/30 p-5 transition hover:border-red-500/40 hover:bg-white/[0.04]"
                >
                  <div className="text-lg font-extrabold">المنتجات والمخزون</div>
                  <div className="mt-2 text-sm text-white/55">
                    عرض المنتجات وإعادة التخزين والمتابعة.
                  </div>
                </Link>

                <Link
                  href="/sales/new"
                  className="rounded-2xl border border-white/10 bg-black/30 p-5 transition hover:border-red-500/40 hover:bg-white/[0.04]"
                >
                  <div className="text-lg font-extrabold">إنشاء فاتورة جديدة</div>
                  <div className="mt-2 text-sm text-white/55">
                    ابدأ عملية بيع جديدة بسرعة.
                  </div>
                </Link>

                <Link
                  href="/returns"
                  className="rounded-2xl border border-white/10 bg-black/30 p-5 transition hover:border-red-500/40 hover:bg-white/[0.04]"
                >
                  <div className="text-lg font-extrabold">المرتجعات والاستبدال</div>
                  <div className="mt-2 text-sm text-white/55">
                    استرجاع أو استبدال وربط بالفواتير.
                  </div>
                </Link>

                <Link
                  href="/invoices"
                  className="rounded-2xl border border-white/10 bg-black/30 p-5 transition hover:border-red-500/40 hover:bg-white/[0.04]"
                >
                  <div className="text-lg font-extrabold">عرض الفواتير</div>
                  <div className="mt-2 text-sm text-white/55">
                    تفاصيل الفواتير والطباعة والمتابعة.
                  </div>
                </Link>

                {isOwner ? (
                  <>
                    <Link
                      href="/targets"
                      className="rounded-2xl border border-white/10 bg-black/30 p-5 transition hover:border-red-500/40 hover:bg-white/[0.04]"
                    >
                      <div className="text-lg font-extrabold">الأهداف</div>
                      <div className="mt-2 text-sm text-white/55">
                        إدارة هدف اليوم والشهر والبائعين.
                      </div>
                    </Link>

                    <Link
                      href="/users"
                      className="rounded-2xl border border-white/10 bg-black/30 p-5 transition hover:border-red-500/40 hover:bg-white/[0.04]"
                    >
                      <div className="text-lg font-extrabold">المستخدمون</div>
                      <div className="mt-2 text-sm text-white/55">
                        إنشاء وإدارة الحسابات والصلاحيات.
                      </div>
                    </Link>
                  </>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}