"use client";

export default function PrintButton() {
  function handlePrint() {
    const oldTitle = document.title;
    document.title = "فاتورة - SMSM";
    window.print();
    setTimeout(() => {
      document.title = oldTitle;
    }, 300);
  }

  return (
    <button
      type="button"
      onClick={handlePrint}
      className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
    >
      طباعة الفاتورة
    </button>
  );
}