import { RefreshCw, RotateCcw, TriangleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { isChunkLoadError } from "../lib/lazy";
import { Btn } from "./kit";

type Props = {
  /** Where the failure happened, shown to the operator. */
  scope: string;
  /** Changing this clears the error, so moving to another section recovers on its own. */
  resetKey?: string;
  children: ReactNode;
};

type State = { error: Error | null };

/**
 * Without a boundary, one throw during render or effect cleanup unmounts the
 * whole React root and leaves a black page until a manual refresh. This keeps
 * the shell, the navigation and the live link on screen and reports the
 * failure in place.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ubuntu-control] ${this.props.scope} crashed`, error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const stale = isChunkLoadError(error);
    return (
      <div className="fault" role="alert">
        <span className="fault-icon" aria-hidden="true">
          <TriangleAlert size={20} strokeWidth={1.75} />
        </span>
        <h2>{stale ? "This section needs a fresh copy of the console" : `${this.props.scope} stopped responding`}</h2>
        <p>
          {stale
            ? "The browser could not load the code for this section. The console was probably rebuilt, or the Cloudflare Access session expired. Reloading fixes both."
            : error.message || "An unexpected error interrupted this view."}
        </p>
        <div className="fault-actions">
          <Btn variant="primary" icon={<RefreshCw size={13} />} onClick={() => window.location.reload()}>Reload page</Btn>
          {!stale && <Btn variant="line" icon={<RotateCcw size={13} />} onClick={this.reset}>Try again</Btn>}
        </div>
      </div>
    );
  }
}
