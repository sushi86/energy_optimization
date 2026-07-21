export interface ConnectRetryOptions {
  intervalMs: number;
  sleep?: (ms: number) => Promise<void>;
  onError?: (err: Error) => void;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function connectWallboxWithRetry(
  client: { connect: () => Promise<void> },
  options: ConnectRetryOptions,
): Promise<void> {
  const sleep = options.sleep ?? defaultSleep;
  for (;;) {
    try {
      await client.connect();
      return;
    } catch (err) {
      options.onError?.(err as Error);
      await sleep(options.intervalMs);
    }
  }
}
