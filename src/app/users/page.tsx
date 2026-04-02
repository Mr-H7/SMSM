import { prisma } from "@/lib/prisma";
import * as rbac from "@/lib/rbac";
import { hashPassword } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import Link from "next/link";

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

function normalize(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function lowerCamel(value: string) {
  return value.length ? value[0].toLowerCase() + value.slice(1) : value;
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

  const userIdField =
    pickField(userModel, ["id", "userId"]) ??
    userModel?.fields.find((f) => f.isId) ??
    null;

  return {
    client,
    userModel,
    userIdField,
    usernameField: pickField(userModel, ["username", "name", "fullName"]),
    fullNameField: pickField(userModel, ["fullName"]),
    passwordField: pickField(userModel, ["passwordHash", "password", "hash"]),
    roleField: pickField(userModel, ["role", "userRole"]),
    activeField: pickField(userModel, ["isActive", "active", "enabled"]),
    createdAtField: pickField(userModel, ["createdAt"]),
  };
}

async function createUserAction(formData: FormData) {
  "use server";

  await ensureOwner();

  const adapter = getAdapter();
  if (!adapter.userModel) return;

  const username = String(formData.get("username") ?? "").trim();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const role = String(formData.get("role") ?? "SELLER").trim().toUpperCase();

  if (!username || !password || (role !== "SELLER" && role !== "OWNER")) return;

  const existing = await adapter.client[adapter.userModel.delegate].findFirst({
    where: adapter.usernameField
      ? { [adapter.usernameField.name]: username }
      : undefined,
  });

  if (existing) {
    revalidatePath("/users");
    return;
  }

  const passwordHash = await hashPassword(password);

  const data: Record<string, any> = {};
  if (adapter.usernameField) data[adapter.usernameField.name] = username;
  if (adapter.fullNameField) data[adapter.fullNameField.name] = fullName || null;
  if (adapter.passwordField) data[adapter.passwordField.name] = passwordHash;
  if (adapter.roleField) data[adapter.roleField.name] = role;
  if (adapter.activeField) data[adapter.activeField.name] = true;

  await adapter.client[adapter.userModel.delegate].create({ data });
  revalidatePath("/users");
}

async function toggleUserAction(formData: FormData) {
  "use server";

  await ensureOwner();

  const adapter = getAdapter();
  if (!adapter.userModel || !adapter.userIdField || !adapter.activeField) return;

  const userId = String(formData.get("userId") ?? "").trim();
  const nextActive = String(formData.get("nextActive") ?? "false") === "true";

  if (!userId) return;

  const current = await adapter.client[adapter.userModel.delegate].findUnique({
    where: {
      [adapter.userIdField.name]: coerceByField(userId, adapter.userIdField),
    },
  });

  if (!current) return;

  const role = String(getValue(current, [adapter.roleField?.name, "role"], "")).toUpperCase();
  const username = String(getValue(current, [adapter.usernameField?.name, "username"], ""));

  if (role === "OWNER" && username === "SMSM" && nextActive === false) {
    revalidatePath("/users");
    return;
  }

  await adapter.client[adapter.userModel.delegate].update({
    where: {
      [adapter.userIdField.name]: coerceByField(userId, adapter.userIdField),
    },
    data: {
      [adapter.activeField.name]: nextActive,
    },
  });

  revalidatePath("/users");
}

async function resetPasswordAction(formData: FormData) {
  "use server";

  await ensureOwner();

  const adapter = getAdapter();
  if (!adapter.userModel || !adapter.userIdField || !adapter.passwordField) return;

  const userId = String(formData.get("userId") ?? "").trim();
  const newPassword = String(formData.get("newPassword") ?? "").trim();

  if (!userId || !newPassword) return;

  const passwordHash = await hashPassword(newPassword);

  await adapter.client[adapter.userModel.delegate].update({
    where: {
      [adapter.userIdField.name]: coerceByField(userId, adapter.userIdField),
    },
    data: {
      [adapter.passwordField.name]: passwordHash,
    },
  });

  revalidatePath("/users");
}

export default async function UsersPage() {
  await ensureOwner();

  const adapter = getAdapter();
  const users =
    adapter.userModel
      ? await adapter.client[adapter.userModel.delegate].findMany({
          orderBy: adapter.createdAtField?.name
            ? { [adapter.createdAtField.name]: "desc" }
            : undefined,
        })
      : [];

  const mapped = (Array.isArray(users) ? users : []).map((user: any) => {
    const role = String(
      getValue(user, [adapter.roleField?.name, "role", "userRole"], "")
    ).toUpperCase();

    return {
      id: String(getValue(user, [adapter.userIdField?.name, "id"], "")),
      username: String(
        getValue(user, [adapter.usernameField?.name, "username", "name"], "-")
      ),
      fullName: String(getValue(user, [adapter.fullNameField?.name, "fullName"], "")),
      role,
      isActive: Boolean(
        getValue(user, [adapter.activeField?.name, "isActive", "active"], true)
      ),
      createdAt: (() => {
        const d = getValue(user, [adapter.createdAtField?.name, "createdAt"], null);
        return d ? new Date(d).toLocaleString("ar-EG") : "-";
      })(),
    };
  });

  const owners = mapped.filter((u) => u.role === "OWNER").length;
  const sellers = mapped.filter((u) => u.role === "SELLER").length;
  const activeUsers = mapped.filter((u) => u.isActive).length;
  const inactiveUsers = mapped.filter((u) => !u.isActive).length;

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
          <h1 className="text-3xl font-extrabold tracking-tight">إدارة المستخدمين</h1>
          <p className="mt-2 text-sm text-white/60">
            صفحة مالك فقط لإنشاء الحسابات وإدارة التفعيل وإعادة تعيين كلمات المرور والصلاحيات.
          </p>
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-white/60">إجمالي المستخدمين</div>
            <div className="mt-3 text-3xl font-black">{mapped.length}</div>
          </div>

          <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-5">
            <div className="text-sm text-red-100/80">المالكون</div>
            <div className="mt-3 text-3xl font-black text-red-300">{owners}</div>
          </div>

          <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-5">
            <div className="text-sm text-emerald-100/80">البائعون</div>
            <div className="mt-3 text-3xl font-black text-emerald-300">{sellers}</div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-white/60">نشط / غير نشط</div>
            <div className="mt-3 text-3xl font-black">
              {activeUsers} / {inactiveUsers}
            </div>
          </div>
        </div>

        <section className="mb-8 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
          <div className="mb-5">
            <h2 className="text-xl font-extrabold">إنشاء مستخدم جديد</h2>
            <p className="mt-1 text-sm text-white/55">
              يمكنك إنشاء بائع أو مالك جديد بنفس صلاحيات المالك الحالي.
            </p>
          </div>

          <form action={createUserAction} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="rounded-2xl border border-white/10 bg-black/40 p-4">
              <span className="mb-2 block text-sm text-white/65">اسم المستخدم</span>
              <input
                name="username"
                required
                placeholder="اسم الحساب"
                className="h-11 w-full rounded-xl border border-white/10 bg-black/50 px-4 outline-none placeholder:text-white/35 focus:border-red-500/60"
              />
            </label>

            <label className="rounded-2xl border border-white/10 bg-black/40 p-4">
              <span className="mb-2 block text-sm text-white/65">الاسم الكامل</span>
              <input
                name="fullName"
                placeholder="الاسم الكامل"
                className="h-11 w-full rounded-xl border border-white/10 bg-black/50 px-4 outline-none placeholder:text-white/35 focus:border-red-500/60"
              />
            </label>

            <label className="rounded-2xl border border-white/10 bg-black/40 p-4">
              <span className="mb-2 block text-sm text-white/65">كلمة المرور</span>
              <input
                name="password"
                type="password"
                required
                placeholder="كلمة المرور"
                className="h-11 w-full rounded-xl border border-white/10 bg-black/50 px-4 outline-none placeholder:text-white/35 focus:border-red-500/60"
              />
            </label>

            <label className="rounded-2xl border border-white/10 bg-black/40 p-4">
              <span className="mb-2 block text-sm text-white/65">الدور</span>
              <select
                name="role"
                defaultValue="SELLER"
                className="h-11 w-full rounded-xl border border-white/10 bg-black/50 px-4 outline-none focus:border-red-500/60"
              >
                <option value="SELLER" className="bg-black">
                  بائع
                </option>
                <option value="OWNER" className="bg-black">
                  مالك
                </option>
              </select>
            </label>

            <div className="md:col-span-2 xl:col-span-4">
              <button className="h-11 w-full rounded-xl bg-red-600 px-6 text-sm font-extrabold transition hover:bg-red-500">
                إنشاء المستخدم
              </button>
            </div>
          </form>
        </section>

        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03]">
          <div className="border-b border-white/10 px-5 py-4">
            <h2 className="text-lg font-extrabold">قائمة المستخدمين</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[1200px] w-full text-right">
              <thead className="bg-white/[0.03] text-sm text-white/70">
                <tr>
                  <th className="px-4 py-4">اسم المستخدم</th>
                  <th className="px-4 py-4">الاسم الكامل</th>
                  <th className="px-4 py-4">الدور</th>
                  <th className="px-4 py-4">الحالة</th>
                  <th className="px-4 py-4">تاريخ الإنشاء</th>
                  <th className="px-4 py-4">إعادة تعيين كلمة المرور</th>
                  <th className="px-4 py-4">الإجراءات</th>
                </tr>
              </thead>

              <tbody>
                {mapped.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-16 text-center text-sm text-white/45">
                      لا يوجد مستخدمون.
                    </td>
                  </tr>
                ) : (
                  mapped.map((user) => {
                    const isOwner = user.role === "OWNER";
                    const isMainOwner = user.username === "SMSM" && isOwner;

                    return (
                      <tr key={user.id} className="border-t border-white/10 align-top">
                        <td className="px-4 py-4 font-bold">{user.username}</td>
                        <td className="px-4 py-4 text-white/75">{user.fullName || "-"}</td>

                        <td className="px-4 py-4">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-bold ${
                              isOwner
                                ? "bg-red-600/20 text-red-200"
                                : "bg-white/10 text-white/80"
                            }`}
                          >
                            {isOwner ? "مالك" : "بائع"}
                          </span>
                        </td>

                        <td className="px-4 py-4">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-bold ${
                              user.isActive
                                ? "bg-emerald-500/20 text-emerald-200"
                                : "bg-white/10 text-white/70"
                            }`}
                          >
                            {user.isActive ? "نشط" : "غير نشط"}
                          </span>
                        </td>

                        <td className="px-4 py-4 text-white/65">{user.createdAt}</td>

                        <td className="px-4 py-4">
                          {!isMainOwner ? (
                            <form action={resetPasswordAction} className="flex gap-2">
                              <input type="hidden" name="userId" value={user.id} />
                              <input
                                name="newPassword"
                                type="password"
                                required
                                placeholder="كلمة مرور جديدة"
                                className="h-10 w-48 rounded-xl border border-white/10 bg-black/40 px-3 text-sm outline-none placeholder:text-white/35 focus:border-red-500/60"
                              />
                              <button className="h-10 rounded-xl bg-white/10 px-4 text-xs font-bold hover:bg-white/15">
                                حفظ
                              </button>
                            </form>
                          ) : (
                            <span className="text-sm text-white/35">محمي</span>
                          )}
                        </td>

                        <td className="px-4 py-4">
                          {!isMainOwner ? (
                            <form action={toggleUserAction}>
                              <input type="hidden" name="userId" value={user.id} />
                              <input
                                type="hidden"
                                name="nextActive"
                                value={String(!user.isActive)}
                              />
                              <button
                                className={`h-10 rounded-xl px-4 text-xs font-bold ${
                                  user.isActive
                                    ? "bg-yellow-500/20 text-yellow-200 hover:bg-yellow-500/30"
                                    : "bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
                                }`}
                              >
                                {user.isActive ? "تعطيل الحساب" : "تفعيل الحساب"}
                              </button>
                            </form>
                          ) : (
                            <span className="text-sm text-white/35">ثابت</span>
                          )}
                        </td>
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