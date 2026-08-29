import Link from "next/link";
import { Icon } from "@/components/Icon";

export default function NotFound() {
  return (
    <main className="standalone-state-page">
      <div className="route-error-card">
        <span><Icon name="search" size={25} /></span>
        <strong>Página no encontrada</strong>
        <p>La dirección no existe o el módulo cambió de ubicación.</p>
        <Link className="button button-dark" href="/dashboard">
          Volver a GestArt
        </Link>
      </div>
    </main>
  );
}
