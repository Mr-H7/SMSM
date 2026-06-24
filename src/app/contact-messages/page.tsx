import CommandShell from "@/components/CommandShell";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/rbac";
import { deleteMessageAction, updateMessageStatusAction } from "./actions";

export const dynamic = "force-dynamic";

function date(value: Date) {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  }).format(value);
}

export default async function ContactMessagesPage() {
  const user = await requireUser();
  const isOwner = String(user.role).toUpperCase() === "OWNER";
  const messages = await prisma.contactMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 250,
  });

  return (
    <CommandShell active="messages" user={user}>
      <div className="mx-auto max-w-6xl space-y-8">
        <section>
          <div className="command-label">تواصل العملاء</div>
          <h1 className="mt-2 text-3xl font-black text-white sm:text-4xl">رسائل الموقع</h1>
          <p className="mt-2 text-sm text-white/55">الرسائل الجديدة محفوظة داخل قاعدة النظام الأساسية.</p>
        </section>

        <section className="space-y-3">
          {messages.length === 0 ? (
            <div className="command-panel-high p-12 text-center text-sm text-white/45">لا توجد رسائل.</div>
          ) : (
            messages.map((message) => (
              <article
                key={message.id}
                className={"command-panel-high p-5 " + (message.status === "UNREAD" ? "border-r-4 border-[var(--primary)]" : "")}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="font-black text-white">{message.name}</h2>
                    <div className="mt-1 text-sm text-[var(--primary-soft)]">{message.contact}</div>
                    <div className="mt-1 text-xs text-white/35">{date(message.createdAt)}</div>
                  </div>
                  <span className="command-badge bg-white/[0.06] text-white/65">{message.status}</span>
                </div>
                <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-white/70">{message.message}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <form action={updateMessageStatusAction}>
                    <input type="hidden" name="id" value={message.id} />
                    <input type="hidden" name="status" value={message.status === "READ" ? "UNREAD" : "READ"} />
                    <button className="command-secondary px-4 py-2 text-xs font-black">
                      {message.status === "READ" ? "تحديد كغير مقروءة" : "تحديد كمقروءة"}
                    </button>
                  </form>
                  <form action={updateMessageStatusAction}>
                    <input type="hidden" name="id" value={message.id} />
                    <input type="hidden" name="status" value="ARCHIVED" />
                    <button className="command-secondary px-4 py-2 text-xs font-black">أرشفة</button>
                  </form>
                  {isOwner ? (
                    <form action={deleteMessageAction} className="ms-auto">
                      <input type="hidden" name="id" value={message.id} />
                      <button className="command-secondary px-4 py-2 text-xs font-black text-[var(--primary-soft)]">
                        حذف
                      </button>
                    </form>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </CommandShell>
  );
}