import { Component, type ErrorInfo, type ReactNode } from "react";
import { ServerErrorPage } from "./StatusPages";

type State = {
  hasError: boolean;
};

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("AppErrorBoundary", error, info);
  }

  render() {
    if (this.state.hasError) {
      return <ServerErrorPage inline />;
    }
    return this.props.children;
  }
}
