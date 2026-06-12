import Link from "next/link";
import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="command-label">{eyebrow}</div>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </section>
  );
}

type MetricCardProps = {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  tone?: "red" | "blue" | "neutral";
};

export function MetricCard({ label, value, meta, tone = "neutral" }: MetricCardProps) {
  const border =
    tone === "red"
      ? "border-r-4 border-[var(--primary)]"
      : tone === "blue"
        ? "border-r-4 border-[var(--tertiary)]"
        : "border-r-4 border-white/10";

  return (
    <div className={`command-card p-5 ${border}`}>
      <div className="command-label">{label}</div>
      <div className="mt-4 text-3xl font-black tracking-tight text-white">{value}</div>
      <div className="mt-3 h-px w-full bg-gradient-to-l from-[var(--primary)] via-white/10 to-transparent" />
      {meta ? <div className="mt-3 text-xs font-semibold text-white/45">{meta}</div> : null}
    </div>
  );
}

export function ProgressBar({
  value,
  tone = "red",
}: {
  value: number;
  tone?: "red" | "blue" | "white";
}) {
  const width = `${Math.max(0, Math.min(100, Math.round(value)))}%`;
  const color =
    tone === "blue" ? "bg-[var(--tertiary)]" : tone === "white" ? "bg-white" : "bg-[var(--primary)]";
  return (
    <div className="h-2 overflow-hidden rounded-sm bg-[var(--surface-highest)]">
      <div className={`h-full ${color}`} style={{ width }} />
    </div>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "red" | "blue" | "neutral";
}) {
  const className =
    tone === "red"
      ? "bg-[var(--primary)]/15 text-[var(--primary-soft)]"
      : tone === "blue"
        ? "bg-[var(--tertiary)]/12 text-[var(--tertiary)]"
        : "bg-white/[0.055] text-white/65";
  return <span className={`command-badge ${className}`}>{children}</span>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="bg-black/20 px-4 py-10 text-center text-sm font-semibold text-white/42">
      {children}
    </div>
  );
}

export function BackToDashboard() {
  return (
    <Link href="/dashboard" className="command-secondary px-5 py-3 text-xs font-black uppercase tracking-[0.12em]">
      رجوع للوحة التحكم
    </Link>
  );
}
