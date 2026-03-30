// src/app/layout.tsx
import "./globals.css";

export const metadata = {
  title: "نظام إدارة محل الأحذية",
  description: "مبيعات، مخزون، فواتير، أرباح، صلاحيات",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen bg-black text-white">{children}</body>
    </html>
  );
}