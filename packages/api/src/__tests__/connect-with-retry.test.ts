import { describe, it, expect, vi } from 'vitest';
import { connectWallboxWithRetry } from '../wallbox/connectWithRetry.js';

describe('connectWallboxWithRetry', () => {
  it('resolves immediately when connect succeeds on first try', async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await connectWallboxWithRetry({ connect }, { intervalMs: 30000, sleep });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries at the given interval after failed attempts until connect succeeds', async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await connectWallboxWithRetry({ connect }, { intervalMs: 30000, sleep });

    expect(connect).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(30000);
  });

  it('reports each failed attempt via onError', async () => {
    const err = new Error('ECONNREFUSED');
    const connect = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    await connectWallboxWithRetry({ connect }, { intervalMs: 30000, sleep, onError });

    expect(onError).toHaveBeenCalledWith(err);
  });
});
