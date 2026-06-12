import Link from "next/link";
import CommandShell from "@/components/CommandShell";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";
import {
  createVariant,
  deleteVariant,
  restockVariant,
  toggleVariantActive,
  updateVariant,
} from "./serverActions";

export const dynamic = "force-dynamic";

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
      dot: "bg-[var(--primary)]",
      badge: "bg-[var(--primary)]/15 text-[var(--primary-soft)]",
    };
  }
  if (qty <= 2) {
    return {
      label: "حرج",
      dot: "bg-[var(--primary)]",
      badge: "bg-[var(--primary)]/15 text-[var(--primary-soft)]",
    };
  }
  if (qty <= 5) {
    return {
      label: "منخفض",
      dot: "bg-[#ffb4aa]",
      badge: "bg-[#ffb4aa]/12 text-[#ffb4aa]",
    };
  }
  return {
    label: "جيد",
    dot: "bg-[var(--tertiary)]",
    badge: "bg-[var(--tertiary)]/12 text-[var(--tertiary)]",
  };
}

function swatchText(value: string | null | undefined) {
  return (value || "PR").slice(0, 2).toUpperCase();
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; grade?: string; status?: string }>;
}) {
  const user = await requireUser();
  const role = String(user?.role ?? "").toUpperCase();
  const isOwner = role === "OWNER";

  const sp = await Promise.resolve(
    searchParams ?? Promise.resolve({} as { q?: string; grade?: string; status?: string })
  );
  const q = String(sp.q ?? "").trim().toLowerCase();
  const gradeFilter = String(sp.grade ?? "").trim().toUpperCase();
  const statusFilter = String(sp.status ?? "").trim().toLowerCase();

  const variants = await prisma.productVariant.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: { model: true },
  });

  const searchedRows = variants.filter((row) => {
    if (gradeFilter && row.grade !== gradeFilter) return false;
    if (statusFilter === "low" && row.stockQty > 5) return false;
    if (statusFilter === "out" && row.stockQty > 0) return false;
    if (statusFilter === "inactive" && row.isActive) return false;
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

  const totalVariants = searchedRows.length;
  const totalStock = searchedRows.reduce((sum, row) => sum + row.stockQty, 0);
  const inactiveCount = searchedRows.filter((row) => !row.isActive).length;
  const alertCount = searchedRows.filter((row) => row.stockQty <= 5).length;
  const prices = searchedRows.map((row) => row.sellPrice).filter((price) => Number.isFinite(price));
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;

  const gradeCounts = ["ORIGINAL", "MIRROR", "EGYPTIAN"].map((grade) => ({
    grade,
    count: variants.filter((row) => row.grade === grade).length,
  }));

  return (
    <CommandShell active="products" user={user}>
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="command-label">قيادة المخزون</div>
            <h1 className="mt-2 text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">
              مركز المنتجات
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-white/55">
              إدارة الموديلات والمقاسات والألوان والأسعار وحالة النشاط من بيانات SMSM الحقيقية.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard" className="command-secondary px-5 py-3 text-xs font-black uppercase tracking-[0.12em]">
              لوحة التحكم
            </Link>
            {isOwner ? (
              <a href="#new-product" className="command-primary px-5 py-3 text-xs font-black uppercase tracking-[0.12em]">
                إضافة منتج
              </a>
            ) : null}
          </div>
        </section>

        <form method="GET" className="command-panel-high grid gap-3 p-4 lg:grid-cols-12">
          <div className="lg:col-span-6">
            <label className="command-label mb-2 block">بحث</label>
            <input
              name="q"
              defaultValue={q}
              placeholder="منتج، ماركة، SKU، مقاس، لون..."
              className="command-input h-12 w-full px-4 text-sm placeholder:text-white/30"
            />
          </div>
          <div className="lg:col-span-3">
            <label className="command-label mb-2 block">التصنيف</label>
            <select name="grade" defaultValue={gradeFilter} className="command-input h-12 w-full px-4 text-sm">
              <option value="" className="bg-[#201f1f]">كل التصنيفات</option>
              <option value="ORIGINAL" className="bg-[#201f1f]">ORIGINAL</option>
              <option value="MIRROR" className="bg-[#201f1f]">MIRROR</option>
              <option value="EGYPTIAN" className="bg-[#201f1f]">EGYPTIAN</option>
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="command-label mb-2 block">الحالة</label>
            <select name="status" defaultValue={statusFilter} className="command-input h-12 w-full px-4 text-sm">
              <option value="" className="bg-[#201f1f]">الكل</option>
              <option value="low" className="bg-[#201f1f]">مخزون منخفض</option>
              <option value="out" className="bg-[#201f1f]">نفد المخزون</option>
              <option value="inactive" className="bg-[#201f1f]">غير نشط</option>
            </select>
          </div>
          <div className="flex items-end lg:col-span-1">
            <button className="command-primary h-12 w-full text-xs font-black uppercase tracking-[0.12em]">
              تصفية
            </button>
          </div>
        </form>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="command-card border-r-4 border-[var(--primary)] p-4">
            <div className="command-label">المتغيرات</div>
            <div className="mt-3 text-3xl font-black text-white">{totalVariants}</div>
            <div className="mt-2 text-xs text-white/45">المعروض بعد التصفية الحالية</div>
          </div>
          <div className="command-card border-r-4 border-[var(--tertiary)] p-4">
            <div className="command-label">إجمالي المخزون</div>
            <div className="mt-3 text-3xl font-black text-white">{totalStock}</div>
            <div className="mt-2 text-xs text-white/45">وحدات متاحة في النتائج المطابقة</div>
          </div>
          <div className="command-card border-r-4 border-[var(--primary)] p-4">
            <div className="command-label">تنبيهات المخزون</div>
            <div className="mt-3 text-3xl font-black text-white">{alertCount}</div>
            <div className="mt-2 text-xs text-white/45">صفوف عند 5 وحدات أو أقل</div>
          </div>
          <div className="command-card p-4">
            <div className="command-label">نطاق السعر</div>
            <div className="mt-3 text-xl font-black text-white">
              {formatEGP(minPrice)} - {formatEGP(maxPrice)}
            </div>
            <div className="mt-2 text-xs text-white/45">{inactiveCount} متغير غير نشط</div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {gradeCounts.map((item, index) => (
            <Link
              key={item.grade}
              href={`/products?grade=${item.grade}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={`command-panel p-4 transition hover:bg-white/[0.045] ${
                index === 0 ? "border-r-4 border-[var(--primary)]" : "border-r-4 border-[var(--surface-highest)]"
              }`}
            >
              <div className="command-label">تصفية التصنيف</div>
              <div className="mt-2 flex items-end justify-between gap-4">
                <div className="text-lg font-black text-white">{item.grade}</div>
                <div className="text-2xl font-black text-white">{item.count}</div>
              </div>
            </Link>
          ))}
        </section>

        {isOwner ? (
          <section id="new-product" className="command-panel-high p-5">
            <div className="mb-5">
              <div className="command-label">عملية المالك</div>
              <h2 className="mt-2 text-xl font-black uppercase tracking-tight text-white">
                إضافة متغير جديد
              </h2>
            </div>

            <form action={createVariant} className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <input name="modelName" placeholder="اسم الموديل" required className="command-input h-12 px-4 text-sm placeholder:text-white/30" />
              <input name="brand" placeholder="الماركة" className="command-input h-12 px-4 text-sm placeholder:text-white/30" />
              <select name="grade" defaultValue="MIRROR" className="command-input h-12 px-4 text-sm">
                <option value="ORIGINAL" className="bg-[#201f1f]">ORIGINAL</option>
                <option value="MIRROR" className="bg-[#201f1f]">MIRROR</option>
                <option value="EGYPTIAN" className="bg-[#201f1f]">EGYPTIAN</option>
              </select>
              <input name="sku" placeholder="SKU" className="command-input h-12 px-4 text-sm placeholder:text-white/30" />
              <input name="sellPrice" type="number" step="1" min="0" placeholder="سعر البيع" className="command-input h-12 px-4 text-sm placeholder:text-white/30" />
              <input name="costPrice" type="number" step="1" min="0" placeholder="سعر التكلفة" className="command-input h-12 px-4 text-sm placeholder:text-white/30" />
              <input name="stockQty" type="number" min="0" placeholder="كمية المخزون" className="command-input h-12 px-4 text-sm placeholder:text-white/30" />
              <input name="size" placeholder="المقاس" className="command-input h-12 px-4 text-sm placeholder:text-white/30" />
              <input name="color" placeholder="اللون" className="command-input h-12 px-4 text-sm placeholder:text-white/30" />
              <button className="command-primary h-12 text-xs font-black uppercase tracking-[0.12em]">حفظ المتغير</button>
            </form>
          </section>
        ) : null}

        <section className="command-panel overflow-hidden">
          <div className="flex flex-col gap-2 bg-[var(--surface-lowest)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="command-label">سجل المنتجات</div>
              <h2 className="mt-1 text-lg font-black uppercase tracking-tight text-white">مصفوفة المخزون</h2>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/42">
              عرض {searchedRows.length} من {variants.length} متغير
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="command-table min-w-[1280px] text-right text-sm">
              <thead>
                <tr>
                  <th>المنتج و SKU</th>
                  <th>التصنيف</th>
                  <th>سعر البيع</th>
                  {isOwner ? <th>التكلفة</th> : null}
                  <th>حالة المخزون</th>
                  <th>المقاس</th>
                  <th>اللون</th>
                  <th>الحالة</th>
                  {isOwner ? <th className="min-w-[460px]">تحكم المالك</th> : null}
                </tr>
              </thead>
              <tbody>
                {searchedRows.length === 0 ? (
                  <tr>
                    <td colSpan={isOwner ? 9 : 8} className="py-16 text-center text-white/42">
                      لا توجد منتجات مطابقة.
                    </td>
                  </tr>
                ) : (
                  searchedRows.map((row) => {
                    const alert = stockMeta(row.stockQty);
                    const productName = row.model.brand ? `${row.model.brand} ${row.model.name}` : row.model.name;

                    return (
                      <tr key={row.id} className={!row.isActive ? "opacity-60" : ""}>
                        <td>
                          <div className="flex items-center gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm bg-[var(--surface-highest)] text-xs font-black text-white">
                              {swatchText(row.model.brand || row.model.name)}
                            </div>
                            <div>
                              <div className="font-black text-white">{productName}</div>
                              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-white/42">
                                SKU: {row.sku || "-"}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="command-badge bg-white/[0.055] text-white/70">{row.grade}</span>
                        </td>
                        <td className="font-black text-white">{formatEGP(row.sellPrice)}</td>
                        {isOwner ? <td className="text-white/48">{formatEGP(row.costPrice)}</td> : null}
                        <td>
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${alert.dot}`} />
                            <span className="font-black text-white">{row.stockQty} في المخزون</span>
                            <span className={`command-badge ${alert.badge}`}>{alert.label}</span>
                          </div>
                        </td>
                        <td className="text-white/65">{row.size || "-"}</td>
                        <td className="text-white/65">{row.color || "-"}</td>
                        <td>
                          <span className={`command-badge ${row.isActive ? "bg-[var(--tertiary)]/12 text-[var(--tertiary)]" : "bg-white/[0.055] text-white/50"}`}>
                            {row.isActive ? "نشط" : "غير نشط"}
                          </span>
                        </td>

                        {isOwner ? (
                          <td>
                            <div className="grid gap-3">
                              <form action={updateVariant} className="grid gap-2 bg-black/20 p-3 md:grid-cols-3">
                                <input type="hidden" name="variantId" value={row.id} />
                                <input name="modelName" defaultValue={row.model.name} placeholder="الموديل" className="command-input h-10 px-3 text-xs" />
                                <input name="brand" defaultValue={row.model.brand ?? ""} placeholder="الماركة" className="command-input h-10 px-3 text-xs" />
                                <select name="grade" defaultValue={row.grade} className="command-input h-10 px-3 text-xs">
                                  <option value="ORIGINAL" className="bg-[#201f1f]">ORIGINAL</option>
                                  <option value="MIRROR" className="bg-[#201f1f]">MIRROR</option>
                                  <option value="EGYPTIAN" className="bg-[#201f1f]">EGYPTIAN</option>
                                </select>
                                <input name="sku" defaultValue={row.sku ?? ""} placeholder="SKU" className="command-input h-10 px-3 text-xs" />
                                <input name="sellPrice" type="number" min="0" defaultValue={row.sellPrice} placeholder="بيع" className="command-input h-10 px-3 text-xs" />
                                <input name="costPrice" type="number" min="0" defaultValue={row.costPrice} placeholder="تكلفة" className="command-input h-10 px-3 text-xs" />
                                <input name="size" defaultValue={row.size ?? ""} placeholder="المقاس" className="command-input h-10 px-3 text-xs" />
                                <input name="color" defaultValue={row.color ?? ""} placeholder="اللون" className="command-input h-10 px-3 text-xs" />
                                <button className="command-primary h-10 text-[10px] font-black uppercase tracking-[0.1em]">تحديث</button>
                              </form>

                              <div className="flex flex-wrap gap-2">
                                <form action={restockVariant} className="flex gap-2">
                                  <input type="hidden" name="id" value={row.id} />
                                  <input name="qty" type="number" min="1" placeholder="الكمية" className="command-input h-10 w-24 px-3 text-xs placeholder:text-white/30" />
                                  <button className="command-secondary h-10 px-4 text-[10px] font-black uppercase tracking-[0.1em]">إضافة مخزون</button>
                                </form>
                                <form action={toggleVariantActive}>
                                  <input type="hidden" name="id" value={row.id} />
                                  <input type="hidden" name="next" value={row.isActive ? "0" : "1"} />
                                  <button className="command-secondary h-10 px-4 text-[10px] font-black uppercase tracking-[0.1em]">
                                    {row.isActive ? "إيقاف" : "تنشيط"}
                                  </button>
                                </form>
                                <form action={deleteVariant}>
                                  <input type="hidden" name="id" value={row.id} />
                                  <button className="h-10 rounded-sm bg-[var(--primary)]/15 px-4 text-[10px] font-black uppercase tracking-[0.1em] text-[var(--primary-soft)] transition hover:bg-[var(--primary)]/25">
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
    </CommandShell>
  );
}
