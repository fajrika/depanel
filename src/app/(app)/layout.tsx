import { LangProvider } from "@/lib/i18n";
import AppShell from "@/components/AppShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <LangProvider>
      <AppShell>{children}</AppShell>
    </LangProvider>
  );
}
