import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import "@/styles/base.css";
import "@/styles/gestart.css";
import "@/styles/pedidos.css";
import "@/styles/presupuestos.css";

export const metadata: Metadata = {
  title: "GestArt | Gestión inteligente",
  description: "GestArt: gestión empresarial configurable para clientes, pedidos, producción, caja, inventario y reportes"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" data-scroll-behavior="smooth">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
