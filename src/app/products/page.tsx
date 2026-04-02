import { prisma } from "@/lib/prisma";
import * as rbac from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import Link from "next/link";

export const dynamic = "force-dynamic";

type SearchParamsLike =
  | Record<string, string | string[] | undefined>
  | Promise<Record<string, string | string[] | undefined>>;

type ModelField = {
  name: string;
  kind?: string;
  type?: string;
  isId?: boolean;
  isRequired?: boolean;
};

type ModelInfo = {
  name: string;
  delegate: string;
  fields: ModelField[];
};

type InventoryRow = {
  id: string;
  variantDbId: unknown;
  productDbId: unknown | null;
  modelName: string;
  brand: string;
  grade: string;
  sellPrice: number;
  costPrice: number;
  stockQty: number;
  size: string;
  color: string;
  sku: string;
  isActive: boolean;
};

const GRADE_OPTIONS = ["ORIGINAL", "MIRROR", "EGYPTIAN"] as const;

function n(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function lowerCamel(value: string) {
  return value.length ? value[0].toLowerCase() + value.slice(1) : value;
}

function formatEGP(value: number) {
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function toNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getRuntimeModels(client: any): Record<string, any> {
  if (client?._runtimeDataModel?.models) return client._runtimeDataModel.models;
  if (client?._baseDmmf?.modelMap) return client._baseDmmf.modelMap;

  const datamodel = client?._dmmf?.datamodel?.models;
  if (Array.isArray(datamodel)) {
    return Object.fromEntries(datamodel.map((m: any) => [m.name, m]));
  }

  return {};
}

function fieldArray(meta: any): ModelField[] {
  if (!meta) return [];
  if (Array.isArray(meta.fields)) return meta.fields;
  if (meta.fields && typeof meta.fields === "object") return Object.values(meta.fields);
  return [];
}

function findModelInfo(client: any, candidates: string[]): ModelInfo | null {
  const models = getRuntimeModels(client);
  const delegateKeys = Object.keys(client).filter((key) => {
    const value = client[key];
    return value && typeof value.findMany === "function";
  });

  for (const [modelName, meta] of Object.entries(models)) {
    if (
      candidates.some((candidate) => {
        const a = n(candidate);
        const b = n(modelName);
        return a === b || a.includes(b) || b.includes(a);
      })
    ) {
      const delegate =
        delegateKeys.find((key) => n(key) === n(lowerCamel(String(modelName)))) ??
        delegateKeys.find((key) => n(key) === n(String(modelName))) ??
        lowerCamel(String(modelName));

      if (client[delegate] && typeof client[delegate].findMany === "function") {
        return {
          name: String(modelName),
          delegate,
          fields: fieldArray(meta),
        };
      }
    }
  }

  for (const candidate of candidates) {
    const delegate =
      delegateKeys.find((key) => n(key) === n(candidate)) ??
      delegateKeys.find((key) => n(key) === n(lowerCamel(candidate)));

    if (delegate) {
      return { name: candidate, delegate, fields: [] };
    }
  }

  return null;
}

function pickField(info: ModelInfo | null, candidates: string[]) {
  if (!info) return null;
  return (
    info.fields.find((field) =>
      candidates.some((candidate) => n(candidate) === n(field.name))
    ) ?? null
  );
}

function relationField(info: ModelInfo | null, targetModelName: string | null) {
  if (!info || !targetModelName) return null;
  return (
    info.fields.find((field) => {
      const kind = String(field.kind ?? "").toLowerCase();
      return (
        (kind === "object" || kind === "relation") &&
        (n(field.type ?? "") === n(targetModelName) ||
          n(field.name).includes(n(targetModelName)))
      );
    }) ?? null
  );
}

function getValue(obj: any, keys: Array<string | undefined | null>, fallback: any = "") {
  for (const key of keys) {
    if (!key) continue;
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return fallback;
}

function coerceWithField(value: unknown, field?: ModelField | null) {
  if (!field) return value;
  const type = String(field.type ?? "").toLowerCase();
  if (["int", "bigint", "float", "decimal"].includes(type)) return Number(value);
  if (type === "boolean") return value === true || value === "true" || value === "1" || value === 1;
  return value;
}

function stockMeta(qty: number) {
  if (qty <= 0) return { label: "نفد المخزون", cls: "bg-red-600/20 text-red-300 border-red-500/40" };
  if (qty <= 2) return { label: "حرج جدًا", cls: "bg-orange-500/20 text-orange-200 border-orange-400/40" };
  if (qty <= 5) return { label: "منخفض", cls: "bg-yellow-500/20 text-yellow-200 border-yellow-400/40" };
  return { label: "جيد", cls: "bg-emerald-500/20 text-emerald-200 border-emerald-400/40" };
}

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

async function assertOwner() {
  const requireOwner = (rbac as any).requireOwner;
  if (typeof requireOwner === "function") {
    await requireOwner();
    return;
  }

  const user = await getCurrentUser();
  const role = String(user?.role ?? user?.userRole ?? "").toUpperCase();
  if (role !== "OWNER") {
    throw new Error("غير مصرح");
  }
}

function getInventoryAdapter() {
  const client: any = prisma as any;

  const variantInfo = findModelInfo(client, [
    "ProductVariant",
    "Variant",
    "InventoryItem",
    "ItemVariant",
  ]);

  const productInfo = findModelInfo(client, [
    "Product",
    "ProductModel",
    "InventoryProduct",
    "Item",
  ]);

  const variantIdField =
    pickField(variantInfo, ["id", "variantId"]) ??
    variantInfo?.fields.find((field) => field.isId) ??
    null;

  const productIdField =
    pickField(productInfo, ["id", "productId"]) ??
    productInfo?.fields.find((field) => field.isId) ??
    null;

  const productRelation = relationField(variantInfo, productInfo?.name ?? null);

  const productFkField =
    pickField(variantInfo, [
      `${productRelation?.name ?? ""}Id`,
      `${lowerCamel(productInfo?.name ?? "product")}Id`,
      "productId",
      "itemId",
    ]) ?? null;

  return {
    client,
    variantInfo,
    productInfo,
    variantIdField,
    productIdField,
    productRelation,
    productFkField,

    modelNameField: pickField(productInfo, ["modelName", "name", "model", "title"]),
    brandField: pickField(productInfo, ["brand", "brandName", "label", "company"]),

    flatModelNameField: pickField(variantInfo, ["modelName", "name", "model", "title"]),
    flatBrandField: pickField(variantInfo, ["brand", "brandName", "label", "company"]),

    gradeField: pickField(variantInfo, ["grade", "quality", "category"]),
    sellPriceField: pickField(variantInfo, ["sellPrice", "salePrice", "price", "sellingPrice"]),
    costPriceField: pickField(variantInfo, ["costPrice", "cost", "buyPrice", "purchasePrice"]),
    stockQtyField: pickField(variantInfo, ["stockQty", "qty", "stock", "quantity"]),
    sizeField: pickField(variantInfo, ["size", "sizeValue"]),
    colorField: pickField(variantInfo, ["color", "colour"]),
    skuField: pickField(variantInfo, ["sku", "code", "barcode"]),
    activeField: pickField(variantInfo, ["isActive", "active", "enabled"]),
    createdAtField: pickField(variantInfo, ["createdAt"]),
    updatedAtField: pickField(variantInfo, ["updatedAt"]),
  };
}

async function loadInventoryRows(): Promise<InventoryRow[]> {
  const adapter = getInventoryAdapter();
  if (!adapter.variantInfo) return [];

  const orderField = adapter.updatedAtField?.name ?? adapter.createdAtField?.name ?? adapter.variantIdField?.name;

  const include =
    adapter.productRelation?.name
      ? {
          [adapter.productRelation.name]: true,
        }
      : undefined;

  const variantRows = await adapter.client[adapter.variantInfo.delegate].findMany({
    ...(include ? { include } : {}),
    ...(orderField ? { orderBy: { [orderField]: "desc" } } : {}),
  });

  return (Array.isArray(variantRows) ? variantRows : []).map((row: any) => {
    const product = adapter.productRelation?.name ? row[adapter.productRelation.name] : null;
    const modelName =
      String(
        getValue(
          product ?? row,
          [
            adapter.modelNameField?.name,
            adapter.flatModelNameField?.name,
            "modelName",
            "name",
            "model",
            "title",
          ],
          "-"
        )
      ) || "-";

    const brand =
      String(
        getValue(
          product ?? row,
          [
            adapter.brandField?.name,
            adapter.flatBrandField?.name,
            "brand",
            "brandName",
            "label",
          ],
          "-"
        )
      ) || "-";

    const variantDbId = getValue(row, [adapter.variantIdField?.name, "id"]);
    const productDbId = product
      ? getValue(product, [adapter.productIdField?.name, "id"], null)
      : getValue(row, [adapter.productFkField?.name], null);

    return {
      id: String(variantDbId),
      variantDbId,
      productDbId,
      modelName,
      brand,
      grade: String(getValue(row, [adapter.gradeField?.name, "grade", "quality"], "-")),
      sellPrice: toNumber(getValue(row, [adapter.sellPriceField?.name, "sellPrice", "salePrice", "price"], 0)),
      costPrice: toNumber(getValue(row, [adapter.costPriceField?.name, "costPrice", "cost", "purchasePrice"], 0)),
      stockQty: toNumber(getValue(row, [adapter.stockQtyField?.name, "stockQty", "qty", "quantity", "stock"], 0)),
      size: String(getValue(row, [adapter.sizeField?.name, "size", "sizeValue"], "-")),
      color: String(getValue(row, [adapter.colorField?.name, "color", "colour"], "-")),
      sku: String(getValue(row, [adapter.skuField?.name, "sku", "code", "barcode"], "-")),
      isActive: Boolean(getValue(row, [adapter.activeField?.name, "isActive", "active"], true)),
    };
  });
}

async function addVariantAction(formData: FormData) {
  "use server";

  await assertOwner();

  const adapter = getInventoryAdapter();
  if (!adapter.variantInfo) return;

  const modelName = String(formData.get("modelName") ?? "").trim();
  const brand = String(formData.get("brand") ?? "").trim();
  const grade = String(formData.get("grade") ?? "MIRROR").trim().toUpperCase();
  const sellPrice = toNumber(formData.get("sellPrice"));
  const costPrice = toNumber(formData.get("costPrice"));
  const stockQty = toNumber(formData.get("stockQty"));
  const size = String(formData.get("size") ?? "").trim();
  const color = String(formData.get("color") ?? "").trim();
  const sku = String(formData.get("sku") ?? "").trim();
  const isActive = String(formData.get("isActive") ?? "on") === "on";

  if (!modelName || !brand) return;

  let productIdValue: unknown = null;

  if (adapter.productInfo && (adapter.modelNameField || adapter.brandField)) {
    const where: Record<string, any> = {};

    if (adapter.modelNameField) where[adapter.modelNameField.name] = modelName;
    if (adapter.brandField) where[adapter.brandField.name] = brand;

    let product = await adapter.client[adapter.productInfo.delegate].findFirst({
      where,
    });

    if (!product) {
      const productCreateData: Record<string, any> = {};
      if (adapter.modelNameField) productCreateData[adapter.modelNameField.name] = modelName;
      if (adapter.brandField) productCreateData[adapter.brandField.name] = brand;
      product = await adapter.client[adapter.productInfo.delegate].create({
        data: productCreateData,
      });
    }

    productIdValue = getValue(product, [adapter.productIdField?.name, "id"], null);
  }

  const data: Record<string, any> = {};

  if (adapter.productRelation?.name && productIdValue !== null) {
    data[adapter.productRelation.name] = {
      connect: {
        [adapter.productIdField?.name ?? "id"]: coerceWithField(productIdValue, adapter.productIdField),
      },
    };
  } else if (adapter.productFkField && productIdValue !== null) {
    data[adapter.productFkField.name] = coerceWithField(productIdValue, adapter.productFkField);
  } else if (adapter.flatModelNameField || adapter.flatBrandField) {
    if (adapter.flatModelNameField) data[adapter.flatModelNameField.name] = modelName;
    if (adapter.flatBrandField) data[adapter.flatBrandField.name] = brand;
  }

  if (adapter.gradeField) data[adapter.gradeField.name] = grade;
  if (adapter.sellPriceField) data[adapter.sellPriceField.name] = sellPrice;
  if (adapter.costPriceField) data[adapter.costPriceField.name] = costPrice;
  if (adapter.stockQtyField) data[adapter.stockQtyField.name] = stockQty;
  if (adapter.sizeField) data[adapter.sizeField.name] = size;
  if (adapter.colorField) data[adapter.colorField.name] = color;
  if (adapter.skuField) data[adapter.skuField.name] = sku;
  if (adapter.activeField) data[adapter.activeField.name] = isActive;

  await adapter.client[adapter.variantInfo.delegate].create({ data });
  revalidatePath("/products");
}

async function restockAction(formData: FormData) {
  "use server";

  await assertOwner();

  const adapter = getInventoryAdapter();
  if (!adapter.variantInfo || !adapter.variantIdField || !adapter.stockQtyField) return;

  const rawId = formData.get("variantId");
  const delta = Math.max(0, toNumber(formData.get("restockQty")));

  if (rawId === null || delta <= 0) return;

  await adapter.client[adapter.variantInfo.delegate].update({
    where: {
      [adapter.variantIdField.name]: coerceWithField(rawId, adapter.variantIdField),
    },
    data: {
      [adapter.stockQtyField.name]: {
        increment: delta,
      },
    },
  });

  revalidatePath("/products");
}

async function toggleActiveAction(formData: FormData) {
  "use server";

  await assertOwner();

  const adapter = getInventoryAdapter();
  if (!adapter.variantInfo || !adapter.variantIdField || !adapter.activeField) return;

  const rawId = formData.get("variantId");
  const nextActive = String(formData.get("nextActive") ?? "false") === "true";
  if (rawId === null) return;

  await adapter.client[adapter.variantInfo.delegate].update({
    where: {
      [adapter.variantIdField.name]: coerceWithField(rawId, adapter.variantIdField),
    },
    data: {
      [adapter.activeField.name]: nextActive,
    },
  });

  revalidatePath("/products");
}

async function deleteVariantAction(formData: FormData) {
  "use server";

  await assertOwner();

  const adapter = getInventoryAdapter();
  if (!adapter.variantInfo || !adapter.variantIdField) return;

  const rawId = formData.get("variantId");
  if (rawId === null) return;

  await adapter.client[adapter.variantInfo.delegate].delete({
    where: {
      [adapter.variantIdField.name]: coerceWithField(rawId, adapter.variantIdField),
    },
  });

  revalidatePath("/products");
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams?: SearchParamsLike;
}) {
  const currentUser = await getCurrentUser();
  const role = String(currentUser?.role ?? currentUser?.userRole ?? "").toUpperCase();
  const isOwner = role === "OWNER";

  const rows = await loadInventoryRows();

  const totalVariants = rows.length;
  const totalStock = rows.reduce((sum, row) => sum + row.stockQty, 0);
  const inactiveCount = rows.filter((row) => !row.isActive).length;
  const alertCount = rows.filter((row) => row.stockQty <= 5).length;

  const params = await Promise.resolve(searchParams ?? {});
  const q = String(params?.q ?? "").trim().toLowerCase();

  const filteredRows = q
    ? rows.filter((row) =>
        [row.modelName, row.brand, row.grade, row.sku, row.size, row.color]
          .join(" ")
          .toLowerCase()
          .includes(q)
      )
    : rows;

  return (
    <main dir="rtl" className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
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
                إدخال فاريانت جديد للمخزون مع الأسعار والتفعيل والحالة التشغيلية.
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
                required
                className="h-12 rounded-2xl border border-white/10 bg-black/40 px-4 outline-none placeholder:text-white/35 focus:border-red-500/60"
              />
              <select
                name="grade"
                defaultValue="MIRROR"
                className="h-12 rounded-2xl border border-white/10 bg-black/40 px-4 outline-none focus:border-red-500/60"
              >
                {GRADE_OPTIONS.map((grade) => (
                  <option key={grade} value={grade} className="bg-black">
                    {grade}
                  </option>
                ))}
              </select>
              <input
                name="sku"
                placeholder="SKU / كود"
                className="h-12 rounded-2xl border border-white/10 bg-black/40 px-4 outline-none placeholder:text-white/35 focus:border-red-500/60"
              />
              <input
                name="sellPrice"
                type="number"
                step="0.01"
                min="0"
                placeholder="سعر البيع"
                className="h-12 rounded-2xl border border-white/10 bg-black/40 px-4 outline-none placeholder:text-white/35 focus:border-red-500/60"
              />
              <input
                name="costPrice"
                type="number"
                step="0.01"
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
                placeholder="اللون"
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
            <table className="min-w-[1200px] w-full text-right">
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
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={isOwner ? 12 : 11}
                      className="px-4 py-16 text-center text-sm text-white/45"
                    >
                      لا توجد منتجات مطابقة.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const alert = stockMeta(row.stockQty);

                    return (
                      <tr key={row.id} className="border-t border-white/10 align-top">
                        <td className="px-4 py-4 font-bold">{row.modelName}</td>
                        <td className="px-4 py-4 text-white/80">{row.brand}</td>
                        <td className="px-4 py-4">
                          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold">
                            {row.grade}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-white/90">{formatEGP(row.sellPrice)}</td>
                        <td className="px-4 py-4 text-white/60">{formatEGP(row.costPrice)}</td>
                        <td className="px-4 py-4 text-lg font-black">{row.stockQty}</td>
                        <td className="px-4 py-4 text-white/80">{row.size}</td>
                        <td className="px-4 py-4 text-white/80">{row.color}</td>
                        <td className="px-4 py-4 text-white/70">{row.sku}</td>
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
                            <div className="flex min-w-[240px] flex-col gap-3">
                              <form action={restockAction} className="flex gap-2">
                                <input type="hidden" name="variantId" value={String(row.variantDbId)} />
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
                                  <input type="hidden" name="variantId" value={String(row.variantDbId)} />
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
                                  <input type="hidden" name="variantId" value={String(row.variantDbId)} />
                                  <button className="h-10 rounded-xl bg-red-600/20 px-4 text-xs font-bold text-red-200 hover:bg-red-600/30">
                                    حذف 
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