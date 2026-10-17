import React from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { isChunkLoadError } from '../../utils/lazyWithRetry';

/**
 * Props accepted by the ChunkErrorBoundary component.
 */
interface ChunkErrorBoundaryProps {
  /** Child route components wrapped in React.Suspense */
  children: React.ReactNode;
}

/**
 * Internal state tracked by ChunkErrorBoundary.
 */
interface ChunkErrorBoundaryState {
  /** True when a descendant component or lazy route threw an uncaught error */
  hasError: boolean;
  /** The caught error instance, if available */
  error: Error | null;
}

/**
 * React Error Boundary wrapping lazy-loaded station routes.
 * If a dynamic chunk fails to load (for example, while a device is temporarily
 * offline during a deployment or after the 30-second auto-reload guard cooldown),
 * this boundary presents a clean recovery card instead of a blank screen.
 */
export class ChunkErrorBoundary extends React.Component<
  ChunkErrorBoundaryProps,
  ChunkErrorBoundaryState
> {
  // Initialize boundary with a clean error-free state
  constructor(props: ChunkErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  // Transition state when a child route or lazy import throws an error
  static getDerivedStateFromError(error: Error): ChunkErrorBoundaryState {
    return { hasError: true, error };
  }

  // Reload the current page from the network/service worker when the user taps Reload
  handleReload = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render(): React.ReactNode {
    // Render normal route tree when no error has occurred
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Determine whether the error was specifically caused by a stale/missing lazy chunk
    const isChunkError = isChunkLoadError(this.state.error);

    // Render recovery card prompting the volunteer or visitor to reload the station
    return (
      <div className="max-w-lg mx-auto my-16 px-4">
        <div className="p-8 bg-white rounded-2xl shadow-sm border border-amber-200 text-center">
          <div className="h-14 w-14 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-4">
            <WifiOff className="h-7 w-7" />
          </div>

          <h2 className="text-xl font-bold text-slate-900">
            {isChunkError ? 'Station Update Required' : 'Something Went Wrong'}
          </h2>

          <p className="mt-2 text-sm text-slate-600">
            {isChunkError
              ? 'A newer version of this station was deployed while your device was offline or switching networks. Please check your Wi-Fi connection and tap Reload Station.'
              : 'An unexpected error occurred while loading this station view. Please reload to continue.'}
          </p>

          {/* Reload trigger button */}
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-6 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 transition-colors cursor-pointer shadow-xs"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Reload Station</span>
          </button>
        </div>
      </div>
    );
  }
}
