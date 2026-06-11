import Link from "next/link";
import type { ReactNode } from "react";

type CommandShellProps = {
  active: "dashboard" | "pos" | "products" | "invoices" | "reports" | "returns" | "shift" | "targets" | "users";
  user?: {
    username?: string | null;
    fullName?: string | null;
    role?: string | null;
    userRole?: string | null;
  } | null;
  children: ReactNode;
};

const baseItems = [
  { id: "dashboard", href: "/dashboard", label: "Dashboard", mark: "DB" },
  { id: "pos", href: "/sales/new", label: "POS", mark: "PS" },
  { id: "products", href: "/products", label: "Products", mark: "IN" },
  { id: "invoices", href: "/invoices", label: "Invoices", mark: "RC" },
  { id: "returns", href: "/returns", label: "Returns", mark: "RT" },
  { id: "shift", href: "/shift-close", label: "Shift Close", mark: "SC" },
] as const;

const ownerItems = [
  { id: "reports", href: "/reports", label: "Reports", mark: "RP" },
  { id: "targets", href: "/targets", label: "Targets", mark: "TG" },
  { id: "users", href: "/users", label: "Users", mark: "US" },
] as const;

export default function CommandShell({ active, user, children }: CommandShellProps) {
  const role = String(user?.role ?? user?.userRole ?? "").toUpperCase();
  const isOwner = role === "OWNER";
  const displayName = user?.fullName || user?.username || "Operator";
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const navItems = isOwner ? [...baseItems, ...ownerItems] : baseItems;

  return (
    <div className="command-shell min-h-screen text-[var(--foreground)]" dir="ltr">
      <aside className="command-sidebar fixed inset-y-0 left-0 z-50 hidden w-64 flex-col px-4 py-6 lg:flex">
        <div className="mb-10 px-4">
          <div className="text-xl font-black uppercase tracking-tight text-[var(--foreground)]">
            SMSM Store
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/40">
            Command Center
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const isActive = item.id === active;
            return (
              <Link
                key={item.id}
                href={item.href}
                className={`flex items-center gap-3 rounded-sm px-4 py-3 text-sm transition ${
                  isActive
                    ? "border-l-4 border-[var(--primary)] bg-white/[0.055] font-bold text-[var(--primary)]"
                    : "text-white/55 hover:bg-white/[0.045] hover:text-white"
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-sm text-[10px] font-black ${
                    isActive ? "bg-[var(--primary)] text-white" : "bg-white/[0.055] text-white/45"
                  }`}
                >
                  {item.mark}
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="command-panel mt-6 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-[var(--surface-highest)] text-xs font-black text-white">
              {initials || "OP"}
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-black text-white">{displayName}</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-[var(--primary-soft)]">
                {role || "ACTIVE"}
              </div>
            </div>
          </div>
          <Link
            href="/logout"
            className="command-secondary mt-4 flex h-9 items-center justify-center text-xs font-black uppercase tracking-[0.12em]"
          >
            Sign Out
          </Link>
        </div>
      </aside>

      <div className="command-content lg:pl-64">
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-white/[0.055] bg-[#131313]/85 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <form action="/products" method="get" className="relative w-full max-w-md">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-white/35">
              /
            </span>
            <input
              name="q"
              placeholder="Quick find product, SKU or category..."
              className="command-input h-10 w-full px-9 text-sm placeholder:text-white/30"
            />
          </form>

          <div className="ml-4 flex items-center gap-4">
            <div className="hidden h-6 w-px bg-white/[0.06] sm:block" />
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[var(--primary)] shadow-[0_0_18px_rgba(229,9,20,0.8)]" />
              <span className="text-xs font-black uppercase tracking-[0.14em] text-white/72">
                Live Store
              </span>
            </div>
          </div>
        </header>

        <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
