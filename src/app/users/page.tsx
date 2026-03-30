import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createUser, resetUserPassword, setUserRole, toggleUserActive } from "./actions";

type SearchParams = { q?: string };

export default async function UsersPage(props: { searchParams: Promise<SearchParams> }) {
  const me = await getSessionUser();
  if (!me) redirect("/login");
  if (me.role !== "OWNER") redirect("/dashboard");

  const sp = await props.searchParams;
  const q = (sp.q ?? "").trim();

  const users = await prisma.user.findMany({
    where: q
      ? {
          OR: [
            { username: { contains: q, mode: "insensitive" } },
            { fullName: { contains: q, mode: "insensitive" } },
            { id: { contains: q } },
          ],
        }
      : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      username: true,
      fullName: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return (
    <div className="min-h-screen bg-black text-white" dir="rtl">
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">المستخدمون</h1>
            <p className="mt-1 text-sm text-white/60">Theme: Red / Black / White</p>
          </div>

          <a
            href="/dashboard"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
          >
            رجوع
          </a>
        </div>

        {/* Create */}
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <h2 className="mb-3 text-lg font-bold">إضافة مستخدم</h2>

          <form action={createUser} className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-3">
              <label className="mb-1 block text-sm text-white/70">Username</label>
              <input
                name="username"
                placeholder="cashier1"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
                required
              />
            </div>

            <div className="md:col-span-4">
              <label className="mb-1 block text-sm text-white/70">Full name (اختياري)</label>
              <input
                name="fullName"
                placeholder="محمد أحمد"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-sm text-white/70">Role</label>
              <select
                name="role"
                defaultValue="SELLER"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
              >
                <option value="SELLER">SELLER</option>
                <option value="OWNER">OWNER</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="mb-1 block text-sm text-white/70">Password</label>
              <input
                name="password"
                type="password"
                placeholder="6+ chars"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
                required
              />
            </div>

            <div className="md:col-span-12">
              <button className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-bold hover:bg-red-500">
                إضافة
              </button>
            </div>
          </form>
        </div>

        {/* Search */}
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <form action="/users" method="get" className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-10">
              <label className="mb-1 block text-sm text-white/70">بحث</label>
              <input
                name="q"
                defaultValue={q}
                placeholder="ابحث بالاسم / اليوزر / جزء من ID"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
              />
            </div>
            <div className="flex items-end md:col-span-2">
              <button className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-bold hover:bg-red-500">
                بحث
              </button>
            </div>
            <div className="md:col-span-12">
              <a
                href="/users"
                className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
              >
                مسح
              </a>
            </div>
          </form>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-right text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white/70">
                  <th className="py-3">Username</th>
                  <th className="py-3">Full name</th>
                  <th className="py-3">Role</th>
                  <th className="py-3">Active</th>
                  <th className="py-3">Created</th>
                  <th className="py-3">Reset Password</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-white/50">
                      مفيش مستخدمين
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="border-b border-white/5">
                      <td className="py-3 font-semibold">{u.username}</td>
                      <td className="py-3">{u.fullName ?? "-"}</td>

                      <td className="py-3">
                        <form action={setUserRole} className="inline-flex items-center gap-2">
                          <input type="hidden" name="id" value={u.id} />
                          <select
                            name="role"
                            defaultValue={u.role}
                            className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs outline-none focus:border-red-500"
                          >
                            <option value="SELLER">SELLER</option>
                            <option value="OWNER">OWNER</option>
                          </select>
                          <button className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-black hover:bg-white/90">
                            حفظ
                          </button>
                        </form>
                      </td>

                      <td className="py-3">
                        <form action={toggleUserActive} className="inline-flex items-center gap-2">
                          <input type="hidden" name="id" value={u.id} />
                          <input type="hidden" name="next" value={u.isActive ? "0" : "1"} />
                          <span className={`text-xs ${u.isActive ? "text-green-400" : "text-red-400"}`}>
                            {u.isActive ? "ON" : "OFF"}
                          </span>
                          <button
                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                            disabled={u.role === "OWNER"}
                            title={u.role === "OWNER" ? "مينفعش تعطّل OWNER" : ""}
                          >
                            {u.isActive ? "تعطيل" : "تفعيل"}
                          </button>
                        </form>
                      </td>

                      <td className="py-3 text-white/70">
                        {new Date(u.createdAt).toLocaleString("ar-EG")}
                      </td>

                      <td className="py-3">
                        <form action={resetUserPassword} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={u.id} />
                          <input
                            name="newPassword"
                            type="password"
                            placeholder="كلمة جديدة"
                            className="w-48 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs outline-none focus:border-red-500"
                            required
                          />
                          <button className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold hover:bg-red-500">
                            Reset
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-white/40">
            تنبيه: أي user جديد بيتعمل بـ pbkdf2، والـ login هيقبل pbkdf2 + scrypt.
          </div>
        </div>
      </div>
    </div>
  );
}