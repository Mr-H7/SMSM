import { prisma } from "@/lib/prisma";
import * as rbac from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import Link from "next/link";

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
  return null;
}

async function assertOwner() {
  const requireOwner = (rbac as any).requireOwner;
  if (typeof requireOwner === "function") {
    await requireOwner();
    return;
  }

  const user = await getCurrentUser();
  const role = String(user?.role ?? "").toUpperCase();
  if (role !== "OWNER") throw new Error("غير مصرح");
}

function formatEGP(value: number) {
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function stockMeta(qty: number) {
  if (qty <= 0) {
    return {
      label: "نفد",
      cls: "bg-red-600/20 text-red-300 border-red-500/40",
    };
  }
  if (qty <= 2) {
    return {
      label: "حرج",
      cls: "bg-orange-500/20 text-orange-200 border-orange-400/40",
    };
  }
  if (qty <= 5) {
    return {
      label: "منخفض",
      cls: "bg-yellow-500/20 text-yellow-200 border-yellow-400/40",
    };
  }
  return {
    label: "جيد",
    cls: "bg-emerald-500/20 text-emerald-200 border-emerald-400/40",
  };
}

async function addVariantAction(formData: FormData) {
  "use server";

  await assertOwner();

  const modelName = String(formData.get("modelName") ?? "").trim();
  const brand = String(formData.get("brand") ?? "").trim();
  const grade = String(formData.get("grade") ?? "MIRROR").trim() as
    | "ORIGINAL"
    | "MIRROR"
    | "EGYPTIAN";
  const sellPrice = Number(formData.get("sellPrice") ?? 0);
  const costPrice = Number(formData.get("costPrice") ?? 0);
  const stockQty = Number(formData.get("stockQty") ?? 0);
  const size = String(formData.get("size") ?? "").trim() || null;
  const sku = String(formData.get("sku") ?? "").trim() || null;
  const color = String(formData.get("color") ?? "").trim() || null;
  const isActive = String(formData.get("isActive") ?? "on") === "on";

  if (!modelName) return;

  let model = await prisma.productModel.findFirst({
    where: {
      name: modelName,
      brand: brand || null,
    },
  });

  if (!model) {
    model = await prisma.productModel.create({
      data: {
        name: modelName,
        brand: brand || null,
      },
    });
  }

  await prisma.productVariant.create({
    data: {
      modelId: model.id,
      grade,
      size,
      color,
      sku,
      sellPrice: Math.max(0, Math.trunc(sellPrice)),
      costPrice: Math.max(0, Math.trunc(costPrice)),
      stockQty: Math.max(0, Math.trunc(stockQty)),
      isActive,
    },
  });

  revalidatePath("/products");
}

async function restockAction(formData: FormData) {
  "use server";

  await assertOwner();

  const variantId = String(formData.get("variantId") ?? "");
  const qty = Math.max(0, Math.trunc(Number(formData.get("restockQty") ?? 0)));

  if (!variantId || qty <= 0) return;

  await prisma.productVariant.update({
    where: { id: variantId },
    data: {
      stockQty: {
        increment: qty,
      },
    },
  });

  revalidatePath("/products");
}

async function toggleActiveAction(formData: FormData) {
  "use server";

  await assertOwner();

  const variantId = String(formData.get("variantId") ?? "");
  const nextActive = String(formData.get("nextActive") ?? "false") === "true";

  if (!variantId) return;

  await prisma.productVariant.update({
    where: { id: variantId },
    data: {
      isActive: nextActive,
    },
  });

  revalidatePath("/products");
}

async function deleteVariantAction(formData: FormData) {
  "use server";

  await assertOwner();

  const variantId = String(formData.get("variantId") ?? "");
  if (!variantId) return;

  await prisma.productVariant.update({
    where: { id: variantId },
    data: {
      isActive: false,
      stockQty: 0,
    },
  });

  revalidatePath("/products");
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const user = await getCurrentUser();
  const role = String(user?.role ?? "").toUpperCase();
  const isOwner = role === "OWNER";

  const sp = await Promise.resolve(
    searchParams ?? Promise.resolve({} as { q?: string }),
  );
  const q = String(sp.q ?? "").trim().toLowerCase();

  const variants = await prisma.productVariant.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: {
      model: true,
    },
  });

  const rows = variants.filter((row) => {
    if (!q) return true;
    return [
      row.model.name,
      row.model.brand ?? "",
      row.grade,
      row.size ?? "",
      row.color ?? "",
      row.sku ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const totalVariants = rows.length;
  const totalStock = rows.reduce((sum, row) => sum + row.stockQty, 0);
  const inactiveCount = rows.filter((row) => !row.isActive).length;
  const alertCount = rows.filter((row) => row.stockQty <= 5).length;

  return (
    <main dir="rtl" className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6">
          <Link
            href="/dashboard"
            className="inline-flex h-11 items-center rounded-2xl border border-white/10 bg-white/5 px-5 text-sm font-bold text-white transition hover:bg-white/10"
          >
            رجوع
          </Link>
        </div>

        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">المنتجات والمخزون</h1>
            <p className="mt-2 text-sm text-white/60">
              متابعة كاملة لكل الفاريانتات وحالة المخزون والحركة التشغيلية.
            </p>
          </div>

          <form method="GET" className="w-full max-w-xl">
            <div className="flex gap-3">
              <input
                name="q"
                defaultValue={q}
                placeholder="ابحث بالموديل أو البراند أو المقاس أو SKU"
                className="h-12 flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm outline-none placeholder:text-white/35 focus:border-red-500/60"
              />
              <button className="h-12 rounded-2xl bg-red-600 px-6 text-sm font-bold transition hover:bg-red-500">
                بحث
              </button>
            </div>
          </form>
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <div className="text-sm text-white/60">إجمالي الفاريانتات</div>
            <div className="mt-3 text-3xl font-black">{totalVariants}</div>
          </div>
          <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-5">
            <div className="text-sm text-emerald-100/80">إجمالي القطع بالمخزون</div>
            <div className="mt-3 text-3xl font-black text-emerald-300">{totalStock}</div>
          </div>
          <div className="rounded-3xl border border-yellow-500/20 bg-yellow-500/10 p-5">
            <div className="text-sm text-yellow-100/80">تنبيهات المخزون</div>
            <div className="mt-3 text-3xl font-black text-yellow-300">{alertCount}</div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <div className="text-sm text-white/60">غير النشط</div>
            <div className="mt-3 text-3xl font-black">{inactiveCount}</div>
          </div>
        </div>

        {isOwner ? (
          <section className="mb-8 rounded-[28px] border border-red-500/20 bg-gradient-to-b from-red-950/30 to-white/[0.03] p-5">
            <div className="mb-5">
              <h2 className="text-xl font-extrabold">إضافة فاريانت جديد</h2>
              <p className="mt-1 text-sm text-white/55">
                أدخل القطعة الجديدة. اللون اختياري للتنظيم والعرض.
              </p>
            </div>

            <form action={addVariantAction} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <input
                name="modelName"
                placeholder="اسم الموديل"
                required
                className="h-12 rounded-2xl border border-white/10 bg-black/40 px-4 outline-none placeholder:text-white/35 focus:border-red-500/60"
              />
              <input
                name="brand"
                placeholder="البراند"
                className="h-12 rounded-2xl border border-white/10 bg-black/40 px-4 outline-none placeholder:text-white/35 focus:border-red-500/60"
              />
              <select
                name="grade"
                defaultValue="MIRROR"
                className="h-12 rounded-2xl border border-white/10 bg-black/40 px-4 outline-none focus:border-red-500/60"
              >
                <option value="ORIGINAL" className="bg-black">ORIGINAL</option>
                <option value="MIRROR" className="bg-black">MIRROR</option>
                <option value="EGYPTIAN" className="bg-black">EGYPTIAN</option>
              </select>
              <input
                name="sku"
                placeholder="SKU / كود"
                className="h-12 rounded-2xl border border-white/10 bg-black/40 px-4 outline-none placeholder:text-white/35 focus:border-red-500/60"
              />
              <input
                name="sellPrice"
                type="number"
                step="1"
                min="0"
                placeholder="سعر البيع"
                className="h-12 rounded-2xl border border-white/10 bg-black/40 px-4 outline-none placeholder:text-white/35 focus:border-red-500/60"
              />
              <input
                name="costPrice"
                type="number"
                step="1"
                min="0"
                placeholder="سعر التكلفة"
                className="h-12 rounded-2xl border border-white/10 bg-black/40 px-4 outline-none placeholder:text-white/35 focus:border-red-500/60"
              />
              <input
                name="stockQty"
                type="number"
                min="0"
                placeholder="الكمية"
                className="h-12 rounded-2xl border border-white/10 bg-black/40 px-4 outline-none placeholder:text-white/35 focus:border-red-500/60"
              />
              <input
                name="size"
                placeholder="المقاس"
                className="h-12 rounded-2xl border border-white/10 bg-black/40 px-4 outline-none placeholder:text-white/35 focus:border-red-500/60"
              />
              <input
                name="color"
                placeholder="اللون (اختياري)"
                className="h-12 rounded-2xl border border-white/10 bg-black/40 px-4 outline-none placeholder:text-white/35 focus:border-red-500/60"
              />

              <label className="flex h-12 items-center justify-between rounded-2xl border border-white/10 bg-black/40 px-4 text-sm">
                <span>تفعيل القطعة</span>
                <input
                  name="isActive"
                  type="checkbox"
                  defaultChecked
                  className="h-4 w-4 accent-red-600"
                />
              </label>

              <div className="md:col-span-2 xl:col-span-2">
                <button className="h-12 w-full rounded-2xl bg-red-600 text-sm font-extrabold transition hover:bg-red-500">
                  حفظ القطعة
                </button>
              </div>
            </form>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03]">
          <div className="border-b border-white/10 px-5 py-4">
            <h2 className="text-lg font-extrabold">قائمة القطعة</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[1350px] w-full text-right">
              <thead className="bg-white/[0.03] text-sm text-white/70">
                <tr>
                  <th className="px-4 py-4">الموديل</th>
                  <th className="px-4 py-4">البراند</th>
                  <th className="px-4 py-4">الدرجة</th>
                  <th className="px-4 py-4">البيع</th>
                  <th className="px-4 py-4">التكلفة</th>
                  <th className="px-4 py-4">المخزون</th>
                  <th className="px-4 py-4">المقاس</th>
                  <th className="px-4 py-4">اللون</th>
                  <th className="px-4 py-4">SKU</th>
                  <th className="px-4 py-4">الحالة</th>
                  <th className="px-4 py-4">التنبيه</th>
                  {isOwner ? <th className="px-4 py-4">إجراءات</th> : null}
                </tr>
              </thead>

              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={isOwner ? 12 : 11}
                      className="px-4 py-16 text-center text-sm text-white/45"
                    >
                      لا توجد منتجات مطابقة.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const alert = stockMeta(row.stockQty);

                    return (
                      <tr key={row.id} className="border-t border-white/10 align-top">
                        <td className="px-4 py-4 font-bold">{row.model.name}</td>
                        <td className="px-4 py-4 text-white/80">{row.model.brand ?? "-"}</td>
                        <td className="px-4 py-4">
                          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold">
                            {row.grade}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-white/90">{formatEGP(row.sellPrice)}</td>
                        <td className="px-4 py-4 text-white/60">{formatEGP(row.costPrice)}</td>
                        <td className="px-4 py-4 text-lg font-black">{row.stockQty}</td>
                        <td className="px-4 py-4 text-white/80">{row.size ?? "-"}</td>
                        <td className="px-4 py-4 text-white/80">{row.color ?? "-"}</td>
                        <td className="px-4 py-4 text-white/70">{row.sku ?? "-"}</td>
                        <td className="px-4 py-4">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-bold ${
                              row.isActive
                                ? "bg-emerald-500/20 text-emerald-200"
                                : "bg-white/10 text-white/70"
                            }`}
                          >
                            {row.isActive ? "نشط" : "غير نشط"}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${alert.cls}`}>
                            {alert.label}
                          </span>
                        </td>

                        {isOwner ? (
                          <td className="px-4 py-4">
                            <div className="flex min-w-[250px] flex-col gap-3">
                              <form action={restockAction} className="flex gap-2">
                                <input type="hidden" name="variantId" value={row.id} />
                                <input
                                  name="restockQty"
                                  type="number"
                                  min="1"
                                  placeholder="إضافة كمية"
                                  className="h-10 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 text-sm outline-none placeholder:text-white/35 focus:border-red-500/60"
                                />
                                <button className="h-10 rounded-xl bg-white/10 px-4 text-xs font-bold hover:bg-white/15">
                                  تزويد
                                </button>
                              </form>

                              <div className="flex flex-wrap gap-2">
                                <form action={toggleActiveAction}>
                                  <input type="hidden" name="variantId" value={row.id} />
                                  <input type="hidden" name="nextActive" value={String(!row.isActive)} />
                                  <button
                                    className={`h-10 rounded-xl px-4 text-xs font-bold ${
                                      row.isActive
                                        ? "bg-yellow-500/20 text-yellow-200 hover:bg-yellow-500/30"
                                        : "bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
                                    }`}
                                  >
                                    {row.isActive ? "إيقاف" : "تفعيل"}
                                  </button>
                                </form>

                                <form action={deleteVariantAction}>
                                  <input type="hidden" name="variantId" value={row.id} />
                                  <button className="h-10 rounded-xl bg-red-600/20 px-4 text-xs font-bold text-red-200 hover:bg-red-600/30">
                                    تعطيل
                                  </button>
                                </form>
                              </div>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}