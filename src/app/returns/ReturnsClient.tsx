"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createReturn } from "./actions";

type ReturnMode = "REFUND" | "EXCHANGE";

type SaleItemVM = {
  id: string;
  qty: number;
  sellPrice: number;
  alreadyReturnedQty: number;
  remainingQty: number;
  variantId: string;
  variant: {
    grade: string;
    size: string | null;
    color: string | null;
    sku: string | null;
    model: {
      name: string;
      brand: string | null;
    };
  };
};

type ReplacementVariantVM = {
  id: string;
  sellPrice: number;
  stockQty: number;
  grade: string;
  size: string | null;
  color: string | null;
  sku: string | null;
  model: {
    name: string;
    brand: string | null;
  };
};

type SelectedSaleVM = {
  id: string;
  customer: string | null;
  discount: number;
  total: number;
  createdAtLabel: string;
  sellerName: string;
  items: SaleItemVM[];
};

type Props = {
  sale: SelectedSaleVM;
  replacementVariants: ReplacementVariantVM[];
};

export default function ReturnsClient({ sale, replacementVariants }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<ReturnMode>("REFUND");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [replacementQuery, setReplacementQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [returnedMap, setReturnedMap] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    for (const item of sale.items) seed[item.id] = 0;
    return seed;
  });

  const [replacementMap, setReplacementMap] = useState<Record<string, number>>({});

  const invoiceSubtotal = useMemo(() => {
    return sale.items.reduce((sum, item) => sum + item.qty * item.sellPrice, 0);
  }, [sale.items]);

  const normalizedReturnedItems = useMemo(() => {
    return sale.items
      .map((item) => {
        const qty = Math.max(0, Math.trunc(Number(returnedMap[item.id] ?? 0)));
        return {
          saleItemId: item.id,
          qty,
          sellPrice: item.sellPrice,
          name: item.variant.model.brand
            ? `${item.variant.model.brand} ${item.variant.model.name}`
            : item.variant.model.name,
        };
      })
      .filter((item) => item.qty > 0);
  }, [returnedMap, sale.items]);

  const normalizedReplacementItems = useMemo(() => {
    return replacementVariants
      .map((variant) => ({
        variantId: variant.id,
        qty: Math.max(0, Math.trunc(Number(replacementMap[variant.id] ?? 0))),
        sellPrice: variant.sellPrice,
        stockQty: variant.stockQty,
        name: variant.model.brand
          ? `${variant.model.brand} ${variant.model.name}`
          : variant.model.name,
      }))
      .filter((item) => item.qty > 0);
  }, [replacementMap, replacementVariants]);

  const returnedGross = useMemo(() => {
    return normalizedReturnedItems.reduce((sum, item) => sum + item.qty * item.sellPrice, 0);
  }, [normalizedReturnedItems]);

  const returnedDiscountShare = useMemo(() => {
    if (invoiceSubtotal <= 0) return 0;
    return Math.floor((returnedGross * Math.max(0, sale.discount || 0)) / invoiceSubtotal);
  }, [invoiceSubtotal, returnedGross, sale.discount]);

  const returnedValue = Math.max(0, returnedGross - returnedDiscountShare);

  const replacementValue = useMemo(() => {
    return normalizedReplacementItems.reduce((sum, item) => sum + item.qty * item.sellPrice, 0);
  }, [normalizedReplacementItems]);

  const refundAmount = Math.max(0, returnedValue - replacementValue);
  const extraAmount = Math.max(0, replacementValue - returnedValue);

  const filteredReplacementVariants = useMemo(() => {
    const q = replacementQuery.trim().toLowerCase();
    if (!q) return replacementVariants;

    return replacementVariants.filter((variant) => {
      const name = `${variant.model.brand ?? ""} ${variant.model.name}`.trim().toLowerCase();
      const sku = (variant.sku ?? "").toLowerCase();
      const grade = variant.grade.toLowerCase();
      const size = (variant.size ?? "").toLowerCase();
      const color = (variant.color ?? "").toLowerCase();

      return (
        name.includes(q) ||
        sku.includes(q) ||
        grade.includes(q) ||
        size.includes(q) ||
        color.includes(q)
      );
    });
  }, [replacementQuery, replacementVariants]);

  function setReturnedQty(saleItemId: string, qty: number, max: number) {
    const safeQty = Math.max(0, Math.min(max, Math.trunc(Number(qty || 0))));
    setError(null);
    setSuccess(null);
    setReturnedMap((prev) => ({ ...prev, [saleItemId]: safeQty }));
  }

  function setReplacementQty(variantId: string, qty: number, max: number) {
    const safeQty = Math.max(0, Math.min(max, Math.trunc(Number(qty || 0))));
    setError(null);
    setSuccess(null);
    setReplacementMap((prev) => ({ ...prev, [variantId]: safeQty }));
  }

  function clearAll() {
    const resetReturned: Record<string, number> = {};
    for (const item of sale.items) resetReturned[item.id] = 0;

    setReturnedMap(resetReturned);
    setReplacementMap({});
    setReason("");
    setNotes("");
    setError(null);
    setSuccess(null);
    setType("REFUND");
  }

  function submit() {
    setError(null);
    setSuccess(null);

    if (normalizedReturnedItems.length === 0) {
      setError("اختر كمية مرتجعة واحدة على الأقل");
      return;
    }

    if (type === "EXCHANGE" && normalizedReplacementItems.length === 0) {
      setError("اختر منتجات الاستبدال أولًا");
      return;
    }

    const fd = new FormData();
    fd.set("saleId", sale.id);
    fd.set("type", type);
    fd.set("reason", reason);
    fd.set("notes", notes);
    fd.set(
      "returnItemsJson",
      JSON.stringify(
        normalizedReturnedItems.map(({ saleItemId, qty }) => ({ saleItemId, qty }))
      )
    );
    fd.set(
      "replacementItemsJson",
      JSON.stringify(
        normalizedReplacementItems.map(({ variantId, qty }) => ({ variantId, qty }))
      )
    );

    startTransition(async () => {
      try {
        const res = await createReturn(fd);

        if (!res?.ok) {
          setError("حصل خطأ غير متوقع");
          return;
        }

        const summary =
          res.type === "EXCHANGE"
            ? `تم تسجيل الاستبدال بنجاح — إضافي على العميل: ${res.extraAmount} | مسترد: ${res.refundAmount}`
            : `تم تسجيل المرتجع بنجاح — المسترد: ${res.refundAmount}`;

        setSuccess(summary);
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "حصل خطأ أثناء تنفيذ المرتجع");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold">مرتجع / استبدال الفاتورة</h2>
            <div className="mt-2 text-sm text-white/65">
              رقم الفاتورة: <span className="font-mono text-white">{sale.id}</span>
            </div>
            <div className="mt-1 text-sm text-white/65">التاريخ: {sale.createdAtLabel}</div>
            <div className="mt-1 text-sm text-white/65">العميل: {sale.customer || "-"}</div>
            <div className="mt-1 text-sm text-white/65">البائع: {sale.sellerName}</div>
          </div>

          <div className="rounded-2xl border border-red-500/30 bg-red-600/10 px-4 py-3 text-sm">
            <div className="text-white/60">إجمالي الفاتورة</div>
            <div className="mt-1 text-2xl font-extrabold text-red-400">{sale.total}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <div className="xl:col-span-8 space-y-5">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="mb-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setType("REFUND")}
                className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                  type === "REFUND"
                    ? "bg-red-600 text-white"
                    : "border border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                مرتجع نقدي
              </button>

              <button
                type="button"
                onClick={() => setType("EXCHANGE")}
                className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                  type === "EXCHANGE"
                    ? "bg-red-600 text-white"
                    : "border border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                استبدال
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[950px] border-collapse text-right text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-white/70">
                    <th className="py-3">المنتج</th>
                    <th className="py-3">Grade</th>
                    <th className="py-3">Size</th>
                    <th className="py-3">Color</th>
                    <th className="py-3">SKU</th>
                    <th className="py-3">السعر</th>
                    <th className="py-3">المباع</th>
                    <th className="py-3">تم إرجاعه</th>
                    <th className="py-3">المتبقي</th>
                    <th className="py-3">كمية المرتجع</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.items.map((item) => {
                    const name = item.variant.model.brand
                      ? `${item.variant.model.brand} ${item.variant.model.name}`
                      : item.variant.model.name;

                    return (
                      <tr key={item.id} className="border-b border-white/5">
                        <td className="py-3 font-semibold">{name}</td>
                        <td className="py-3">{item.variant.grade}</td>
                        <td className="py-3">{item.variant.size ?? "-"}</td>
                        <td className="py-3">{item.variant.color ?? "-"}</td>
                        <td className="py-3">{item.variant.sku ?? "-"}</td>
                        <td className="py-3 text-red-300">{item.sellPrice}</td>
                        <td className="py-3">{item.qty}</td>
                        <td className="py-3">{item.alreadyReturnedQty}</td>
                        <td className="py-3 font-bold">{item.remainingQty}</td>
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              max={item.remainingQty}
                              value={returnedMap[item.id] ?? 0}
                              onChange={(e) =>
                                setReturnedQty(item.id, Number(e.target.value), item.remainingQty)
                              }
                              disabled={item.remainingQty <= 0 || isPending}
                              className="w-24 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-red-500 disabled:opacity-50"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setReturnedQty(item.id, item.remainingQty, item.remainingQty)
                              }
                              disabled={item.remainingQty <= 0 || isPending}
                              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-50"
                            >
                              الكل
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {type === "EXCHANGE" && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold">منتجات الاستبدال</h3>
                  <p className="mt-1 text-sm text-white/60">
                    اختر المنتجات الجديدة التي ستخرج بدل المرتجع
                  </p>
                </div>

                <input
                  value={replacementQuery}
                  onChange={(e) => setReplacementQuery(e.target.value)}
                  placeholder="بحث بالاسم / SKU / المقاس / اللون"
                  className="w-full max-w-sm rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] border-collapse text-right text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-white/70">
                      <th className="py-3">المنتج</th>
                      <th className="py-3">Grade</th>
                      <th className="py-3">Size</th>
                      <th className="py-3">Color</th>
                      <th className="py-3">SKU</th>
                      <th className="py-3">السعر</th>
                      <th className="py-3">المخزون</th>
                      <th className="py-3">الكمية</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReplacementVariants.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-white/50">
                          لا توجد نتائج
                        </td>
                      </tr>
                    ) : (
                      filteredReplacementVariants.map((variant) => {
                        const name = variant.model.brand
                          ? `${variant.model.brand} ${variant.model.name}`
                          : variant.model.name;

                        return (
                          <tr key={variant.id} className="border-b border-white/5">
                            <td className="py-3 font-semibold">{name}</td>
                            <td className="py-3">{variant.grade}</td>
                            <td className="py-3">{variant.size ?? "-"}</td>
                            <td className="py-3">{variant.color ?? "-"}</td>
                            <td className="py-3">{variant.sku ?? "-"}</td>
                            <td className="py-3 text-red-300">{variant.sellPrice}</td>
                            <td className="py-3">{variant.stockQty}</td>
                            <td className="py-3">
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min={0}
                                  max={variant.stockQty}
                                  value={replacementMap[variant.id] ?? 0}
                                  onChange={(e) =>
                                    setReplacementQty(
                                      variant.id,
                                      Number(e.target.value),
                                      variant.stockQty
                                    )
                                  }
                                  disabled={variant.stockQty <= 0 || isPending}
                                  className="w-24 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-red-500 disabled:opacity-50"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setReplacementQty(
                                      variant.id,
                                      (replacementMap[variant.id] ?? 0) + 1,
                                      variant.stockQty
                                    )
                                  }
                                  disabled={variant.stockQty <= 0 || isPending}
                                  className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold hover:bg-red-500 disabled:opacity-50"
                                >
                                  +1
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="xl:col-span-4 space-y-5">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="text-lg font-bold">ملخص العملية</h3>

            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-white/60">قيمة المرتجع قبل الخصم</span>
                <span className="font-bold">{returnedGross}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/60">نصيب الخصم من المرتجع</span>
                <span className="font-bold">{returnedDiscountShare}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/60">صافي قيمة المرتجع</span>
                <span className="font-bold text-red-300">{returnedValue}</span>
              </div>

              {type === "EXCHANGE" && (
                <>
                  <div className="mt-2 h-px bg-white/10" />
                  <div className="flex items-center justify-between">
                    <span className="text-white/60">قيمة الاستبدال</span>
                    <span className="font-bold">{replacementValue}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-white/60">مسترد للعميل</span>
                    <span className="font-bold">{refundAmount}</span>
                  </div>
                  <div className="flex items-center justify-between text-base">
                    <span className="text-white/60">إضافي على العميل</span>
                    <span className="font-extrabold text-red-400">{extraAmount}</span>
                  </div>
                </>
              )}

              {type === "REFUND" && (
                <div className="mt-2 flex items-center justify-between text-base">
                  <span className="text-white/60">المبلغ المسترد</span>
                  <span className="font-extrabold text-red-400">{refundAmount}</span>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <label className="mb-1 block text-sm text-white/70">سبب المرتجع</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: مقاس غير مناسب / عيب / تغيير رأي"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
            />

            <label className="mb-1 mt-4 block text-sm text-white/70">ملاحظات</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="أي تفاصيل إضافية"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
            />

            {error && (
              <div className="mt-4 rounded-xl border border-red-500/30 bg-red-600/10 p-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {success && (
              <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-600/10 p-3 text-sm text-emerald-300">
                {success}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={submit}
                disabled={isPending}
                className="rounded-xl bg-red-600 px-6 py-3 text-sm font-bold hover:bg-red-500 disabled:opacity-50"
              >
                {isPending
                  ? "جاري الحفظ..."
                  : type === "EXCHANGE"
                  ? "تنفيذ الاستبدال"
                  : "تسجيل المرتجع"}
              </button>

              <button
                type="button"
                onClick={clearAll}
                disabled={isPending}
                className="rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm hover:bg-white/10 disabled:opacity-50"
              >
                تفريغ
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}