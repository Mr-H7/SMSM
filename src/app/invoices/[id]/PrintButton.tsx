"use client";

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="command-primary px-4 py-3 text-xs font-black uppercase tracking-[0.12em]"
    >
      Print
    </button>
  );
}
