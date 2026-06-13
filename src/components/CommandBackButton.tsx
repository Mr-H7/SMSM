"use client";

import { useRouter } from "next/navigation";

export default function CommandBackButton() {
  const router = useRouter();

  function goBack() {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/dashboard");
  }

  return (
    <button
      type="button"
      onClick={goBack}
      className="command-secondary h-10 px-4 text-xs font-black uppercase tracking-[0.12em]"
    >
      رجوع
    </button>
  );
}
