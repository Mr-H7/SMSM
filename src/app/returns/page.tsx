import { prisma } from "@/lib/prisma";
import * as rbac from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
};

type ModelInfo = {
  name: string;
  delegate: string;
  fields: ModelField[];
};

type InvoiceItemView = {
  id: string;
  soldQty: number;
  returnedQty: number;
  remainingQty: number;
  unitPrice: number;
  title: string;
  variantId: string | null;
};

type InvoiceView = {
  dbId: string;
  publicId: string;
  customer: string;
  seller: string;
  total: number;
  discount: number;
  dateText: string;
  items: InvoiceItemView[];
  rawHasItemsRelation: boolean;
};

type ReplacementVariantView = {
  id: string;
  label: string;
  stockQty: number;
  sellPrice: number;
};

type MiniInvoiceCard = {
  dbId: string;
  publicId: string;
  customer: string;
  seller: string;
  total: number;
  dateText: string;
};

function normalize(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function lowerCamel(value: string) {
  return value.length ? value[0].toLowerCase() + value.slice(1) : value;
}

function toNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatEGP(value: number) {
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function getRuntimeModels(client: any): Record<string, any> {
  if (client?._runtimeDataModel?.models) return client._runtimeDataModel.models;
  if (client?._baseDmmf?.modelMap) return client._baseDmmf.modelMap;

  const models = client?._dmmf?.datamodel?.models;
  if (Array.isArray(models)) {
    return Object.fromEntries(models.map((m: any) => [m.name, m]));
  }

  return {};
}

function getModelFields(meta: any): ModelField[] {
  if (!meta) return [];
  if (Array.isArray(meta.fields)) return meta.fields;
  if (meta.fields && typeof meta.fields === "object") return Object.values(meta.fields);
  return [];
}

function findModelInfo(client: any, candidates: string[]): ModelInfo | null {
  const runtimeModels = getRuntimeModels(client);
  const delegateKeys = Object.keys(client).filter((key) => {
    const value = client[key];
    return value && typeof value.findMany === "function";
  });

  for (const [modelName, meta] of Object.entries(runtimeModels)) {
    const match = candidates.some((candidate) => {
      const a = normalize(candidate);
      const b = normalize(String(modelName));
      return a === b || a.includes(b) || b.includes(a);
    });

    if (!match) continue;

    const delegate =
      delegateKeys.find((key) => normalize(key) === normalize(lowerCamel(String(modelName)))) ??
      delegateKeys.find((key) => normalize(key) === normalize(String(modelName))) ??
      lowerCamel(String(modelName));

    if (client[delegate] && typeof client[delegate].findMany === "function") {
      return {
        name: String(modelName),
        delegate,
        fields: getModelFields(meta),
      };
    }
  }

  for (const candidate of candidates) {
    const delegate =
      delegateKeys.find((key) => normalize(key) === normalize(candidate)) ??
      delegateKeys.find((key) => normalize(key) === normalize(lowerCamel(candidate)));

    if (delegate) {
      return {
        name: candidate,
        delegate,
        fields: [],
      };
    }
  }

  return null;
}

function pickField(model: ModelInfo | null, candidates: string[]) {
  if (!model) return null;
  return (
    model.fields.find((field) =>
      candidates.some((candidate) => normalize(candidate) === normalize(field.name))
    ) ?? null
  );
}

function pickRelation(model: ModelInfo | null, targetModelName: string | null) {
  if (!model || !targetModelName) return null;

  return (
    model.fields.find((field) => {
      const kind = String(field.kind ?? "").toLowerCase();
      return (
        (kind === "object" || kind === "relation") &&
        (normalize(String(field.type ?? "")) === normalize(targetModelName) ||
          normalize(field.name).includes(normalize(targetModelName)))
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

function coerceByField(value: unknown, field?: ModelField | null) {
  if (!field) return value;
  const type = String(field.type ?? "").toLowerCase();
  if (["int", "bigint", "float", "decimal"].includes(type)) return Number(value);
  if (type === "boolean") return value === true || value === "true" || value === "1" || value === 1;
  return value;
}

async function ensureLoggedIn() {
  const requireUser = (rbac as any).requireUser;
  if (typeof requireUser === "function") {
    await requireUser();
  }
}

function getAdapter() {
  const client: any = prisma as any;

  const invoiceModel = findModelInfo(client, ["Invoice", "Sale", "SalesInvoice", "Order"]);
  const itemModel = findModelInfo(client, ["InvoiceItem", "SaleItem", "OrderItem"]);
  const variantModel = findModelInfo(client, ["ProductVariant", "Variant", "InventoryItem", "ItemVariant"]);
  const userModel = findModelInfo(client, ["User", "AppUser"]);

  const invoiceIdField =
    pickField(invoiceModel, ["id", "invoicePk"]) ??
    invoiceModel?.fields.find((f) => f.isId) ??
    null;

  const itemIdField =
    pickField(itemModel, ["id", "itemId"]) ??
    itemModel?.fields.find((f) => f.isId) ??
    null;

  const variantIdField =
    pickField(variantModel, ["id", "variantId"]) ??
    variantModel?.fields.find((f) => f.isId) ??
    null;

  const invoiceItemsRelation = pickRelation(invoiceModel, itemModel?.name ?? null);
  const itemVariantRelation = pickRelation(itemModel, variantModel?.name ?? null);
  const invoiceSellerRelation = pickRelation(invoiceModel, userModel?.name ?? null);

  return {
    client,
    invoiceModel,
    itemModel,
    variantModel,
    userModel,

    invoiceIdField,
    itemIdField,
    variantIdField,

    invoiceItemsRelation,
    itemVariantRelation,
    invoiceSellerRelation,

    invoicePublicIdField: pickField(invoiceModel, [
      "invoiceId",
      "code",
      "serial",
      "reference",
      "publicId",
    ]),
    invoiceCustomerField: pickField(invoiceModel, [
      "customerName",
      "clientName",
      "customer",
      "client",
      "buyerName",
    ]),
    invoiceTotalField: pickField(invoiceModel, [
      "total",
      "netTotal",
      "finalTotal",
      "grandTotal",
    ]),
    invoiceDiscountField: pickField(invoiceModel, [
      "discount",
      "discountAmount",
    ]),
    invoiceDateField: pickField(invoiceModel, [
      "createdAt",
      "issuedAt",
      "date",
      "invoiceDate",
    ]),
    invoiceNotesField: pickField(invoiceModel, [
      "notes",
      "note",
      "comment",
    ]),

    itemQtyField: pickField(itemModel, ["quantity", "qty", "count"]),
    itemReturnedQtyField: pickField(itemModel, [
      "returnedQty",
      "returnQty",
      "refundedQty",
    ]),
    itemUnitPriceField: pickField(itemModel, [
      "sellPrice",
      "price",
      "unitPrice",
      "salePrice",
    ]),
    itemVariantIdField: pickField(itemModel, [
      "variantId",
      "productVariantId",
      "itemVariantId",
      "inventoryItemId",
    ]),

    userNameField: pickField(userModel, ["username", "name", "fullName"]),

    variantStockField: pickField(variantModel, [
      "stockQty",
      "qty",
      "stock",
      "quantity",
    ]),
    variantPriceField: pickField(variantModel, [
      "sellPrice",
      "salePrice",
      "price",
      "sellingPrice",
    ]),
    variantSkuField: pickField(variantModel, ["sku", "code", "barcode"]),
    variantSizeField: pickField(variantModel, ["size", "sizeValue"]),
    variantColorField: pickField(variantModel, ["color", "colour"]),
    variantGradeField: pickField(variantModel, ["grade", "quality"]),
    variantModelNameField: pickField(variantModel, [
      "modelName",
      "name",
      "model",
      "title",
    ]),
    variantBrandField: pickField(variantModel, ["brand", "brandName", "label"]),
    variantActiveField: pickField(variantModel, [
      "isActive",
      "active",
      "enabled",
    ]),
  };
}

async function getInvoiceData(query: string) {
  const adapter = getAdapter();

  if (!adapter.invoiceModel) {
    return {
      invoice: null as InvoiceView | null,
      replacements: [] as ReplacementVariantView[],
      recentInvoices: [] as MiniInvoiceCard[],
    };
  }

  const include: Record<string, any> = {};
  if (adapter.invoiceItemsRelation?.name) include[adapter.invoiceItemsRelation.name] = true;
  if (adapter.invoiceSellerRelation?.name) include[adapter.invoiceSellerRelation.name] = true;

  const orderField =
    adapter.invoiceDateField?.name ??
    adapter.invoiceIdField?.name ??
    "id";

  const invoices = await adapter.client[adapter.invoiceModel.delegate].findMany({
    ...(Object.keys(include).length ? { include } : {}),
    ...(orderField ? { orderBy: { [orderField]: "desc" } } : {}),
    take: 100,
  });

  const recentInvoices: MiniInvoiceCard[] = (Array.isArray(invoices) ? invoices : []).slice(0, 8).map((invoice: any) => ({
    dbId: String(getValue(invoice, [adapter.invoiceIdField?.name, "id"], "")),
    publicId: String(
      getValue(
        invoice,
        [adapter.invoicePublicIdField?.name, "invoiceId", "code", "serial"],
        getValue(invoice, [adapter.invoiceIdField?.name, "id"], "-")
      )
    ),
    customer: String(
      getValue(
        invoice,
        [adapter.invoiceCustomerField?.name, "customerName", "clientName", "customer", "buyerName"],
        "-"
      )
    ),
    seller:
      adapter.invoiceSellerRelation?.name && invoice[adapter.invoiceSellerRelation.name]
        ? String(
            getValue(
              invoice[adapter.invoiceSellerRelation.name],
              [adapter.userNameField?.name, "username", "name"],
              "-"
            )
          )
        : "-",
    total: toNumber(
      getValue(invoice, [adapter.invoiceTotalField?.name, "total", "finalTotal"], 0)
    ),
    dateText: (() => {
      const d = getValue(invoice, [adapter.invoiceDateField?.name, "createdAt", "issuedAt", "date"], null);
      return d ? new Date(d).toLocaleString("ar-EG") : "-";
    })(),
  }));

  const found = (Array.isArray(invoices) ? invoices : []).find((invoice: any) => {
    if (!query) return false;

    const haystack = [
      String(getValue(invoice, [adapter.invoiceIdField?.name, "id"], "")),
      String(
        getValue(
          invoice,
          [adapter.invoicePublicIdField?.name, "invoiceId", "code", "serial"],
          ""
        )
      ),
      String(
        getValue(
          invoice,
          [adapter.invoiceCustomerField?.name, "customerName", "clientName", "customer", "buyerName"],
          ""
        )
      ),
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query.toLowerCase());
  });

  let invoice: InvoiceView | null = null;

  if (found) {
    const rawItems = adapter.invoiceItemsRelation?.name
      ? Array.isArray(found[adapter.invoiceItemsRelation.name])
        ? found[adapter.invoiceItemsRelation.name]
        : []
      : [];

    const items: InvoiceItemView[] = rawItems.map((item: any) => {
      const linkedVariant =
        adapter.itemVariantRelation?.name && item[adapter.itemVariantRelation.name]
          ? item[adapter.itemVariantRelation.name]
          : null;

      const soldQty = toNumber(
        getValue(item, [adapter.itemQtyField?.name, "quantity", "qty"], 0)
      );
      const returnedQty = toNumber(
        getValue(
          item,
          [adapter.itemReturnedQtyField?.name, "returnedQty", "returnQty", "refundedQty"],
          0
        )
      );

      const title = [
        getValue(
          linkedVariant,
          [adapter.variantModelNameField?.name, "modelName", "name", "model"],
          ""
        ),
        getValue(linkedVariant, [adapter.variantBrandField?.name, "brand", "brandName"], ""),
        getValue(linkedVariant, [adapter.variantGradeField?.name, "grade"], ""),
        getValue(linkedVariant, [adapter.variantSizeField?.name, "size"], ""),
        getValue(linkedVariant, [adapter.variantColorField?.name, "color"], ""),
        getValue(linkedVariant, [adapter.variantSkuField?.name, "sku", "code"], ""),
      ]
        .filter(Boolean)
        .join(" - ");

      const variantId =
        getValue(
          item,
          [adapter.itemVariantIdField?.name, "variantId", "productVariantId"],
          null
        ) ??
        (linkedVariant
          ? String(getValue(linkedVariant, [adapter.variantIdField?.name, "id"], ""))
          : null);

      return {
        id: String(getValue(item, [adapter.itemIdField?.name, "id"], "")),
        soldQty,
        returnedQty,
        remainingQty: Math.max(0, soldQty - returnedQty),
        unitPrice: toNumber(
          getValue(
            item,
            [adapter.itemUnitPriceField?.name, "sellPrice", "price", "unitPrice"],
            0
          )
        ),
        title: title || `عنصر #${getValue(item, [adapter.itemIdField?.name, "id"], "-")}`,
        variantId: variantId ? String(variantId) : null,
      };
    });

    invoice = {
      dbId: String(getValue(found, [adapter.invoiceIdField?.name, "id"], "")),
      publicId: String(
        getValue(
          found,
          [adapter.invoicePublicIdField?.name, "invoiceId", "code", "serial"],
          getValue(found, [adapter.invoiceIdField?.name, "id"], "-")
        )
      ),
      customer: String(
        getValue(
          found,
          [adapter.invoiceCustomerField?.name, "customerName", "clientName", "customer", "buyerName"],
          "-"
        )
      ),
      seller:
        adapter.invoiceSellerRelation?.name && found[adapter.invoiceSellerRelation.name]
          ? String(
              getValue(
                found[adapter.invoiceSellerRelation.name],
                [adapter.userNameField?.name, "username", "name"],
                "-"
              )
            )
          : "-",
      total: toNumber(
        getValue(found, [adapter.invoiceTotalField?.name, "total", "finalTotal"], 0)
      ),
      discount: toNumber(
        getValue(found, [adapter.invoiceDiscountField?.name, "discount", "discountAmount"], 0)
      ),
      dateText: (() => {
        const d = getValue(
          found,
          [adapter.invoiceDateField?.name, "createdAt", "issuedAt", "date"],
          null
        );
        return d ? new Date(d).toLocaleString("ar-EG") : "-";
      })(),
      items,
      rawHasItemsRelation: Boolean(adapter.invoiceItemsRelation?.name),
    };
  }

  let replacements: ReplacementVariantView[] = [];

  if (adapter.variantModel && adapter.variantIdField) {
    const where: Record<string, any> = {};
    if (adapter.variantActiveField) where[adapter.variantActiveField.name] = true;

    const variants = await adapter.client[adapter.variantModel.delegate].findMany({
      ...(Object.keys(where).length ? { where } : {}),
      take: 200,
      orderBy: {
        [adapter.variantIdField.name]: "desc",
      },
    });

    replacements = (Array.isArray(variants) ? variants : []).map((variant: any) => {
      const stockQty = toNumber(
        getValue(
          variant,
          [adapter.variantStockField?.name, "stockQty", "qty", "stock"],
          0
        )
      );

      const sellPrice = toNumber(
        getValue(
          variant,
          [adapter.variantPriceField?.name, "sellPrice", "salePrice", "price"],
          0
        )
      );

      return {
        id: String(getValue(variant, [adapter.variantIdField?.name, "id"], "")),
        label: [
          getValue(
            variant,
            [adapter.variantModelNameField?.name, "modelName", "name", "model"],
            ""
          ),
          getValue(variant, [adapter.variantBrandField?.name, "brand", "brandName"], ""),
          getValue(variant, [adapter.variantGradeField?.name, "grade"], ""),
          getValue(variant, [adapter.variantSizeField?.name, "size"], ""),
          getValue(variant, [adapter.variantColorField?.name, "color"], ""),
          `مخزون ${stockQty}`,
        ]
          .filter(Boolean)
          .join(" - "),
        stockQty,
        sellPrice,
      };
    });
  }

  return { invoice, replacements, recentInvoices };
}

async function processReturnAction(formData: FormData) {
  "use server";

  await ensureLoggedIn();

  const adapter = getAdapter();

  if (
    !adapter.invoiceModel ||
    !adapter.itemModel ||
    !adapter.invoiceIdField ||
    !adapter.invoiceItemsRelation
  ) {
    redirect("/returns?result=config_error");
  }

  const invoiceDbId = String(formData.get("invoiceDbId") ?? "").trim();
  const searchQ = String(formData.get("searchQ") ?? "").trim();
  const mode = String(formData.get("mode") ?? "refund").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!invoiceDbId) {
    redirect(`/returns?q=${encodeURIComponent(searchQ)}&result=notfound`);
  }

  const include: Record<string, any> = {
    [adapter.invoiceItemsRelation.name]: true,
  };

  const invoice = await adapter.client[adapter.invoiceModel.delegate].findUnique({
    where: {
      [adapter.invoiceIdField.name]: coerceByField(invoiceDbId, adapter.invoiceIdField),
    },
    include,
  });

  if (!invoice) {
    redirect(`/returns?q=${encodeURIComponent(searchQ)}&result=notfound`);
  }

  const rawItems = Array.isArray(invoice[adapter.invoiceItemsRelation.name])
    ? invoice[adapter.invoiceItemsRelation.name]
    : [];

  let refundAmount = 0;
  let extraAmount = 0;
  let processedRows = 0;

  for (const item of rawItems) {
    const itemId = String(getValue(item, [adapter.itemIdField?.name, "id"], ""));
    if (!itemId) continue;

    const returnQty = Math.max(0, toNumber(formData.get(`returnQty_${itemId}`)));
    if (returnQty <= 0) continue;

    const soldQty = toNumber(
      getValue(item, [adapter.itemQtyField?.name, "quantity", "qty"], 0)
    );
    const returnedQty = toNumber(
      getValue(
        item,
        [adapter.itemReturnedQtyField?.name, "returnedQty", "returnQty", "refundedQty"],
        0
      )
    );
    const remainingQty = Math.max(0, soldQty - returnedQty);

    if (returnQty > remainingQty) {
      redirect(`/returns?q=${encodeURIComponent(searchQ)}&result=qty_error`);
    }

    const unitPrice = toNumber(
      getValue(
        item,
        [adapter.itemUnitPriceField?.name, "sellPrice", "price", "unitPrice"],
        0
      )
    );

    const originalVariantId = getValue(
      item,
      [adapter.itemVariantIdField?.name, "variantId", "productVariantId"],
      null
    );

    if (
      adapter.variantModel &&
      adapter.variantIdField &&
      adapter.variantStockField &&
      originalVariantId !== null
    ) {
      await adapter.client[adapter.variantModel.delegate].update({
        where: {
          [adapter.variantIdField.name]: coerceByField(originalVariantId, adapter.variantIdField),
        },
        data: {
          [adapter.variantStockField.name]: {
            increment: returnQty,
          },
        },
      });
    }

    if (mode === "exchange") {
      const replacementId = String(formData.get(`replacement_${itemId}`) ?? "").trim();

      if (!replacementId) {
        redirect(`/returns?q=${encodeURIComponent(searchQ)}&result=replacement_required`);
      }

      if (
        !adapter.variantModel ||
        !adapter.variantIdField ||
        !adapter.variantStockField
      ) {
        redirect(`/returns?q=${encodeURIComponent(searchQ)}&result=config_error`);
      }

      const replacement = await adapter.client[adapter.variantModel.delegate].findUnique({
        where: {
          [adapter.variantIdField.name]: coerceByField(replacementId, adapter.variantIdField),
        },
      });

      if (!replacement) {
        redirect(`/returns?q=${encodeURIComponent(searchQ)}&result=replacement_notfound`);
      }

      const replacementStock = toNumber(
        getValue(
          replacement,
          [adapter.variantStockField.name, "stockQty", "qty", "stock"],
          0
        )
      );

      if (replacementStock < returnQty) {
        redirect(`/returns?q=${encodeURIComponent(searchQ)}&result=stock_error`);
      }

      await adapter.client[adapter.variantModel.delegate].update({
        where: {
          [adapter.variantIdField.name]: coerceByField(replacementId, adapter.variantIdField),
        },
        data: {
          [adapter.variantStockField.name]: {
            decrement: returnQty,
          },
        },
      });

      const replacementPrice = toNumber(
        getValue(
          replacement,
          [adapter.variantPriceField?.name, "sellPrice", "salePrice", "price"],
          unitPrice
        )
      );

      const thisRefund = unitPrice * returnQty;
      const thisReplacement = replacementPrice * returnQty;

      if (thisRefund >= thisReplacement) {
        refundAmount += thisRefund - thisReplacement;
      } else {
        extraAmount += thisReplacement - thisRefund;
      }
    } else {
      refundAmount += unitPrice * returnQty;
    }

    if (adapter.itemReturnedQtyField && adapter.itemIdField) {
      await adapter.client[adapter.itemModel.delegate].update({
        where: {
          [adapter.itemIdField.name]: coerceByField(itemId, adapter.itemIdField),
        },
        data: {
          [adapter.itemReturnedQtyField.name]: {
            increment: returnQty,
          },
        },
      });
    }

    processedRows += 1;
  }

  if (processedRows === 0) {
    redirect(`/returns?q=${encodeURIComponent(searchQ)}&result=empty`);
  }

  if (adapter.invoiceNotesField) {
    const oldNotes = String(
      getValue(invoice, [adapter.invoiceNotesField.name], "") ?? ""
    );

    const log = [
      `[مرتجع ${mode === "exchange" ? "استبدال" : "استرداد"}]`,
      `عدد العناصر: ${processedRows}`,
      `المبلغ المسترد: ${refundAmount}`,
      `المبلغ الإضافي: ${extraAmount}`,
      note ? `ملاحظة: ${note}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    await adapter.client[adapter.invoiceModel.delegate].update({
      where: {
        [adapter.invoiceIdField.name]: coerceByField(invoiceDbId, adapter.invoiceIdField),
      },
      data: {
        [adapter.invoiceNotesField.name]: [oldNotes, log].filter(Boolean).join("\n"),
      },
    });
  }

  revalidatePath("/returns");
  revalidatePath("/products");
  revalidatePath("/invoices");

  redirect(
    `/returns?q=${encodeURIComponent(searchQ)}&result=ok&refund=${encodeURIComponent(
      String(refundAmount)
    )}&extra=${encodeURIComponent(String(extraAmount))}`
  );
}

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams?: SearchParamsLike;
}) {
  await ensureLoggedIn();

  const params = await Promise.resolve(searchParams ?? {});
  const q = String(params?.q ?? "").trim();
  const result = String(params?.result ?? "").trim();
  const refund = toNumber(params?.refund);
  const extra = toNumber(params?.extra);

  const { invoice, replacements, recentInvoices } = await getInvoiceData(q);

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

        <div className="mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight">المرتجعات والاستبدال</h1>
          <p className="mt-2 text-sm text-white/60">
            بحث بالفاتورة، التحقق من الكميات، ثم تنفيذ استرداد أو استبدال بشكل منظم وواضح.
          </p>
        </div>

        {result === "ok" ? (
          <div className="mb-6 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-5">
            <div className="text-lg font-extrabold text-emerald-300">تم تنفيذ العملية بنجاح</div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-emerald-100/90">
              <span>المبلغ المسترد: {formatEGP(refund)}</span>
              <span>المبلغ الإضافي: {formatEGP(extra)}</span>
            </div>
          </div>
        ) : null}

        {[
          "qty_error",
          "stock_error",
          "replacement_required",
          "replacement_notfound",
          "empty",
          "config_error",
          "notfound",
        ].includes(result) ? (
          <div className="mb-6 rounded-3xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
            {result === "qty_error" && "الكمية المطلوبة أكبر من الكمية المتبقية القابلة للمرتجع."}
            {result === "stock_error" && "المخزون غير كافٍ في المنتج البديل."}
            {result === "replacement_required" && "يجب اختيار منتج بديل لكل عنصر في وضع الاستبدال."}
            {result === "replacement_notfound" && "المنتج البديل المحدد غير موجود."}
            {result === "empty" && "لم يتم تحديد أي كمية مرتجع."}
            {result === "config_error" && "تعذر تحميل عناصر الفاتورة بالشكل المطلوب من قاعدة البيانات الحالية."}
            {result === "notfound" && "الفاتورة غير موجودة."}
          </div>
        ) : null}

        <section className="mb-8 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
          <form method="GET" className="grid gap-4 lg:grid-cols-[1fr_auto]">
            <div>
              <label className="mb-2 block text-sm text-white/65">
                ابحث برقم الفاتورة أو الكود أو اسم العميل
              </label>
              <input
                name="q"
                defaultValue={q}
                placeholder="مثال: INV-102 أو 102"
                className="h-12 w-full rounded-2xl border border-white/10 bg-black/40 px-4 outline-none placeholder:text-white/35 focus:border-red-500/60"
              />
            </div>

            <button className="h-12 self-end rounded-2xl bg-red-600 px-6 text-sm font-extrabold transition hover:bg-red-500">
              بحث
            </button>
          </form>
        </section>

        {!q ? (
          <section className="mb-8 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-4">
              <h2 className="text-xl font-extrabold">آخر الفواتير</h2>
              <p className="mt-1 text-sm text-white/55">
                للوصول السريع إلى أحدث الفواتير قبل تنفيذ المرتجع أو الاستبدال.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {recentInvoices.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/30 p-5 text-sm text-white/45">
                  لا توجد فواتير بعد.
                </div>
              ) : (
                recentInvoices.map((inv) => (
                  <Link
                    key={inv.dbId}
                    href={`/returns?q=${encodeURIComponent(inv.publicId)}`}
                    className="rounded-2xl border border-white/10 bg-black/30 p-5 transition hover:border-red-500/40 hover:bg-white/[0.04]"
                  >
                    <div className="text-sm text-white/55">رقم الفاتورة</div>
                    <div className="mt-1 text-lg font-extrabold">{inv.publicId}</div>
                    <div className="mt-3 text-sm text-white/70">العميل: {inv.customer}</div>
                    <div className="mt-1 text-sm text-white/70">البائع: {inv.seller}</div>
                    <div className="mt-3 text-sm font-bold">{formatEGP(inv.total)}</div>
                    <div className="mt-2 text-xs text-white/45">{inv.dateText}</div>
                  </Link>
                ))
              )}
            </div>
          </section>
        ) : null}

        {invoice ? (
          <>
            <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="text-sm text-white/60">رقم الفاتورة</div>
                <div className="mt-2 break-all text-xl font-black">{invoice.publicId}</div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="text-sm text-white/60">العميل</div>
                <div className="mt-2 text-lg font-bold">{invoice.customer}</div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="text-sm text-white/60">البائع</div>
                <div className="mt-2 text-lg font-bold">{invoice.seller}</div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="text-sm text-white/60">إجمالي الفاتورة</div>
                <div className="mt-2 text-2xl font-black">{formatEGP(invoice.total)}</div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="text-sm text-white/60">الخصم / التاريخ</div>
                <div className="mt-2 text-sm font-bold text-white/85">
                  {formatEGP(invoice.discount)}
                  <div className="mt-1 text-white/55">{invoice.dateText}</div>
                </div>
              </div>
            </section>

            {!invoice.rawHasItemsRelation ? (
              <section className="rounded-[28px] border border-yellow-500/30 bg-yellow-500/10 p-6">
                <h2 className="text-lg font-extrabold text-yellow-300">تم العثور على الفاتورة لكن عناصرها غير محملة</h2>
                <p className="mt-2 text-sm text-yellow-100/85">
                  هذا معناه أن ربط عناصر الفاتورة في قاعدة البيانات مختلف عن التوقع داخل الصفحة الحالية.
                  الصفحة تحتاج Patch صغير مخصص حسب relation الفعلي لعناصر البيع داخل Prisma schema.
                </p>
              </section>
            ) : (
              <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
                <div className="mb-5">
                  <h2 className="text-xl font-extrabold">تنفيذ مرتجع أو استبدال</h2>
                  <p className="mt-1 text-sm text-white/55">
                    حدّد الكميات بدقة. النظام يتحقق من المتبقي ويحسب المسترد أو الفرق الإضافي.
                  </p>
                </div>

                <form action={processReturnAction} className="space-y-6">
                  <input type="hidden" name="invoiceDbId" value={invoice.dbId} />
                  <input type="hidden" name="searchQ" value={q} />

                  <div className="grid gap-4 lg:grid-cols-3">
                    <label className="rounded-2xl border border-white/10 bg-black/40 p-4">
                      <span className="mb-2 block text-sm text-white/65">نوع العملية</span>
                      <select
                        name="mode"
                        defaultValue="refund"
                        className="h-11 w-full rounded-xl border border-white/10 bg-black/50 px-4 outline-none focus:border-red-500/60"
                      >
                        <option value="refund" className="bg-black">
                          استرداد
                        </option>
                        <option value="exchange" className="bg-black">
                          استبدال
                        </option>
                      </select>
                    </label>

                    <label className="rounded-2xl border border-white/10 bg-black/40 p-4 lg:col-span-2">
                      <span className="mb-2 block text-sm text-white/65">ملاحظة داخلية</span>
                      <textarea
                        name="note"
                        rows={2}
                        placeholder="سبب المرتجع أو ملحوظة تشغيلية"
                        className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 outline-none placeholder:text-white/35 focus:border-red-500/60"
                      />
                    </label>
                  </div>

                  <div className="overflow-x-auto rounded-3xl border border-white/10">
                    <table className="min-w-[1200px] w-full text-right">
                      <thead className="bg-white/[0.03] text-sm text-white/70">
                        <tr>
                          <th className="px-4 py-4">العنصر</th>
                          <th className="px-4 py-4">سعر الوحدة</th>
                          <th className="px-4 py-4">المباع</th>
                          <th className="px-4 py-4">مرتجع سابق</th>
                          <th className="px-4 py-4">المتبقي</th>
                          <th className="px-4 py-4">كمية المرتجع</th>
                          <th className="px-4 py-4">المنتج البديل</th>
                        </tr>
                      </thead>

                      <tbody>
                        {invoice.items.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-16 text-center text-sm text-white/45">
                              لا توجد عناصر داخل هذه الفاتورة.
                            </td>
                          </tr>
                        ) : (
                          invoice.items.map((item) => (
                            <tr key={item.id} className="border-t border-white/10 align-top">
                              <td className="px-4 py-4">
                                <div className="font-bold">{item.title}</div>
                              </td>

                              <td className="px-4 py-4">{formatEGP(item.unitPrice)}</td>
                              <td className="px-4 py-4 font-bold">{item.soldQty}</td>
                              <td className="px-4 py-4 text-white/65">{item.returnedQty}</td>
                              <td className="px-4 py-4">
                                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">
                                  {item.remainingQty}
                                </span>
                              </td>

                              <td className="px-4 py-4">
                                <input
                                  name={`returnQty_${item.id}`}
                                  type="number"
                                  min="0"
                                  max={item.remainingQty}
                                  defaultValue={0}
                                  className="h-11 w-28 rounded-xl border border-white/10 bg-black/40 px-3 outline-none focus:border-red-500/60"
                                />
                              </td>

                              <td className="px-4 py-4">
                                <select
                                  name={`replacement_${item.id}`}
                                  defaultValue=""
                                  className="h-11 min-w-[340px] rounded-xl border border-white/10 bg-black/40 px-3 outline-none focus:border-red-500/60"
                                >
                                  <option value="" className="bg-black">
                                    اختر بديلًا عند الاستبدال
                                  </option>

                                  {replacements.map((variant) => (
                                    <option key={variant.id} value={variant.id} className="bg-black">
                                      {variant.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-end">
                    <button className="h-12 rounded-2xl bg-red-600 px-8 text-sm font-extrabold transition hover:bg-red-500">
                      تنفيذ العملية
                    </button>
                  </div>
                </form>
              </section>
            )}
          </>
        ) : q ? (
          <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-10 text-center">
            <div className="text-lg font-extrabold">لا توجد فاتورة مطابقة</div>
            <p className="mt-2 text-sm text-white/55">جرّب رقم أو كود مختلف.</p>
          </section>
        ) : null}
      </div>
    </main>
  );
}