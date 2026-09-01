export default function Login() {
  return (
    <div className="login-shell">
      <div className="login-card">
        <h1>leck-eier-bot Dashboard</h1>
        <p>Melde dich mit Discord an, um Reaktionsrollen, Geburtstage und Befehle zu verwalten.</p>
        <button className="primary" onClick={() => (window.location.href = "/auth/login")}>
          Mit Discord anmelden
        </button>
      </div>
    </div>
  );
}
