import "./globals.css";

export const metadata = {
  title: "SMSM Store Command Center",
  description: "Retail inventory, POS, invoices, returns, and store operations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body className="min-h-screen bg-[var(--surface)] text-[var(--foreground)]">
        {children}
      </body>
    </html>
  );
}
