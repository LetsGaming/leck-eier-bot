export default function Login() {
  return (
    <div className="login-shell">
      <div className="login-card">
        <h1>leck-eier-bot Dashboard</h1>
        <p>Sign in with Discord to manage reaction roles, birthdays, and commands.</p>
        <button className="primary" onClick={() => (window.location.href = "/auth/login")}>
          Log in with Discord
        </button>
      </div>
    </div>
  );
}
