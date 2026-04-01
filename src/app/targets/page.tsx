import { prisma } from "@/lib/prisma";
import * as rbac from "@/lib/rbac";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

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

type SellerCard = {
  id: string;
  name: string;
  dailyTarget: number;
  monthlyTarget: number;
  todaySales: number;
  monthSales: number;
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

function getStartOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function getStartOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

async function ensureOwner() {
  const requireOwner = (rbac as any).requireOwner;
  if (typeof requireOwner === "function") {
    await requireOwner();
    return;
  }

  const requireUser = (rbac as any).requireUser;
  if (typeof requireUser === "function") {
    const user = await requireUser();
    const role = String(user?.role ?? user?.userRole ?? "").toUpperCase();
    if (role !== "OWNER") {
      throw new Error("غير مصرح");
    }
    return;
  }

  throw new Error("غير مصرح");
}

function getAdapter() {
  const client: any = prisma as any;

  const userModel = findModelInfo(client, ["User", "AppUser"]);
  const invoiceModel = findModelInfo(client, ["Invoice", "Sale", "SalesInvoice", "Order"]);
  const targetModel = findModelInfo(client, ["Target", "SalesTarget", "SellerTarget", "Goal"]);

  const userIdField =
    pickField(userModel, ["id", "userId"]) ??
    userModel?.fields.find((f) => f.isId) ??
    null;

  const invoiceIdField =
    pickField(invoiceModel, ["id", "invoiceId"]) ??
    invoiceModel?.fields.find((f) => f.isId) ??
    null;

  const targetIdField =
    pickField(targetModel, ["id", "targetId"]) ??
    targetModel?.fields.find((f) => f.isId) ??
    null;

  const invoiceSellerRelation = pickRelation(invoiceModel, userModel?.name ?? null);

  return {
    client,
    userModel,
    invoiceModel,
    targetModel,

    userIdField,
    invoiceIdField,
    targetIdField,
    invoiceSellerRelation,

    userNameField: pickField(userModel, ["username", "name", "fullName"]),
    userRoleField: pickField(userModel, ["role", "userRole"]),
    userActiveField: pickField(userModel, ["isActive", "active", "enabled"]),
    userDailyTargetField: pickField(userModel, ["dailyTarget"]),
    userMonthlyTargetField: pickField(userModel, ["monthlyTarget"]),

    invoiceTotalField: pickField(invoiceModel, [
      "total",
      "netTotal",
      "finalTotal",
      "grandTotal",
    ]),
    invoiceDateField: pickField(invoiceModel, [
      "createdAt",
      "issuedAt",
      "date",
      "invoiceDate",
    ]),
    invoiceStatusField: pickField(invoiceModel, ["status", "paymentStatus"]),
    invoiceSellerIdField: pickField(invoiceModel, [
      "sellerId",
      "userId",
      "createdById",
      "ownerId",
    ]),

    targetUserIdField: pickField(targetModel, ["userId", "sellerId", "ownerId"]),
    targetDailyField: pickField(targetModel, ["dailyTarget", "dayTarget", "targetDaily"]),
    targetMonthlyField: pickField(targetModel, [
      "monthlyTarget",
      "monthTarget",
      "targetMonthly",
    ]),
    targetGlobalField: pickField(targetModel, ["isGlobal", "global"]),
    targetNameField: pickField(targetModel, ["name", "key", "title"]),
  };
}

async function saveTargetsAction(formData: FormData) {
  "use server";

  await ensureOwner();

  const adapter = getAdapter();

  const globalDaily = Math.max(0, toNumber(formData.get("globalDaily")));
  const globalMonthly = Math.max(0, toNumber(formData.get("globalMonthly")));

  if (adapter.targetModel) {
    const whereGlobal: Record<string, any> = {};

    if (adapter.targetGlobalField) {
      whereGlobal[adapter.targetGlobalField.name] = true;
    } else if (adapter.targetNameField) {
      whereGlobal[adapter.targetNameField.name] = "GLOBAL";
    }

    const existingGlobal = await adapter.client[adapter.targetModel.delegate].findFirst({
      where: whereGlobal,
    });

    const globalData: Record<string, any> = {};
    if (adapter.targetDailyField) globalData[adapter.targetDailyField.name] = globalDaily;
    if (adapter.targetMonthlyField) globalData[adapter.targetMonthlyField.name] = globalMonthly;
    if (adapter.targetGlobalField) globalData[adapter.targetGlobalField.name] = true;
    if (adapter.targetNameField) globalData[adapter.targetNameField.name] = "GLOBAL";

    if (existingGlobal && adapter.targetIdField) {
      await adapter.client[adapter.targetModel.delegate].update({
        where: {
          [adapter.targetIdField.name]: coerceByField(
            getValue(existingGlobal, [adapter.targetIdField.name, "id"], ""),
            adapter.targetIdField
          ),
        },
        data: globalData,
      });
    } else if (Object.keys(globalData).length > 0) {
      await adapter.client[adapter.targetModel.delegate].create({
        data: globalData,
      });
    }
  }

  const sellerIds = String(formData.get("sellerIds") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  for (const sellerId of sellerIds) {
    const daily = Math.max(0, toNumber(formData.get(`daily_${sellerId}`)));
    const monthly = Math.max(0, toNumber(formData.get(`monthly_${sellerId}`)));

    if (adapter.targetModel && adapter.targetUserIdField) {
      const existing = await adapter.client[adapter.targetModel.delegate].findFirst({
        where: {
          [adapter.targetUserIdField.name]: coerceByField(sellerId, adapter.userIdField),
        },
      });

      const data: Record<string, any> = {
        [adapter.targetUserIdField.name]: coerceByField(sellerId, adapter.userIdField),
      };

      if (adapter.targetDailyField) data[adapter.targetDailyField.name] = daily;
      if (adapter.targetMonthlyField) data[adapter.targetMonthlyField.name] = monthly;
      if (adapter.targetGlobalField) data[adapter.targetGlobalField.name] = false;

      if (existing && adapter.targetIdField) {
        await adapter.client[adapter.targetModel.delegate].update({
          where: {
            [adapter.targetIdField.name]: coerceByField(
              getValue(existing, [adapter.targetIdField.name, "id"], ""),
              adapter.targetIdField
            ),
          },
          data,
        });
      } else {
        await adapter.client[adapter.targetModel.delegate].create({ data });
      }
    } else if (adapter.userModel) {
      const data: Record<string, any> = {};
      if (adapter.userDailyTargetField) data[adapter.userDailyTargetField.name] = daily;
      if (adapter.userMonthlyTargetField) data[adapter.userMonthlyTargetField.name] = monthly;

      if (Object.keys(data).length && adapter.userIdField) {
        await adapter.client[adapter.userModel.delegate].update({
          where: {
            [adapter.userIdField.name]: coerceByField(sellerId, adapter.userIdField),
          },
          data,
        });
      }
    }
  }

  revalidatePath("/targets");
}

async function loadPageData() {
  const adapter = getAdapter();

  const sellers: any[] =
    adapter.userModel
      ? await adapter.client[adapter.userModel.delegate].findMany({
          where: {
            ...(adapter.userRoleField ? { [adapter.userRoleField.name]: "SELLER" } : {}),
          },
          orderBy: adapter.userNameField?.name
            ? { [adapter.userNameField.name]: "asc" }
            : undefined,
        })
      : [];

  let globalDaily = 0;
  let globalMonthly = 0;
  const targetMap = new Map<string, { daily: number; monthly: number }>();

  if (adapter.targetModel) {
    const targets = await adapter.client[adapter.targetModel.delegate].findMany();

    for (const target of Array.isArray(targets) ? targets : []) {
      const isGlobal = Boolean(
        getValue(target, [adapter.targetGlobalField?.name], false)
      );
      const daily = toNumber(
        getValue(target, [adapter.targetDailyField?.name, "dailyTarget"], 0)
      );
      const monthly = toNumber(
        getValue(target, [adapter.targetMonthlyField?.name, "monthlyTarget"], 0)
      );

      if (isGlobal || getValue(target, [adapter.targetNameField?.name], "") === "GLOBAL") {
        globalDaily = daily;
        globalMonthly = monthly;
      }

      const userId = getValue(target, [adapter.targetUserIdField?.name], null);
      if (userId !== null && userId !== undefined && userId !== "") {
        targetMap.set(String(userId), { daily, monthly });
      }
    }
  }

  const allInvoices: any[] =
    adapter.invoiceModel
      ? await adapter.client[adapter.invoiceModel.delegate].findMany({
          where: adapter.invoiceDateField
            ? {
                [adapter.invoiceDateField.name]: {
                  gte: getStartOfMonth(),
                },
              }
            : undefined,
          ...(adapter.invoiceSellerRelation?.name
            ? { include: { [adapter.invoiceSellerRelation.name]: true } }
            : {}),
        })
      : [];

  const todayStart = getStartOfToday();
  const monthStart = getStartOfMonth();

  const cards: SellerCard[] = sellers.map((seller) => {
    const sellerId = String(getValue(seller, [adapter.userIdField?.name, "id"], ""));
    const sellerName = String(
      getValue(seller, [adapter.userNameField?.name, "username", "name"], "-")
    );

    const savedTarget = targetMap.get(sellerId);

    const dailyTarget =
      savedTarget?.daily ??
      toNumber(getValue(seller, [adapter.userDailyTargetField?.name, "dailyTarget"], globalDaily));

    const monthlyTarget =
      savedTarget?.monthly ??
      toNumber(
        getValue(seller, [adapter.userMonthlyTargetField?.name, "monthlyTarget"], globalMonthly)
      );

    const sellerInvoices = allInvoices.filter((invoice) => {
      if (adapter.invoiceSellerRelation?.name && invoice[adapter.invoiceSellerRelation.name]) {
        const relId = String(
          getValue(invoice[adapter.invoiceSellerRelation.name], [adapter.userIdField?.name, "id"], "")
        );
        return relId === sellerId;
      }

      if (adapter.invoiceSellerIdField) {
        const raw = String(
          getValue(invoice, [adapter.invoiceSellerIdField.name, "sellerId", "userId"], "")
        );
        return raw === sellerId;
      }

      return false;
    });

    const todaySales = sellerInvoices
      .filter((invoice) => {
        const d = getValue(
          invoice,
          [adapter.invoiceDateField?.name, "createdAt", "issuedAt", "date"],
          null
        );
        return d ? new Date(d) >= todayStart : false;
      })
      .reduce(
        (sum, invoice) =>
          sum +
          toNumber(
            getValue(invoice, [adapter.invoiceTotalField?.name, "total", "finalTotal"], 0)
          ),
        0
      );

    const monthSales = sellerInvoices
      .filter((invoice) => {
        const d = getValue(
          invoice,
          [adapter.invoiceDateField?.name, "createdAt", "issuedAt", "date"],
          null
        );
        return d ? new Date(d) >= monthStart : false;
      })
      .reduce(
        (sum, invoice) =>
          sum +
          toNumber(
            getValue(invoice, [adapter.invoiceTotalField?.name, "total", "finalTotal"], 0)
          ),
        0
      );

    return {
      id: sellerId,
      name: sellerName,
      dailyTarget,
      monthlyTarget,
      todaySales,
      monthSales,
    };
  });

  return {
    globalDaily,
    globalMonthly,
    cards,
  };
}

function pct(value: number, target: number) {
  if (!target || target <= 0) return 0;
  return Math.min(100, Math.round((value / target) * 100));
}

export default async function TargetsPage() {
  await ensureOwner();

  const { globalDaily, globalMonthly, cards } = await loadPageData();

  const totalTodaySales = cards.reduce((sum, c) => sum + c.todaySales, 0);
  const totalMonthSales = cards.reduce((sum, c) => sum + c.monthSales, 0);
  const totalDailyTarget =
    cards.reduce((sum, c) => sum + c.dailyTarget, 0) || globalDaily;
  const totalMonthlyTarget =
    cards.reduce((sum, c) => sum + c.monthlyTarget, 0) || globalMonthly;

  return (
    <main dir="rtl" className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight">إدارة التارجت</h1>
          <p className="mt-2 text-sm text-white/60">
            صفحة مالك فقط لإدارة التارجت اليومي والشهري ومتابعة أداء البائعين بالمبيعات فقط.
          </p>
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-white/60">إجمالي مبيعات اليوم</div>
            <div className="mt-3 text-3xl font-black">{formatEGP(totalTodaySales)}</div>
          </div>

          <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-5">
            <div className="text-sm text-emerald-100/80">إجمالي مبيعات الشهر</div>
            <div className="mt-3 text-3xl font-black text-emerald-300">
              {formatEGP(totalMonthSales)}
            </div>
          </div>

          <div className="rounded-3xl border border-yellow-500/20 bg-yellow-500/10 p-5">
            <div className="text-sm text-yellow-100/80">التارجت اليومي الإجمالي</div>
            <div className="mt-3 text-3xl font-black text-yellow-300">
              {formatEGP(totalDailyTarget)}
            </div>
          </div>

          <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-5">
            <div className="text-sm text-red-100/80">التارجت الشهري الإجمالي</div>
            <div className="mt-3 text-3xl font-black text-red-300">
              {formatEGP(totalMonthlyTarget)}
            </div>
          </div>
        </div>

        <section className="mb-8 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
          <div className="mb-5">
            <h2 className="text-xl font-extrabold">إعدادات التارجت</h2>
            <p className="mt-1 text-sm text-white/55">
              يمكن تحديد تارجت عام للمحل، ثم تخصيص تارجت مستقل لكل بائع.
            </p>
          </div>

          <form action={saveTargetsAction} className="space-y-6">
            <input type="hidden" name="sellerIds" value={cards.map((c) => c.id).join(",")} />

            <div className="grid gap-4 md:grid-cols-2">
              <label className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <span className="mb-2 block text-sm text-white/65">التارجت اليومي العام</span>
                <input
                  name="globalDaily"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={globalDaily}
                  className="h-11 w-full rounded-xl border border-white/10 bg-black/50 px-4 outline-none focus:border-red-500/60"
                />
              </label>

              <label className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <span className="mb-2 block text-sm text-white/65">التارجت الشهري العام</span>
                <input
                  name="globalMonthly"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={globalMonthly}
                  className="h-11 w-full rounded-xl border border-white/10 bg-black/50 px-4 outline-none focus:border-red-500/60"
                />
              </label>
            </div>

            <div className="overflow-x-auto rounded-3xl border border-white/10">
              <table className="min-w-[1100px] w-full text-right">
                <thead className="bg-white/[0.03] text-sm text-white/70">
                  <tr>
                    <th className="px-4 py-4">البائع</th>
                    <th className="px-4 py-4">تارجت يومي</th>
                    <th className="px-4 py-4">تارجت شهري</th>
                    <th className="px-4 py-4">مبيعات اليوم</th>
                    <th className="px-4 py-4">مبيعات الشهر</th>
                    <th className="px-4 py-4">تقدّم اليوم</th>
                    <th className="px-4 py-4">تقدّم الشهر</th>
                  </tr>
                </thead>

                <tbody>
                  {cards.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-16 text-center text-sm text-white/45">
                        لا يوجد بائعون حتى الآن.
                      </td>
                    </tr>
                  ) : (
                    cards.map((card) => {
                      const dayPct = pct(card.todaySales, card.dailyTarget);
                      const monthPct = pct(card.monthSales, card.monthlyTarget);

                      return (
                        <tr key={card.id} className="border-t border-white/10 align-top">
                          <td className="px-4 py-4 font-bold">{card.name}</td>

                          <td className="px-4 py-4">
                            <input
                              name={`daily_${card.id}`}
                              type="number"
                              min="0"
                              step="0.01"
                              defaultValue={card.dailyTarget}
                              className="h-11 w-40 rounded-xl border border-white/10 bg-black/40 px-3 outline-none focus:border-red-500/60"
                            />
                          </td>

                          <td className="px-4 py-4">
                            <input
                              name={`monthly_${card.id}`}
                              type="number"
                              min="0"
                              step="0.01"
                              defaultValue={card.monthlyTarget}
                              className="h-11 w-40 rounded-xl border border-white/10 bg-black/40 px-3 outline-none focus:border-red-500/60"
                            />
                          </td>

                          <td className="px-4 py-4">{formatEGP(card.todaySales)}</td>
                          <td className="px-4 py-4">{formatEGP(card.monthSales)}</td>

                          <td className="px-4 py-4">
                            <div className="w-48">
                              <div className="mb-2 flex items-center justify-between text-xs text-white/65">
                                <span>{dayPct}%</span>
                                <span>{formatEGP(card.dailyTarget)}</span>
                              </div>
                              <div className="h-3 rounded-full bg-white/10">
                                <div
                                  className="h-3 rounded-full bg-red-600"
                                  style={{ width: `${dayPct}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-4">
                            <div className="w-48">
                              <div className="mb-2 flex items-center justify-between text-xs text-white/65">
                                <span>{monthPct}%</span>
                                <span>{formatEGP(card.monthlyTarget)}</span>
                              </div>
                              <div className="h-3 rounded-full bg-white/10">
                                <div
                                  className="h-3 rounded-full bg-emerald-500"
                                  style={{ width: `${monthPct}%` }}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <button className="h-12 rounded-2xl bg-red-600 px-8 text-sm font-extrabold transition hover:bg-red-500">
                حفظ التارجت
              </button>
            </div>
          </form>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const dayPct = pct(card.todaySales, card.dailyTarget);
            const monthPct = pct(card.monthSales, card.monthlyTarget);

            return (
              <div
                key={`card-${card.id}`}
                className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5"
              >
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-extrabold">{card.name}</h3>
                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/70">
                    بائع
                  </span>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="text-white/65">مبيعات اليوم</span>
                      <span className="font-bold">{formatEGP(card.todaySales)}</span>
                    </div>
                    <div className="h-3 rounded-full bg-white/10">
                      <div
                        className="h-3 rounded-full bg-red-600"
                        style={{ width: `${dayPct}%` }}
                      />
                    </div>
                    <div className="mt-2 text-xs text-white/50">
                      الهدف: {formatEGP(card.dailyTarget)} — {dayPct}%
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="text-white/65">مبيعات الشهر</span>
                      <span className="font-bold">{formatEGP(card.monthSales)}</span>
                    </div>
                    <div className="h-3 rounded-full bg-white/10">
                      <div
                        className="h-3 rounded-full bg-emerald-500"
                        style={{ width: `${monthPct}%` }}
                      />
                    </div>
                    <div className="mt-2 text-xs text-white/50">
                      الهدف: {formatEGP(card.monthlyTarget)} — {monthPct}%
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}