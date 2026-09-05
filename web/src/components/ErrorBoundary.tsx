import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// React has no built-in error boundary — only a class component can
// implement getDerivedStateFromError/componentDidCatch. Wrapping just the
// routed page content (not the whole app shell) means a crash in one page
// shows this fallback while the sidebar/nav in Layout stays mounted and
// usable, so the user can navigate away without a full reload.
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("Unbehandelter Fehler in einer Seite:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="empty-state">
          <p>
            <strong>Etwas ist schiefgelaufen.</strong>
            <br />
            Diese Seite konnte nicht angezeigt werden. Du kannst es erneut versuchen oder über die Navigation zu
            einer anderen Seite wechseln.
          </p>
          <button onClick={this.handleReset}>Erneut versuchen</button>
        </div>
      );
    }

    return this.props.children;
  }
}
