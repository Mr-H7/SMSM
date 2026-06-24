import { z } from "zod";

const loginSearchSchema = z.object({
  e: z.preprocess((value) => Array.isArray(value) ? value[0] : value, z.enum(["1", "2"]).optional()),
  error: z.preprocess((value) => Array.isArray(value) ? value[0] : value, z.enum(["1", "2"]).optional()),
});

type LoginSearchParams = z.input<typeof loginSearchSchema>;

export default async function LoginPage(props: { searchParams: Promise<LoginSearchParams> }) {
  const sp = loginSearchSchema.parse(await props.searchParams);
  const e = sp.e ?? sp.error ?? "";

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-bold mb-2">تسجيل الدخول</h1>
        <p className="text-sm text-white/60 mb-4">احلا سيستم ده ولا ايه    </p>

        {e === "1" && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-600/10 p-3 text-sm text-red-300">
            جرب تاني يعم بتغلط ليه
          </div>
        )}
        {e === "2" && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-600/10 p-3 text-sm text-red-300">
          سمسم مش حاطك في السيستم
          </div>
        )}

        <form action="/login/submit" method="post" className="space-y-3">
          <input
            name="username"
            placeholder="اسم الكريم ايه"
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

        </div>
    </div>
  );
}
