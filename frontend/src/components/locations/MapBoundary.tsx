import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Shown instead of the map when it cannot be loaded (offline, chunk error). */
  fallback: ReactNode;
  children: ReactNode;
}

/** Keeps a failing lazy map from taking the whole page down. */
export class MapBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("Map failed to render", error, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
