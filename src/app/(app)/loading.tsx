export default function AppLoading() {
  return (
    <div className="page-content" aria-busy="true" aria-live="polite">
      <div className="route-loading">
        <div className="route-loading-spinner" />
        <span>Cargando…</span>
      </div>
    </div>
  );
}
