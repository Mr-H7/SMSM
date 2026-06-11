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

type PaymentMethod = "CASH" | "TRANSFER";

function formatEGP(value: number) {
  return new Intl.NumberFormat("en-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function productName(v: VariantRow) {
  return v.model.brand ? `${v.model.brand} ${v.model.name}` : v.model.name;
}

function stockBadge(qty: number) {
  if (qty <= 0) return "bg-[var(--primary)]/15 text-[var(--primary-soft)]";
  if (qty <= 5) return "bg-[#ffb4aa]/12 text-[#ffb4aa]";
  return "bg-[var(--tertiary)]/12 text-[var(--tertiary)]";
}

export default function SalesNewClient({ variants }: { variants: VariantRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [customer, setCustomer] = useState("");
  const [discount, setDiscount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [paymentDescription, setPaymentDescription] = useState("");

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

      const name = productName(v).toLowerCase();
      const sku = (v.sku ?? "").toLowerCase();
      const color = (v.color ?? "").toLowerCase();
      const size = (v.size ?? "").toLowerCase();

      return name.includes(q) || sku.includes(q) || color.includes(q) || size.includes(q);
    });
  }, [variants, query, exactPrice, grade]);

  const cartMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of cart) m.set(it.variantId, it.qty);
    return m;
  }, [cart]);

  const cartRows = useMemo(() => {
    return cart
      .map((it) => {
        const variant = variants.find((x) => x.id === it.variantId);
        if (!variant) return null;
        return { ...it, variant, lineTotal: it.qty * variant.sellPrice };
      })
      .filter(Boolean) as Array<CartItem & { variant: VariantRow; lineTotal: number }>;
  }, [cart, variants]);

  const subtotal = useMemo(() => {
    return cartRows.reduce((sum, row) => sum + row.lineTotal, 0);
  }, [cartRows]);

  const safeDiscount = Math.max(0, Math.trunc(discount || 0));
  const total = Math.max(0, subtotal - safeDiscount);

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
      setError("Cart is empty.");
      return;
    }

    if (paymentMethod === "TRANSFER" && !paymentDescription.trim()) {
      setError("Transfer details are required for transfer payments.");
      return;
    }

    const fd = new FormData();
    fd.set("customer", customer);
    fd.set("discount", String(discount || 0));
    fd.set("paymentMethod", paymentMethod);
    fd.set("paymentDescription", paymentDescription);
    fd.set("itemsJson", JSON.stringify(cart));

    startTransition(async () => {
      try {
        const res = await createSale(fd);
        if (res?.ok) {
          router.push(`/invoices/${res.saleId}`);
        } else {
          setError("Unexpected sale error.");
        }
      } catch (e: any) {
        setError(e?.message ?? "Sale execution failed.");
      }
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="command-label">Point of sale</div>
          <h1 className="mt-2 text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">
            Fast Checkout
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/55">
            Search inventory, select quantities, capture payment details, and issue a thermal receipt without exposing cost data.
          </p>
        </div>
        <div className="command-panel px-4 py-3 text-right">
          <div className="command-label">Live total</div>
          <div className="mt-1 text-2xl font-black text-white">{formatEGP(total)}</div>
        </div>
      </section>

      <section className="command-panel-high grid gap-3 p-4 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <label className="command-label mb-2 block">Search</label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, brand, SKU, color, size..."
            className="command-input h-12 w-full px-4 text-sm placeholder:text-white/30"
          />
        </div>
        <div className="lg:col-span-3">
          <label className="command-label mb-2 block">Exact price</label>
          <input
            value={exactPrice}
            onChange={(e) => setExactPrice(e.target.value)}
            placeholder="Example: 600"
            className="command-input h-12 w-full px-4 text-sm placeholder:text-white/30"
          />
        </div>
        <div className="lg:col-span-3">
          <label className="command-label mb-2 block">Grade</label>
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value as any)}
            className="command-input h-12 w-full px-4 text-sm"
          >
            <option value="" className="bg-[#201f1f]">All Grades</option>
            <option value="ORIGINAL" className="bg-[#201f1f]">ORIGINAL</option>
            <option value="MIRROR" className="bg-[#201f1f]">MIRROR</option>
            <option value="EGYPTIAN" className="bg-[#201f1f]">EGYPTIAN</option>
          </select>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-12">
        <section className="command-panel overflow-hidden xl:col-span-8">
          <div className="flex items-center justify-between bg-[var(--surface-lowest)] px-5 py-4">
            <div>
              <div className="command-label">Product selection</div>
              <h2 className="mt-1 text-lg font-black uppercase tracking-tight text-white">
                Sellable Inventory
              </h2>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/42">
              {filtered.length} visible
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="command-table min-w-[980px] text-left text-sm">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Grade</th>
                  <th>Retail</th>
                  <th>Stock</th>
                  <th>Size</th>
                  <th>Color</th>
                  <th>Qty</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-white/42">
                      No products match the current search.
                    </td>
                  </tr>
                ) : (
                  filtered.map((v) => {
                    const qty = cartMap.get(v.id) ?? 0;

                    return (
                      <tr key={v.id}>
                        <td>
                          <div className="font-black text-white">{productName(v)}</div>
                          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-white/42">
                            {v.sku || "-"}
                          </div>
                        </td>
                        <td>
                          <span className="command-badge bg-white/[0.055] text-white/70">{v.grade}</span>
                        </td>
                        <td className="font-black text-white">{formatEGP(v.sellPrice)}</td>
                        <td>
                          <span className={`command-badge ${stockBadge(v.stockQty)}`}>{v.stockQty} left</span>
                        </td>
                        <td className="text-white/65">{v.size ?? "-"}</td>
                        <td className="text-white/65">{v.color ?? "-"}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setQty(v.id, qty - 1)}
                              disabled={qty <= 0}
                              className="command-secondary h-9 w-9 text-sm font-black disabled:opacity-35"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              value={qty}
                              min={0}
                              max={v.stockQty}
                              onChange={(e) => setQty(v.id, Number(e.target.value))}
                              className="command-input h-9 w-20 px-3 text-center text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => addOne(v.id)}
                              disabled={v.stockQty <= 0 || qty >= v.stockQty}
                              className="command-secondary h-9 w-9 text-sm font-black disabled:opacity-35"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => addOne(v.id)}
                            disabled={v.stockQty <= 0 || qty >= v.stockQty}
                            className="command-primary h-9 px-4 text-[10px] font-black uppercase tracking-[0.1em] disabled:opacity-35"
                          >
                            Add
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-6 xl:col-span-4">
          <section className="command-panel-high p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="command-label">Current cart</div>
                <h2 className="mt-1 text-lg font-black uppercase tracking-tight text-white">
                  Ticket Build
                </h2>
              </div>
              <button
                type="button"
                onClick={clearCart}
                disabled={isPending || cart.length === 0}
                className="command-secondary px-3 py-2 text-[10px] font-black uppercase tracking-[0.1em] disabled:opacity-35"
              >
                Clear
              </button>
            </div>

            <div className="max-h-[310px] space-y-2 overflow-y-auto pr-1">
              {cartRows.length === 0 ? (
                <div className="bg-black/20 px-4 py-8 text-center text-sm text-white/42">
                  No items selected.
                </div>
              ) : (
                cartRows.map((row) => (
                  <div key={row.variantId} className="bg-black/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-black text-white">{productName(row.variant)}</div>
                        <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-white/42">
                          Qty {row.qty} x {formatEGP(row.variant.sellPrice)}
                        </div>
                      </div>
                      <div className="font-black text-white">{formatEGP(row.lineTotal)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="command-panel-high p-5">
            <div className="command-label">Checkout controls</div>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-2">
                <span className="command-label">Customer</span>
                <input
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  placeholder="Optional customer name"
                  className="command-input h-12 px-4 text-sm placeholder:text-white/30"
                />
              </label>

              <label className="grid gap-2">
                <span className="command-label">Discount</span>
                <input
                  type="number"
                  value={discount}
                  onChange={(e) => setDiscount(Number(e.target.value))}
                  className="command-input h-12 px-4 text-sm"
                />
              </label>

              <label className="grid gap-2">
                <span className="command-label">Payment method</span>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="command-input h-12 px-4 text-sm"
                >
                  <option value="CASH" className="bg-[#201f1f]">Cash</option>
                  <option value="TRANSFER" className="bg-[#201f1f]">Transfer</option>
                </select>
              </label>

              {paymentMethod === "TRANSFER" ? (
                <label className="grid gap-2">
                  <span className="command-label">Transfer details</span>
                  <textarea
                    value={paymentDescription}
                    onChange={(e) => setPaymentDescription(e.target.value)}
                    rows={3}
                    placeholder="Wallet, bank, reference number, sender name..."
                    className="command-input px-4 py-3 text-sm placeholder:text-white/30"
                  />
                </label>
              ) : null}

              {error ? (
                <div className="border border-[var(--primary)]/30 bg-[var(--primary)]/12 p-3 text-sm font-semibold text-[var(--primary-soft)]">
                  {error}
                </div>
              ) : null}
            </div>
          </section>

          <section className="command-panel-high p-5">
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-white/55">Subtotal</span>
                <span className="font-black text-white">{formatEGP(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/55">Discount</span>
                <span className="font-black text-white">{formatEGP(safeDiscount)}</span>
              </div>
              <div className="h-px bg-white/[0.06]" />
              <div className="flex items-end justify-between">
                <span className="command-label">Final total</span>
                <span className="text-3xl font-black text-white">{formatEGP(total)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={submit}
              disabled={isPending}
              className="command-primary mt-5 h-12 w-full text-xs font-black uppercase tracking-[0.12em] disabled:opacity-45"
            >
              {isPending ? "Processing..." : "Complete Sale"}
            </button>

            <p className="mt-3 text-[11px] leading-5 text-white/38">
              Cost and profit data are not shown in POS. The server keeps the cost snapshot for authorized reports only.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
