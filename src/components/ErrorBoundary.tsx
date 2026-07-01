import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  title: string;
  body: string;
  reloadLabel: string;
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Catches render-time crashes in the 3D / globe views so a single component
 *  failure shows a recoverable message instead of a blank app. Strings are passed
 *  in (class components can't use the i18n hook). */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface for debugging; there is no remote logging in this client-only app.
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="crash">
          <div className="crash-card">
            <h2>{this.props.title}</h2>
            <p>{this.props.body}</p>
            <pre className="crash-detail">{this.state.error.message}</pre>
            <button className="crash-reload" onClick={() => window.location.reload()}>
              {this.props.reloadLabel}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
