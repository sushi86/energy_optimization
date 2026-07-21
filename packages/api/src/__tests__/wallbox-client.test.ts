import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The mock models the real socket lifecycle: connectTCP opens it, close() closes it.
// The client (like evcc's modbus layer) closes the connection on every request error
// and lazily reconnects on the next request, so tests observe isOpen transitions.
const mockClientInstance = {
  connectTCP: vi.fn(),
  setID: vi.fn(),
  setTimeout: vi.fn(),
  close: vi.fn(),
  readHoldingRegisters: vi.fn(),
  writeRegisters: vi.fn(),
  isOpen: false,
};
const mockConnectTCP = mockClientInstance.connectTCP;
const mockSetID = mockClientInstance.setID;
const mockClose = mockClientInstance.close;
const mockReadHoldingRegisters = mockClientInstance.readHoldingRegisters;
const mockWriteRegisters = mockClientInstance.writeRegisters;

function installDefaultSocketBehavior() {
  mockConnectTCP.mockImplementation(() => {
    mockClientInstance.isOpen = true;
    return Promise.resolve(undefined);
  });
  mockClose.mockImplementation((cb: () => void) => {
    mockClientInstance.isOpen = false;
    cb();
  });
  mockWriteRegisters.mockResolvedValue(undefined);
}

vi.mock('modbus-serial', () => ({
  default: vi.fn().mockImplementation(() => mockClientInstance),
}));

const { WallboxClient, createWallboxClient } = await import('../wallbox/WallboxClient.js');
const { EM2GO_REGISTERS } = await import('../wallbox/types.js');

const STATIC_REGISTERS = [
  EM2GO_REGISTERS.maxCurrent,
  EM2GO_REGISTERS.minCurrent,
  EM2GO_REGISTERS.cableMaxCurrent,
  EM2GO_REGISTERS.safeCurrent,
  EM2GO_REGISTERS.commTimeout,
  EM2GO_REGISTERS.chargeMode,
  EM2GO_REGISTERS.serial,
];

function regResponse(values: number[]) {
  return { data: values, buffer: Buffer.alloc(values.length * 2) };
}

type RegisterOverrideKey =
  | 'status'
  | 'connectorState'
  | 'errorCode'
  | 'power'
  | 'energy'
  | 'currentLimit'
  | 'currents'
  | 'currents+2'
  | 'currents+4'
  | 'voltages'
  | 'voltages+2'
  | 'voltages+4'
  | 'phases'
  | 'chargeDuration'
  | 'maxCurrent'
  | 'minCurrent'
  | 'cableMaxCurrent'
  | 'safeCurrent'
  | 'commTimeout'
  | 'chargeMode';

type RegisterOverrides = Partial<Record<RegisterOverrideKey, number[]>> & { serial?: string };

// Serves every register the client may read: dynamic values, static values and the
// serial number (one char per 16-bit word, as on the real box).
function mockRegisters(overrides: RegisterOverrides = {}) {
  const serial = overrides.serial ?? 'WBX-1';
  const values: Record<number, number[]> = {
    [EM2GO_REGISTERS.status]: overrides.status ?? [4],
    [EM2GO_REGISTERS.connectorState]: overrides.connectorState ?? [1],
    [EM2GO_REGISTERS.errorCode]: overrides.errorCode ?? [0],
    [EM2GO_REGISTERS.power]: overrides.power ?? [0, 7360],
    [EM2GO_REGISTERS.energy]: overrides.energy ?? [0, 123],
    [EM2GO_REGISTERS.currentLimit]: overrides.currentLimit ?? [160],
    [EM2GO_REGISTERS.currents]: overrides.currents ?? [107],
    [EM2GO_REGISTERS.currents + 2]: overrides['currents+2'] ?? [107],
    [EM2GO_REGISTERS.currents + 4]: overrides['currents+4'] ?? [107],
    [EM2GO_REGISTERS.voltages]: overrides.voltages ?? [2300],
    [EM2GO_REGISTERS.voltages + 2]: overrides['voltages+2'] ?? [2300],
    [EM2GO_REGISTERS.voltages + 4]: overrides['voltages+4'] ?? [2300],
    [EM2GO_REGISTERS.phases]: overrides.phases ?? [3],
    [EM2GO_REGISTERS.chargeDuration]: overrides.chargeDuration ?? [0, 900],
    [EM2GO_REGISTERS.maxCurrent]: overrides.maxCurrent ?? [160],
    [EM2GO_REGISTERS.minCurrent]: overrides.minCurrent ?? [60],
    [EM2GO_REGISTERS.cableMaxCurrent]: overrides.cableMaxCurrent ?? [160],
    [EM2GO_REGISTERS.safeCurrent]: overrides.safeCurrent ?? [60],
    [EM2GO_REGISTERS.commTimeout]: overrides.commTimeout ?? [0],
    [EM2GO_REGISTERS.chargeMode]: overrides.chargeMode ?? [0],
  };
  mockReadHoldingRegisters.mockImplementation((addr: number, len: number) => {
    if (addr >= EM2GO_REGISTERS.serial && addr < EM2GO_REGISTERS.serial + 16) {
      const offset = addr - EM2GO_REGISTERS.serial;
      const words: number[] = [];
      for (let i = 0; i < len; i++) {
        const code = serial.charCodeAt(offset + i);
        words.push(Number.isNaN(code) ? 0 : code);
      }
      return Promise.resolve(regResponse(words));
    }
    return Promise.resolve(regResponse(values[addr] ?? [0]));
  });
}

function newClient() {
  return createWallboxClient({ host: '192.168.1.254', port: 502, unitId: 255 });
}

describe('WallboxClient.connect/disconnect', () => {
  let client: InstanceType<typeof WallboxClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstance.isOpen = false;
    installDefaultSocketBehavior();
    mockRegisters();
    client = newClient();
  });

  afterEach(async () => {
    await client.disconnect();
  });

  it('connects with host/port and sets unit id', async () => {
    await client.connect();

    expect(mockConnectTCP).toHaveBeenCalledWith('192.168.1.254', { port: 502 });
    expect(mockSetID).toHaveBeenCalledWith(255);
  });

  it('reads static registers on connect, serial in 2-register chunks', async () => {
    await client.connect();

    const calls = mockReadHoldingRegisters.mock.calls;
    for (const reg of STATIC_REGISTERS.filter((r) => r !== EM2GO_REGISTERS.serial)) {
      expect(calls).toContainEqual([reg, 1]);
    }
    // Serial: 8 chunks of 2 registers each, never one big 16-register read — the
    // EM2GO's Modbus stack is only known to handle reads of 1-2 registers (evcc
    // never requests more).
    for (let i = 0; i < 8; i++) {
      expect(calls).toContainEqual([EM2GO_REGISTERS.serial + 2 * i, 2]);
    }
    expect(calls).not.toContainEqual([EM2GO_REGISTERS.serial, 16]);
  });

  it('propagates connect errors so the retry loop can retry', async () => {
    mockConnectTCP.mockRejectedValueOnce(new Error('EHOSTUNREACH'));
    await expect(client.connect()).rejects.toThrow('EHOSTUNREACH');
  });

  it('disconnect closes the underlying connection', async () => {
    await client.connect();
    await client.disconnect();

    expect(mockClose).toHaveBeenCalled();
  });

  it('createWallboxClient returns a WallboxClient instance', () => {
    expect(client).toBeInstanceOf(WallboxClient);
  });
});

describe('WallboxClient.getState', () => {
  let client: InstanceType<typeof WallboxClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClientInstance.isOpen = false;
    installDefaultSocketBehavior();
    mockRegisters();
    client = newClient();
    await client.connect();
  });

  afterEach(async () => {
    await client.disconnect();
  });

  it('reads only dynamic registers when polling state', async () => {
    mockReadHoldingRegisters.mockClear();
    await client.getState();

    const readAddrs = mockReadHoldingRegisters.mock.calls.map((c) => c[0] as number);
    for (const reg of STATIC_REGISTERS) {
      expect(readAddrs).not.toContain(reg);
    }
  });

  it('merges connect-time static values into the state', async () => {
    const state = await client.getState();

    expect(state.serial).toBe('WBX-1');
    expect(state.evseMaxCurrentA).toBe(16);
    expect(state.evseMinCurrentA).toBe(6);
    expect(state.cableMaxCurrentA).toBe(16);
    expect(state.safeCurrentA).toBe(6);
    expect(state.commTimeoutS).toBe(0);
    expect(state.chargeMode).toBe(0);
  });

  it('maps status 4 to "charging" and reads power as 32-bit watts', async () => {
    mockRegisters({ status: [4], power: [0, 7360] });
    const state = await client.getState();

    expect(state.status).toBe('charging');
    expect(state.rawStatus).toBe(4);
    expect(state.powerW).toBe(7360);
  });

  it('maps status 1 to "available" and status 2/3/6 to "connected"', async () => {
    mockRegisters({ status: [1] });
    expect((await client.getState()).status).toBe('available');

    mockRegisters({ status: [2] });
    expect((await client.getState()).status).toBe('connected');

    mockRegisters({ status: [6] });
    expect((await client.getState()).status).toBe('connected');
  });

  it('reports vehicleConnected true when connectorState is non-zero', async () => {
    mockRegisters({ connectorState: [1] });
    expect((await client.getState()).vehicleConnected).toBe(true);

    mockRegisters({ connectorState: [0] });
    expect((await client.getState()).vehicleConnected).toBe(false);
  });

  it('scales currentLimit register (0.1A) down to amperes', async () => {
    mockRegisters({ currentLimit: [160] });
    expect((await client.getState()).chargingCurrentA).toBe(16);
  });

  it('caches the last successful read for getLastState()', async () => {
    expect(client.getLastState()).toBeNull();
    const state = await client.getState();
    expect(client.getLastState()).toEqual(state);
  });

  it('isConnected is false before any successful read', () => {
    expect(client.isConnected()).toBe(false);
  });

  it('isConnected is true after a successful getState()', async () => {
    await client.getState();
    expect(client.isConnected()).toBe(true);
  });

  it('isConnected is false after a failed getState(), true again after recovery', async () => {
    await client.getState();
    expect(client.isConnected()).toBe(true);

    mockReadHoldingRegisters.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(client.getState()).rejects.toThrow('ECONNRESET');
    expect(client.isConnected()).toBe(false);

    mockRegisters();
    await client.getState();
    expect(client.isConnected()).toBe(true);
  });

  it('clears the cached state immediately on a failed getState() (no stale data)', async () => {
    await client.getState();
    expect(client.getLastState()).not.toBeNull();

    mockReadHoldingRegisters.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(client.getState()).rejects.toThrow('ECONNRESET');
    expect(client.getLastState()).toBeNull();
  });

  it('tracks consecutiveFailures, resetting to 0 on the next success', async () => {
    await client.getState();
    expect(client.getConnectionInfo().consecutiveFailures).toBe(0);

    mockReadHoldingRegisters.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(client.getState()).rejects.toThrow('ECONNRESET');
    expect(client.getConnectionInfo().consecutiveFailures).toBe(1);

    mockReadHoldingRegisters.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(client.getState()).rejects.toThrow('ECONNRESET');
    expect(client.getConnectionInfo().consecutiveFailures).toBe(2);

    mockRegisters();
    await client.getState();
    expect(client.getConnectionInfo().consecutiveFailures).toBe(0);
  });

  it('sets disconnectedSinceMs on the first failure after a success, keeps it stable across further failures', async () => {
    await client.getState();
    expect(client.getConnectionInfo().disconnectedSinceMs).toBeNull();

    mockReadHoldingRegisters.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(client.getState()).rejects.toThrow('ECONNRESET');
    const firstFailureAt = client.getConnectionInfo().disconnectedSinceMs;
    expect(firstFailureAt).not.toBeNull();

    await new Promise((r) => setTimeout(r, 5));
    mockReadHoldingRegisters.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(client.getState()).rejects.toThrow('ECONNRESET');
    expect(client.getConnectionInfo().disconnectedSinceMs).toBe(firstFailureAt);

    mockRegisters();
    await client.getState();
    expect(client.getConnectionInfo().disconnectedSinceMs).toBeNull();
  });

  it('exposes the last error message via getConnectionInfo()', async () => {
    mockReadHoldingRegisters.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(client.getState()).rejects.toThrow('ECONNRESET');
    expect(client.getConnectionInfo().error).toBe('ECONNRESET');

    mockRegisters();
    await client.getState();
    expect(client.getConnectionInfo().error).toBeNull();
  });

  it('initializing is true only before the first ever successful connect, not after a later disconnect', async () => {
    const freshClient = createWallboxClient({ host: '192.168.1.254', port: 502, unitId: 255 });
    expect(freshClient.getConnectionInfo().initializing).toBe(true);

    await freshClient.connect();
    await freshClient.getState();
    expect(freshClient.getConnectionInfo().initializing).toBe(false);

    mockReadHoldingRegisters.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(freshClient.getState()).rejects.toThrow('ECONNRESET');
    expect(freshClient.getConnectionInfo().initializing).toBe(false);
    expect(freshClient.getConnectionInfo().connected).toBe(false);

    await freshClient.disconnect();
  });

  it('closes the connection on a read error and reconnects on the next request', async () => {
    const connectsBefore = mockConnectTCP.mock.calls.length;
    mockReadHoldingRegisters.mockRejectedValueOnce(new Error('Timed out'));
    await expect(client.getState()).rejects.toThrow('Timed out');

    // evcc closes on every request error: a late response after a timeout would
    // desynchronize all subsequent transactions on the same socket.
    expect(mockClose).toHaveBeenCalled();
    expect(mockClientInstance.isOpen).toBe(false);

    mockRegisters();
    await client.getState();
    expect(mockConnectTCP.mock.calls.length).toBe(connectsBefore + 1);
  });
});

describe('WallboxClient serial decoding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstance.isOpen = false;
    installDefaultSocketBehavior();
  });

  it('decodes one-char-per-word serials (high byte zero)', async () => {
    mockRegisters({ serial: 'ABC' });
    const client = newClient();
    await client.connect();
    expect((await client.getState()).serial).toBe('ABC');
    await client.disconnect();
  });

  it('decodes packed-ASCII serials (two chars per word), like evcc', async () => {
    mockRegisters();
    mockReadHoldingRegisters.mockImplementation((addr: number, len: number) => {
      if (addr >= EM2GO_REGISTERS.serial && addr < EM2GO_REGISTERS.serial + 16) {
        return Promise.resolve(
          regResponse(addr === EM2GO_REGISTERS.serial ? [0x4142, 0x4344] : new Array(len).fill(0)),
        );
      }
      return Promise.resolve(regResponse(new Array(len).fill(0)));
    });
    const client = newClient();
    await client.connect();
    expect((await client.getState()).serial).toBe('ABCD');
    await client.disconnect();
  });
});

describe('WallboxClient control methods', () => {
  let client: InstanceType<typeof WallboxClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClientInstance.isOpen = false;
    installDefaultSocketBehavior();
    mockRegisters();
    client = newClient();
    await client.connect();
    mockWriteRegisters.mockClear();
  });

  afterEach(async () => {
    await client.disconnect();
  });

  it('startCharging writes ChargeCommand=1, then restores the last commanded current', async () => {
    await client.startCharging();
    expect(mockWriteRegisters.mock.calls).toEqual([
      [EM2GO_REGISTERS.chargeCommand, [1]],
      // No current commanded yet — restore the minimum (6A) so the box never
      // sits enabled at the 0A that stopCharging parks it at.
      [EM2GO_REGISTERS.currentLimit, [60]],
    ]);
  });

  it('startCharging restores the most recently set current', async () => {
    await client.setChargingCurrent(10);
    mockWriteRegisters.mockClear();

    await client.startCharging();
    expect(mockWriteRegisters.mock.calls).toEqual([
      [EM2GO_REGISTERS.chargeCommand, [1]],
      [EM2GO_REGISTERS.currentLimit, [100]],
    ]);
  });

  it('stopCharging writes ChargeCommand=2, then parks the current limit at 0', async () => {
    await client.stopCharging();
    expect(mockWriteRegisters.mock.calls).toEqual([
      [EM2GO_REGISTERS.chargeCommand, [2]],
      [EM2GO_REGISTERS.currentLimit, [0]],
    ]);
  });

  it('setChargingCurrent writes the scaled 0.1A value for valid input', async () => {
    await client.setChargingCurrent(10);
    expect(mockWriteRegisters).toHaveBeenCalledWith(EM2GO_REGISTERS.currentLimit, [100]);
  });

  it('setChargingCurrent throws for values below 6A and does not write', async () => {
    await expect(client.setChargingCurrent(5)).rejects.toThrow(/6.*16/);
    expect(mockWriteRegisters).not.toHaveBeenCalled();
  });

  it('setChargingCurrent throws for values above 16A and does not write', async () => {
    await expect(client.setChargingCurrent(17)).rejects.toThrow(/6.*16/);
    expect(mockWriteRegisters).not.toHaveBeenCalled();
  });

  it('setPhases writes 1 or 3 to the phases register', async () => {
    await client.setPhases(1);
    expect(mockWriteRegisters).toHaveBeenCalledWith(EM2GO_REGISTERS.phases, [1]);

    await client.setPhases(3);
    expect(mockWriteRegisters).toHaveBeenCalledWith(EM2GO_REGISTERS.phases, [3]);
  });

  it('closes the connection when a write fails so the next request reconnects', async () => {
    const connectsBefore = mockConnectTCP.mock.calls.length;
    mockWriteRegisters.mockRejectedValueOnce(new Error('Timed out'));
    await expect(client.setPhases(3)).rejects.toThrow('Timed out');

    expect(mockClose).toHaveBeenCalled();
    expect(mockClientInstance.isOpen).toBe(false);

    await client.setPhases(3);
    expect(mockConnectTCP.mock.calls.length).toBe(connectsBefore + 1);
  });
});

describe('WallboxClient heartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstance.isOpen = false;
    installDefaultSocketBehavior();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function connectWithFakeTimers(client: InstanceType<typeof WallboxClient>) {
    const pending = client.connect();
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
  }

  it('reads SafeCurrent every commTimeout/2 to keep the failsafe from tripping', async () => {
    mockRegisters({ commTimeout: [60] });
    const client = newClient();
    await connectWithFakeTimers(client);

    mockReadHoldingRegisters.mockClear();
    await vi.advanceTimersByTimeAsync(30_000 + 1000);
    expect(mockReadHoldingRegisters.mock.calls).toContainEqual([EM2GO_REGISTERS.safeCurrent, 1]);

    await client.disconnect();
  });

  it('does not start a heartbeat when the box reports no failsafe timeout', async () => {
    mockRegisters({ commTimeout: [0] });
    const client = newClient();
    await connectWithFakeTimers(client);

    mockReadHoldingRegisters.mockClear();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(mockReadHoldingRegisters).not.toHaveBeenCalled();

    await client.disconnect();
  });

  it('disconnect stops the heartbeat', async () => {
    mockRegisters({ commTimeout: [60] });
    const client = newClient();
    await connectWithFakeTimers(client);
    await client.disconnect();

    mockReadHoldingRegisters.mockClear();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mockReadHoldingRegisters).not.toHaveBeenCalled();
  });
});

describe('WallboxClient polling', () => {
  let client: InstanceType<typeof WallboxClient>;

  // Each getState() sleeps INTER_REQUEST_DELAY_MS before every register read
  // (~14 dynamic reads), so a tick needs the 5000ms interval plus headroom for
  // that chain to fully settle before the callback fires.
  const TICK_MS = 5000;
  const SETTLE_MS = 2000;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClientInstance.isOpen = false;
    installDefaultSocketBehavior();
    vi.useFakeTimers();
    mockRegisters({ commTimeout: [0] });
    client = newClient();
    const pending = client.connect();
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
  });

  afterEach(() => {
    client.stopPolling();
    vi.useRealTimers();
  });

  it('calls the callback with state on each interval tick', async () => {
    const callback = vi.fn();

    client.startPolling(TICK_MS, callback);
    await vi.advanceTimersByTimeAsync(TICK_MS + SETTLE_MS);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].rawStatus).toBe(4);
  });

  it('logs a failed poll, closes the socket and reconnects on the next tick', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const connectsBefore = mockConnectTCP.mock.calls.length;
    mockReadHoldingRegisters.mockRejectedValueOnce(new Error('Timed out'));
    const callback = vi.fn();

    client.startPolling(TICK_MS, callback);
    await vi.advanceTimersByTimeAsync(TICK_MS + SETTLE_MS);
    expect(callback).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[wallbox] Poll error:', 'Timed out');
    expect(mockClose).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(TICK_MS + SETTLE_MS);
    expect(mockConnectTCP.mock.calls.length).toBe(connectsBefore + 1);
    expect(callback).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it('does not start an overlapping poll while the previous one is still in flight', async () => {
    let resolveRead: (() => void) | null = null;
    mockReadHoldingRegisters.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = () => resolve(regResponse([4]));
        }),
    );
    const callback = vi.fn();

    client.startPolling(TICK_MS, callback);
    // Let the first tick fire and start its (never-resolving-yet) read — the client
    // sleeps INTER_REQUEST_DELAY_MS before actually calling readHoldingRegisters.
    await vi.advanceTimersByTimeAsync(TICK_MS + 200);
    const callsAfterFirstTick = mockReadHoldingRegisters.mock.calls.length;
    expect(callsAfterFirstTick).toBeGreaterThan(0);

    // Several more ticks fire while the first read is still pending — none of them
    // should queue up a second concurrent getState() call.
    await vi.advanceTimersByTimeAsync(3 * TICK_MS);
    expect(mockReadHoldingRegisters).toHaveBeenCalledTimes(callsAfterFirstTick);

    // Unblock the stuck read, and let every subsequent register read in that same
    // chain resolve normally so the in-flight getState() can finish.
    resolveRead!();
    mockRegisters({ commTimeout: [0] });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('runs a control command issued after a failed poll against a fresh connection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockReadHoldingRegisters.mockRejectedValueOnce(new Error('Timed out'));

    client.startPolling(TICK_MS, vi.fn());
    await vi.advanceTimersByTimeAsync(TICK_MS + SETTLE_MS);
    expect(mockClientInstance.isOpen).toBe(false);

    mockConnectTCP.mockClear();
    mockWriteRegisters.mockClear();
    const pending = client.startCharging();
    await vi.advanceTimersByTimeAsync(1000);
    await pending;

    // The write must have reopened the connection first, then written.
    expect(mockConnectTCP).toHaveBeenCalledTimes(1);
    expect(mockWriteRegisters).toHaveBeenCalled();
    expect(mockConnectTCP.mock.invocationCallOrder[0]).toBeLessThan(
      mockWriteRegisters.mock.invocationCallOrder[0],
    );

    errorSpy.mockRestore();
  });

  it('stopPolling stops further callbacks', async () => {
    const callback = vi.fn();

    client.startPolling(TICK_MS, callback);
    await vi.advanceTimersByTimeAsync(TICK_MS + SETTLE_MS);
    expect(callback).toHaveBeenCalledTimes(1);

    client.stopPolling();
    await vi.advanceTimersByTimeAsync(3 * TICK_MS);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
