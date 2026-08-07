import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './Button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  private handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-screen flex flex-col items-center justify-center bg-m3-surface-0 text-m3-on-surface p-6 select-none">
          <div className="max-w-md w-full p-8 bg-m3-surface-1 rounded-m3-lg border border-m3-surface-4 text-center space-y-4 shadow-m3-3">
            <div className="h-16 w-16 mx-auto rounded-full bg-m3-error/20 flex items-center justify-center text-m3-error">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-m3-on-surface">Application UI Error Caught</h2>
              <p className="text-xs text-m3-on-surface-variant mt-1 font-mono break-words">
                {this.state.error?.message || 'An unexpected rendering error occurred.'}
              </p>
            </div>
            <Button
              variant="filled"
              size="sm"
              className="w-full"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={this.handleReload}
            >
              Reload Interface
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
