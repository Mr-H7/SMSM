import "./globals.css";

export const metadata = {
  title: "لوحة تحكم SMSM",
  description: "إدارة المبيعات والمخزون والفواتير والمرتجعات وتشغيل المتجر.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen bg-[var(--surface)] text-[var(--foreground)]">
        {children}
      </body>
    </html>
  );
}
