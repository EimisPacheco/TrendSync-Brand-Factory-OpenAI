export class RetryError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: Error
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: Error, attempt: number) => boolean;
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

const defaultShouldRetry = (error: Error): boolean => {
  // Retry on network errors and 5xx server errors
  if (error.message.includes('fetch failed') || error.message.includes('network')) {
    return true;
  }

  // Don't retry on 4xx client errors (except 429 rate limit)
  if (error.message.includes('429')) {
    return true;
  }

  if (error.message.includes('400') || error.message.includes('401') || error.message.includes('403') || error.message.includes('404')) {
    return false;
  }

  // Retry on 5xx errors
  if (error.message.includes('500') || error.message.includes('502') || error.message.includes('503') || error.message.includes('504')) {
    return true;
  }

  return false;
};

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    shouldRetry = defaultShouldRetry,
    onRetry
  } = options;

  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if this was the last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Check if we should retry this error
      if (!shouldRetry(lastError, attempt)) {
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        baseDelay * Math.pow(backoffMultiplier, attempt),
        maxDelay
      );

      // Add jitter to prevent thundering herd
      const jitter = Math.random() * 0.3 * delay;
      const finalDelay = delay + jitter;

      onRetry?.(lastError, attempt + 1, finalDelay);

      await new Promise(resolve => setTimeout(resolve, finalDelay));
    }
  }

  throw new RetryError(
    `Failed after ${maxRetries + 1} attempts: ${lastError!.message}`,
    maxRetries + 1,
    lastError!
  );
}

export async function retryBatch<T>(
  items: T[],
  fn: (item: T, index: number) => Promise<void>,
  options: RetryOptions & { continueOnError?: boolean } = {}
): Promise<{ successful: T[]; failed: Array<{ item: T; error: Error }> }> {
  const { continueOnError = true, ...retryOptions } = options;

  const results = await Promise.allSettled(
    items.map((item, index) =>
      retryWithBackoff(() => fn(item, index), retryOptions)
    )
  );

  const successful: T[] = [];
  const failed: Array<{ item: T; error: Error }> = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      successful.push(items[index]);
    } else {
      failed.push({
        item: items[index],
        error: result.reason
      });

      if (!continueOnError) {
        throw result.reason;
      }
    }
  });

  return { successful, failed };
}
