import { AppGuard } from "@/components/AppGuard";
import { MobileNav } from "@/components/MobileNav";
import { Sidebar } from "@/components/Sidebar";

export default function AppLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <AppGuard>
      <a className="skip-link" href="#main-content">
        Saltar al contenido
      </a>
      <div className="app-shell">
        <Sidebar />
        <main className="main-content" id="main-content">
          {children}
        </main>
        <MobileNav />
      </div>
    </AppGuard>
  );
}
