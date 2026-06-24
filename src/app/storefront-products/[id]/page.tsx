import { notFound } from "next/navigation";
import Link from "next/link";
import CommandShell from "@/components/CommandShell";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/rbac";
import { saveStorefrontProductAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function StorefrontProductEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireOwner();
  const { id } = await params;
  const [listing, categories, variants] = await Promise.all([
    prisma.storefrontProduct.findUnique({
      where: { id },
      include: {
        mapping: true,
        images: { orderBy: { sortOrder: "asc" } },
      },
    }),
    prisma.storefrontCategory.findMany({ orderBy: { nameAr: "asc" } }),
    prisma.productVariant.findMany({
      orderBy: { updatedAt: "desc" },
      include: { model: true },
    }),
  ]);
  if (!listing) notFound();

  return (
    <CommandShell active="storefront" user={user}>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="command-label">{listing.approvedSku}</div>
            <h1 className="mt-2 text-3xl font-black text-white">تحرير منتج الموقع</h1>
          </div>
          <Link href="/storefront-products" className="command-secondary px-5 py-3 text-xs font-black">رجوع</Link>
        </div>

        <form action={saveStorefrontProductAction} className="command-panel-high grid gap-5 p-6 md:grid-cols-2">
          <input type="hidden" name="id" value={listing.id} />

          <label className="text-xs font-bold text-white/55">
            الاسم العربي
            <input name="nameAr" defaultValue={listing.nameAr} className="command-input mt-2 h-12 w-full px-4" required />
          </label>
          <label className="text-xs font-bold text-white/55">
            الاسم الإنجليزي
            <input name="nameEn" defaultValue={listing.nameEn} className="command-input mt-2 h-12 w-full px-4" required />
          </label>
          <label className="text-xs font-bold text-white/55 md:col-span-2">
            الرابط
            <input name="slug" defaultValue={listing.slug} className="command-input mt-2 h-12 w-full px-4 font-mono" required />
          </label>

          <label className="text-xs font-bold text-white/55">
            التصنيف
            <select name="categoryId" defaultValue={listing.categoryId} className="command-input mt-2 h-12 w-full px-4">
              {categories.map((category) => <option key={category.id} value={category.id}>{category.nameAr}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-white/55">
            ربط المخزون والسعر الأساسي
            <select name="productVariantId" defaultValue={listing.mapping?.productVariantId} className="command-input mt-2 h-12 w-full px-4">
              {variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.model.name} / {variant.stockQty} / {variant.sellPrice} EGP
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-bold text-white/55">
            المقاسات
            <input name="sizes" defaultValue={listing.sizes.join(", ")} className="command-input mt-2 h-12 w-full px-4" />
          </label>
          <label className="text-xs font-bold text-white/55">
            الألوان
            <input name="colors" defaultValue={listing.colors.join(", ")} className="command-input mt-2 h-12 w-full px-4" />
          </label>

          <label className="text-xs font-bold text-white/55">
            سعر المقارنة التسويقي
            <input name="compareAtPrice" type="number" min="0" defaultValue={listing.compareAtPrice ?? ""} className="command-input mt-2 h-12 w-full px-4" />
          </label>
          <label className="text-xs font-bold text-white/55">
            الشارة
            <select name="badge" defaultValue={listing.badge ?? ""} className="command-input mt-2 h-12 w-full px-4">
              <option value="">بدون</option>
              <option value="NEW">New</option>
              <option value="BESTSELLER">Bestseller</option>
              <option value="LIMITED">Limited</option>
              <option value="OFFER">Offer</option>
            </select>
          </label>

          <label className="text-xs font-bold text-white/55 md:col-span-2">
            وصف قصير عربي
            <input name="shortDescriptionAr" defaultValue={listing.shortDescriptionAr ?? ""} className="command-input mt-2 h-12 w-full px-4" />
          </label>
          <label className="text-xs font-bold text-white/55 md:col-span-2">
            وصف قصير إنجليزي
            <input name="shortDescriptionEn" defaultValue={listing.shortDescriptionEn ?? ""} className="command-input mt-2 h-12 w-full px-4" />
          </label>
          <label className="text-xs font-bold text-white/55 md:col-span-2">
            الوصف العربي
            <textarea name="descriptionAr" defaultValue={listing.descriptionAr} className="command-input mt-2 min-h-28 w-full p-4" />
          </label>
          <label className="text-xs font-bold text-white/55 md:col-span-2">
            الوصف الإنجليزي
            <textarea name="descriptionEn" defaultValue={listing.descriptionEn} className="command-input mt-2 min-h-28 w-full p-4" />
          </label>

          <label className="text-xs font-bold text-white/55 md:col-span-2">
            مسارات الصور المحلية، FRONT أولاً
            <textarea name="images" defaultValue={listing.images.map((image) => image.path).join("\n")} className="command-input mt-2 min-h-40 w-full p-4 font-mono text-xs" required />
          </label>

          {[
            ["seoTitleAr", "عنوان SEO عربي", listing.seoTitleAr],
            ["seoTitleEn", "عنوان SEO إنجليزي", listing.seoTitleEn],
            ["seoDescriptionAr", "وصف SEO عربي", listing.seoDescriptionAr],
            ["seoDescriptionEn", "وصف SEO إنجليزي", listing.seoDescriptionEn],
          ].map(([name, label, defaultValue]) => (
            <label key={name} className="text-xs font-bold text-white/55">
              {label}
              <input name={name} defaultValue={defaultValue ?? ""} className="command-input mt-2 h-12 w-full px-4" />
            </label>
          ))}

          <div className="flex flex-wrap gap-5 md:col-span-2">
            <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" name="featured" defaultChecked={listing.featured} /> مميز</label>
            <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" name="isOffer" defaultChecked={listing.isOffer} /> عرض</label>
            <label className="flex items-center gap-2 text-sm font-black text-[var(--primary-soft)]"><input type="checkbox" name="publishToWeb" defaultChecked={listing.publishToWeb} /> نشر في الموقع</label>
          </div>

          <div className="md:col-span-2">
            <button className="command-primary px-7 py-3 text-xs font-black">حفظ إعدادات الموقع</button>
          </div>
        </form>
      </div>
    </CommandShell>
  );
}