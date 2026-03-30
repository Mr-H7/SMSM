import { prisma } from "@/lib/prisma";
import { createSession, verifyPassword } from "@/lib/auth";
import { redirect } from "next/navigation";

async function loginAction(formData: FormData) {
  "use server";

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();

  if (!username || !password) return redirect("/login?e=1");

  const user = await prisma.user.findFirst({
    where: { username },
    select: { id: true, passwordHash: true, isActive: true },
  });

  if (!user) return redirect("/login?e=1");
  if (user.isActive === false) return redirect("/login?e=2");

  const ok = verifyPassword(password, user.passwordHash);
  if (!ok) return redirect("/login?e=1");

  await createSession(user.id);
  redirect("/dashboard");
}

export default async function LoginPage(props: { searchParams: Promise<{ e?: string }> }) {
  const sp = await props.searchParams;
  const e = sp.e ?? "";

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-bold mb-2">تسجيل الدخول</h1>
        <p className="text-sm text-white/60 mb-4">نظام إدارة محل الأحذية</p>

        {e === "1" && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-600/10 p-3 text-sm text-red-300">
            بيانات الدخول غير صحيحة
          </div>
        )}
        {e === "2" && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-600/10 p-3 text-sm text-red-300">
            هذا الحساب غير مُفعل
          </div>
        )}

        <form action={loginAction} className="space-y-3">
          <input
            name="username"
            placeholder="اسم المستخدم"
            className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
            required
          />
          <input
            name="password"
            type="password"
            placeholder="كلمة السر"
            className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-red-500"
            required
          />

          <button className="w-full rounded-xl bg-white px-4 py-3 text-sm font-bold text-black hover:bg-white/90">
            دخول
          </button>
        </form>

        <div className="mt-4 text-xs text-white/50">
          الافتراضي بعد الريست: <span className="font-mono">owner / Owner@1234</span>
        </div>
      </div>
    </div>
  );
}