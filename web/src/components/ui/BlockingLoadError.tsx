interface BlockingLoadErrorProps {
  title: string;
  message: string;
  onRetry: () => void;
}

export function BlockingLoadError({ title, message, onRetry }: BlockingLoadErrorProps) {
  return (
    <div className="flex h-64 items-center justify-center px-4">
      <div
        role="alert"
        className="max-w-md rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-left"
      >
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
