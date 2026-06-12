import CommandShell from "@/components/CommandShell";
import { BackToDashboard, MetricCard, PageHeader, ProgressBar, StatusBadge } from "@/components/CommandUI";
import { hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

async function createUserAction(formData: FormData) {
  "use server";

  await requireOwner();

  const username = String(formData.get("username") ?? "").trim();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const role = String(formData.get("role") ?? "SELLER").trim().toUpperCase();

  if (!username || !password || (role !== "SELLER" && role !== "OWNER")) return;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return;

  await prisma.user.create({
    data: {
      username,
      fullName: fullName || null,
      passwordHash: hashPassword(password),
      role: role as "SELLER" | "OWNER",
      isActive: true,
    },
  });

  revalidatePath("/users");
}

async function toggleUserAction(formData: FormData) {
  "use server";

  await requireOwner();

  const userId = String(formData.get("userId") ?? "").trim();
  const nextActive = String(formData.get("nextActive") ?? "false") === "true";
  if (!userId) return;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  if (user.role === "OWNER" && user.username === "SMSM" && nextActive === false) return;

  await prisma.user.update({ where: { id: userId }, data: { isActive: nextActive } });
  revalidatePath("/users");
}

async function resetPasswordAction(formData: FormData) {
  "use server";

  await requireOwner();

  const userId = String(formData.get("userId") ?? "").trim();
  const newPassword = String(formData.get("newPassword") ?? "").trim();
  if (!userId || !newPassword) return;

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: hashPassword(newPassword) },
  });

  revalidatePath("/users");
}

export default async function UsersPage() {
  const owner = await requireOwner();
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });

  const owners = users.filter((user) => user.role === "OWNER").length;
  const sellers = users.filter((user) => user.role === "SELLER").length;
  const activeUsers = users.filter((user) => user.isActive).length;
  const activePct = users.length ? Math.round((activeUsers / users.length) * 100) : 0;

  return (
    <CommandShell active="users" user={owner}>
      <div className="mx-auto max-w-7xl space-y-8">
        <PageHeader
          eyebrow="إدارة الصلاحيات"
          title="المستخدمون"
          description="دليل الموظفين الفعلي: إنشاء الحسابات، متابعة الأدوار، تفعيل أو تعطيل البائعين، وإعادة تعيين كلمات المرور بدون عرض أي كلمة مرور."
          actions={<BackToDashboard />}
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="إجمالي المستخدمين" value={users.length} meta="حسابات مسجلة في النظام" tone="red" />
          <MetricCard label="المالكون" value={owners} meta="صلاحيات كاملة" />
          <MetricCard label="البائعون" value={sellers} meta="تشغيل البيع والفواتير" tone="blue" />
          <MetricCard label="نسبة النشاط" value={`${activePct}%`} meta={`${activeUsers} نشط من ${users.length}`} tone="red" />
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <div className="command-panel-high p-5 xl:col-span-2">
            <div className="command-label">إنشاء حساب</div>
            <h2 className="mt-2 text-xl font-black text-white">مستخدم جديد</h2>
            <form action={createUserAction} className="mt-5 grid gap-3 md:grid-cols-2">
              <input name="username" required placeholder="اسم المستخدم" className="command-input h-12 px-4 text-sm placeholder:text-white/30" />
              <input name="fullName" placeholder="الاسم الكامل" className="command-input h-12 px-4 text-sm placeholder:text-white/30" />
              <input name="password" type="password" required placeholder="كلمة المرور" className="command-input h-12 px-4 text-sm placeholder:text-white/30" />
              <select name="role" defaultValue="SELLER" className="command-input h-12 px-4 text-sm">
                <option value="SELLER" className="bg-[#201f1f]">بائع</option>
                <option value="OWNER" className="bg-[#201f1f]">مالك</option>
              </select>
              <button className="command-primary h-12 text-xs font-black uppercase tracking-[0.12em] md:col-span-2">
                إنشاء المستخدم
              </button>
            </form>
          </div>

          <div className="command-panel-high p-5">
            <div className="command-label">نبض الصلاحيات</div>
            <h2 className="mt-2 text-xl font-black text-white">حالة النظام</h2>
            <div className="mt-6 space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-white/60">الحسابات النشطة</span>
                  <span className="font-black text-white">{activePct}%</span>
                </div>
                <ProgressBar value={activePct} tone="red" />
              </div>
              <div className="bg-black/20 p-4 text-sm leading-6 text-white/58">
                يتم حماية حساب SMSM الرئيسي من التعطيل للحفاظ على دخول المالك للنظام.
              </div>
            </div>
          </div>
        </section>

        <section className="command-panel overflow-hidden">
          <div className="flex flex-col gap-2 bg-[var(--surface-lowest)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="command-label">دليل الموظفين</div>
              <h2 className="mt-1 text-lg font-black text-white">قائمة المستخدمين</h2>
            </div>
            <StatusBadge tone="blue">بيانات فعلية</StatusBadge>
          </div>

          <div className="overflow-x-auto">
            <table className="command-table min-w-[1180px] text-right text-sm">
              <thead>
                <tr>
                  <th>المستخدم</th>
                  <th>الدور</th>
                  <th>الحالة</th>
                  <th>تاريخ الإنشاء</th>
                  <th>إعادة كلمة المرور</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isOwner = user.role === "OWNER";
                  const isMainOwner = isOwner && user.username === "SMSM";
                  return (
                    <tr key={user.id}>
                      <td>
                        <div className="flex items-center gap-4">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-[var(--surface-highest)] text-xs font-black text-white">
                            {(user.fullName || user.username).slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-black text-white">{user.fullName || user.username}</div>
                            <div className="mt-1 font-mono text-[10px] text-white/42">{user.username}</div>
                          </div>
                        </div>
                      </td>
                      <td><StatusBadge tone={isOwner ? "red" : "neutral"}>{isOwner ? "مالك" : "بائع"}</StatusBadge></td>
                      <td><StatusBadge tone={user.isActive ? "blue" : "neutral"}>{user.isActive ? "نشط" : "غير نشط"}</StatusBadge></td>
                      <td className="text-white/58">{user.createdAt.toLocaleString("ar-EG")}</td>
                      <td>
                        {isMainOwner ? (
                          <span className="text-sm text-white/35">محمي</span>
                        ) : (
                          <form action={resetPasswordAction} className="flex gap-2">
                            <input type="hidden" name="userId" value={user.id} />
                            <input
                              name="newPassword"
                              type="password"
                              required
                              placeholder="كلمة مرور جديدة"
                              className="command-input h-10 w-48 px-3 text-xs placeholder:text-white/30"
                            />
                            <button className="command-secondary h-10 px-4 text-[10px] font-black uppercase tracking-[0.1em]">حفظ</button>
                          </form>
                        )}
                      </td>
                      <td>
                        {isMainOwner ? (
                          <span className="text-sm text-white/35">ثابت</span>
                        ) : (
                          <form action={toggleUserAction}>
                            <input type="hidden" name="userId" value={user.id} />
                            <input type="hidden" name="nextActive" value={String(!user.isActive)} />
                            <button className={`h-10 rounded-sm px-4 text-[10px] font-black uppercase tracking-[0.1em] transition ${
                              user.isActive
                                ? "bg-[var(--primary)]/15 text-[var(--primary-soft)] hover:bg-[var(--primary)]/25"
                                : "bg-[var(--tertiary)]/12 text-[var(--tertiary)] hover:bg-[var(--tertiary)]/18"
                            }`}>
                              {user.isActive ? "تعطيل" : "تفعيل"}
                            </button>
                          </form>
                        )}
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
