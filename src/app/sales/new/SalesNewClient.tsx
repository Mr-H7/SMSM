"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSale } from "./actions";

type VariantRow = {
  id: string;
  sellPrice: number;
  stockQty: number;
  grade: "ORIGINAL" | "MIRROR" | "EGYPTIAN";
  sku: string | null;
  size: string | null;
  color: string | null;
  model: { name: string; brand: string | null };
};

type CartItem = {
  variantId: string;
  qty: number;
};

export default function SalesNewClient({
  variants,
}: {
  variants: VariantRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [customer, setCustomer] = useState("");
  const [discount, setDiscount] = useState<number>(0);

  const [query, setQuery] = useState("");
  const [exactPrice, setExactPrice] = useState<string>("");
  const [grade, setGrade] = useState<"" | VariantRow["grade"]>("");

  const [cart, setCart] = useState<CartItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const p = exactPrice.trim();

    return variants.filter((v) => {
      if (grade && v.grade !== grade) return false;

      if (p) {
        const pn = Number(p);
        if (!Number.isFinite(pn)) return false;
        if (v.sellPrice !== Math.trunc(pn)) return false;
      }

      if (!q) return true;

      const name = `${v.model.brand ?? ""} ${v.model.name}`.toLowerCase();
      const sku = (v.sku ?? "").toLowerCase();
      const color = (v.color ?? "").toLowerCase();
      const size = (v.size ?? "").toLowerCase();

      return (
        name.includes(q) ||
        sku.includes(q) ||
        color.includes(q) ||
        size.includes(q)
      );
    });
  }, [variants, query, exactPrice, grade]);

  const cartMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of cart) m.set(it.variantId, it.qty);
    return m;
  }, [cart]);

  const subtotal = useMemo(() => {
    let sum = 0;
    for (const it of cart) {
      const v = variants.find((x) => x.id === it.variantId);
      if (!v) continue;
      sum += it.qty * v.sellPrice;
    }
    return sum;
  }, [cart, variants]);

  const total = Math.max(0, subtotal - Math.max(0, Math.trunc(discount || 0)));

  function setQty(variantId: string, qty: number) {
    setError(null);

    const variant = variants.find((v) => v.id === variantId);
    if (!variant) return;

    const q = Math.max(0, Math.trunc(qty || 0));
    const safeQty = Math.min(q, Math.max(0, variant.stockQty));

    setCart((prev) => {
      const next = prev.filter((x) => x.variantId !== variantId);
      if (safeQty > 0) next.push({ variantId, qty: safeQty });
      return next;
    });
  }

  function addOne(variantId: string) {
    const current = cartMap.get(variantId) ?? 0;
    setQty(variantId, current + 1);
  }

  function clearCart() {
    setCart([]);
    setError(null);
  }

  function submit() {
    setError(null);

    if (cart.length === 0) {
      setError("السلة فاضية");
      return;
    }

    const fd = new FormData();
    fd.set("customer", customer);
    fd.set("discount", String(discount || 0));
    fd.set("itemsJson", JSON.stringify(cart));

    startTransition(async () => {
      try {
        const res = await createSale(fd);
        if (res?.ok) {
          router.push(`/invoices/${res.saleId}`);
        } else {
          setError("حصل خطأ غير متوقع");
        }
      } catch (e: any) {
        setError(e?.message ?? "حصل خطأ أثناء تنفيذ البيع");
      }
    });
  }

  return (
    <div className="min-h-screen bg-black text-white" dir="rtl">
      <div className="mx-auto w-full max-w-7xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">بيع جديد (POS)</h1>
            <p className="mt-1 text-sm text-white/60">
              اختر الفاريانت ثم أضف الكمية ونفّذ البيع
            </p>
          </div>

          <a
            href="/dashboard"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
          >
            رجوع
          </a>
        </div>

        <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-6">
              <label className="mb-1 block text-sm text-white/70">
                بحث (اسم / براند / SKU / لون / مقاس)
              </label>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
              />
            </div>

            <div className="md:col-span-3">
              <label className="mb-1 block text-sm text-white/70">السعر (Exact)</label>
              <input
                value={exactPrice}
                onChange={(e) => setExactPrice(e.target.value)}
                placeholder="مثال: 600"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
              />
            </div>

            <div className="md:col-span-3">
              <label className="mb-1 block text-sm text-white/70">Grade</label>
              <select
                value={grade}
                onChange={(e) => setGrade(e.target.value as any)}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
              >
                <option value="">الكل</option>
                <option value="ORIGINAL">ORIGINAL</option>
                <option value="MIRROR">MIRROR</option>
                <option value="EGYPTIAN">EGYPTIAN</option>
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 overflow-x-auto">
          <table className="w-full min-w-[1150px] border-collapse text-right text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/70">
                <th className="py-3">المنتج</th>
                <th className="py-3">الدرجة</th>
                <th className="py-3">المقاس</th>
                <th className="py-3">اللون</th>
                <th className="py-3">SKU</th>
                <th className="py-3">السعر</th>
                <th className="py-3">المخزون</th>
                <th className="py-3">الكمية</th>
                <th className="py-3">إضافة</th>
              </tr>
            </thead>

            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-white/50">
                    لا توجد نتائج
                  </td>
                </tr>
              ) : (
                filtered.map((v) => {
                  const name = v.model.brand ? `${v.model.brand} ${v.model.name}` : v.model.name;
                  const qty = cartMap.get(v.id) ?? 0;

                  return (
                    <tr key={v.id} className="border-b border-white/5">
                      <td className="py-4 font-semibold">{name}</td>
                      <td className="py-4">{v.grade}</td>
                      <td className="py-4">{v.size ?? "-"}</td>
                      <td className="py-4">{v.color ?? "-"}</td>
                      <td className="py-4">{v.sku ?? "-"}</td>
                      <td className="py-4 font-bold text-red-400">{v.sellPrice}</td>
                      <td className="py-4">{v.stockQty}</td>
                      <td className="py-4">
                        <input
                          type="number"
                          value={qty}
                          min={0}
                          max={v.stockQty}
                          onChange={(e) => setQty(v.id, Number(e.target.value))}
                          className="w-24 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-red-500"
                        />
                      </td>
                      <td className="py-4">
                        <button
                          type="button"
                          onClick={() => addOne(v.id)}
                          disabled={v.stockQty <= 0}
                          className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold hover:bg-red-500 disabled:opacity-50"
                        >
                          +1
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-12">
          <div className="md:col-span-7 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="grid gap-3 md:grid-cols-12">
              <div className="md:col-span-6">
                <label className="mb-1 block text-sm text-white/70">اسم العميل (اختياري)</label>
                <input
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
                />
              </div>

              <div className="md:col-span-6">
                <label className="mb-1 block text-sm text-white/70">الخصم</label>
                <input
                  type="number"
                  value={discount}
                  onChange={(e) => setDiscount(Number(e.target.value))}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
                />
              </div>

              {error && (
                <div className="md:col-span-12 rounded-xl border border-red-500/30 bg-red-600/10 p-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              <div className="md:col-span-12 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={submit}
                  disabled={isPending}
                  className="rounded-xl bg-red-600 px-6 py-3 text-sm font-bold hover:bg-red-500 disabled:opacity-50"
                >
                  {isPending ? "جاري التنفيذ..." : "تنفيذ البيع"}
                </button>

                <button
                  type="button"
                  onClick={clearCart}
                  disabled={isPending}
                  className="rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm hover:bg-white/10 disabled:opacity-50"
                >
                  تفريغ السلة
                </button>
              </div>
            </div>
          </div>

          <div className="md:col-span-5 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-white/60">Subtotal</div>
            <div className="mt-1 text-2xl font-extrabold">{subtotal}</div>

            <div className="mt-3 text-sm text-white/60">Total</div>
            <div className="mt-1 text-3xl font-extrabold text-red-500">{total}</div>

            <div className="mt-3 text-xs text-white/40">
              (Profit/Cost not shown to sellers — server keeps cost snapshot only)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}