"use client";

export default function EndShiftButton() {
  function handleEndShift() {
    alert("تم إنهاء الشيفت. كل بيانات البيع محفوظة بالفعل داخل النظام.");
    window.location.href = "/dashboard";
  }

  return (
    <button
      type="button"
      onClick={handleEndShift}
      className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500"
    >
      إنهاء الشيفت
    </button>
  );
}