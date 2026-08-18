import type { Metadata } from "next";
import "./globals.css";
import { LangProvider } from "@/lib/i18n";
import PwaRegister from "@/components/PwaRegister";

export const metadata: Metadata = {
  title: "Depanel",
  description: "Panel tim untuk start/stop, monitoring, jadwal & backup VPS depa.id",
};

// Terapkan tema sebelum paint pertama supaya tidak berkedip (FOUC).
const themeScript = `(function(){try{var t=localStorage.getItem("theme");var d=t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <LangProvider>
          {children}
          <PwaRegister />
        </LangProvider>
      </body>
    </html>
  );
}
