import { Component, type ReactNode } from "react";
import { Button, Empty } from "@suite/ui-web";

export class FeatureBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed)
      this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? (
      <Empty
        title="This view could not be loaded"
        description="Your saved work is safe. Reload this view to try again."
        action={
          <Button onClick={() => this.setState({ failed: false })}>
            Try again
          </Button>
        }
      />
    ) : (
      this.props.children
    );
  }
}
