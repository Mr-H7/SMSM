import Link from "next/link";
import CommandShell from "@/components/CommandShell";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function StorefrontProductsPage() {
  const user = await requireOwner();
  const listings = await prisma.storefrontProduct.findMany({
    orderBy: { approvedSku: "asc" },
    include: {
      category: true,
      mapping: { include: { productVariant: { include: { model: true } } } },
      _count: { select: { images: true } },
    },
  });

  return (
    <CommandShell active="storefront" user={user}>
      <div className="mx-auto max-w-7xl space-y-8">
        <section>
          <div className="command-label">قائمة السماح العامة</div>
          <h1 className="mt-2 text-3xl font-black text-white sm:text-4xl">منتجات الموقع</h1>
          <p className="mt-2 text-sm text-white/55">
            هذه السجلات فقط يمكن أن تظهر في الموقع. السعر والمخزون معروضان من النسخة الأساسية ولا يتم تخزينهما هنا.
          </p>
        </section>

        <section className="command-panel-high overflow-hidden">
          <div className="overflow-x-auto">
            <table className="command-table min-w-[1000px] text-sm">
              <thead>
                <tr>
                  <th>SKU المعتمد</th>
                  <th>اسم الموقع</th>
                  <th>المخزون الأساسي</th>
                  <th>السعر الأساسي</th>
                  <th>التصنيف</th>
                  <th>الصور</th>
                  <th>النشر</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {listings.map((listing) => {
                  const variant = listing.mapping?.productVariant;
                  return (
                    <tr key={listing.id}>
                      <td className="font-mono text-xs text-white/55">{listing.approvedSku}</td>
                      <td>
                        <div className="font-black text-white">{listing.nameAr}</div>
                        <div className="mt-1 text-xs text-white/45">{listing.nameEn}</div>
                      </td>
                      <td>
                        {variant ? variant.model.name + " / " + variant.stockQty : "غير مربوط"}
                      </td>
                      <td className="font-black text-white">
                        {variant ? new Intl.NumberFormat("ar-EG").format(variant.sellPrice) + " EGP" : "-"}
                      </td>
                      <td>{listing.category.nameAr}</td>
                      <td>{listing._count.images}</td>
                      <td>
                        <span className={"command-badge " + (listing.publishToWeb ? "bg-[var(--tertiary)]/15 text-[var(--tertiary)]" : "bg-white/[0.06] text-white/55")}>
                          {listing.publishToWeb ? "منشور" : "مسودة"}
                        </span>
                      </td>
                      <td>
                        <Link href={"/storefront-products/" + listing.id} className="text-xs font-black text-[var(--primary-soft)] hover:text-white">
                          تعديل
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </CommandShell>
  );
}