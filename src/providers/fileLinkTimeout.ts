/**
 * Bound a file-link operation and run its cancellation hook before rejecting
 * when the budget expires.
 */
export function withFileLinkTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        onTimeout?.();
      } catch {
        // Cancellation must not hide the timeout that triggered it.
      }
      reject(new Error(`findFiles timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    Promise.resolve(operation).then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
