import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockConnectTCP = vi.fn().mockResolvedValue(undefined);
const mockSetID = vi.fn();
const mockClose = vi.fn((cb: () => void) => cb());
const mockReadHoldingRegisters = vi.fn();
const mockWriteRegisters = vi.fn().mockResolvedValue(undefined);

vi.mock('modbus-serial', () => ({
  default: vi.fn().mockImplementation(() => ({
    connectTCP: mockConnectTCP,
    setID: mockSetID,
    close: mockClose,
    readHoldingRegisters: mockReadHoldingRegisters,
    writeRegisters: mockWriteRegisters,
  })),
}));

const { WallboxClient, createWallboxClient } = await import('../wallbox/WallboxClient.js');
const { EM2GO_REGISTERS } = await import('../wallbox/types.js');

function regResponse(values: number[]) {
  return { data: values, buffer: Buffer.alloc(values.length * 2) };
}

describe('WallboxClient.connect/disconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadHoldingRegisters.mockResolvedValue(regResponse([0]));
  });

  it('connects with host/port and sets unit id', async () => {
    const client = createWallboxClient({ host: '192.168.1.254', port: 502, unitId: 255 });
    await client.connect();

    expect(mockConnectTCP).toHaveBeenCalledWith('192.168.1.254', { port: 502 });
    expect(mockSetID).toHaveBeenCalledWith(255);
  });

  it('disconnect closes the underlying connection', async () => {
    const client = createWallboxClient({ host: '192.168.1.254', port: 502, unitId: 255 });
    await client.connect();
    await client.disconnect();

    expect(mockClose).toHaveBeenCalled();
  });

  it('createWallboxClient returns a WallboxClient instance', () => {
    const client = createWallboxClient({ host: 'x', port: 502, unitId: 255 });
    expect(client).toBeInstanceOf(WallboxClient);
  });
});

describe('WallboxClient.getState', () => {
  let client: InstanceType<typeof WallboxClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    client = createWallboxClient({ host: '192.168.1.254', port: 502, unitId: 255 });
    await client.connect();
  });

  function mockRegisters(overrides: Partial<Record<keyof typeof EM2GO_REGISTERS, number[]>> = {}) {
    const values: Record<number, number[]> = {
      [EM2GO_REGISTERS.status]: overrides.status ?? [4],
      [EM2GO_REGISTERS.connectorState]: overrides.connectorState ?? [1],
      [EM2GO_REGISTERS.errorCode]: overrides.errorCode ?? [0],
      [EM2GO_REGISTERS.power]: overrides.power ?? [0, 7360],
      [EM2GO_REGISTERS.energy]: overrides.energy ?? [0, 123],
      [EM2GO_REGISTERS.currentLimit]: overrides.currentLimit ?? [160],
      [EM2GO_REGISTERS.currents]: overrides.currents ?? [107],
      [EM2GO_REGISTERS.currents + 2]: overrides['currents+2' as never] ?? [107],
      [EM2GO_REGISTERS.currents + 4]: overrides['currents+4' as never] ?? [107],
      [EM2GO_REGISTERS.voltages]: overrides.voltages ?? [2300],
      [EM2GO_REGISTERS.voltages + 2]: overrides['voltages+2' as never] ?? [2300],
      [EM2GO_REGISTERS.voltages + 4]: overrides['voltages+4' as never] ?? [2300],
      [EM2GO_REGISTERS.phases]: overrides.phases ?? [3],
      [EM2GO_REGISTERS.chargeDuration]: overrides.chargeDuration ?? [0, 900],
      [EM2GO_REGISTERS.maxCurrent]: overrides.maxCurrent ?? [160],
      [EM2GO_REGISTERS.minCurrent]: overrides.minCurrent ?? [60],
      [EM2GO_REGISTERS.cableMaxCurrent]: overrides.cableMaxCurrent ?? [160],
      [EM2GO_REGISTERS.safeCurrent]: overrides.safeCurrent ?? [60],
      [EM2GO_REGISTERS.commTimeout]: overrides.commTimeout ?? [60],
      [EM2GO_REGISTERS.chargeMode]: overrides.chargeMode ?? [0],
    };
    mockReadHoldingRegisters.mockImplementation((addr: number, len: number) => {
      if (addr === EM2GO_REGISTERS.serial) {
        const word = 'A'.charCodeAt(0);
        return Promise.resolve(regResponse(new Array(len).fill(word)));
      }
      return Promise.resolve(regResponse(values[addr] ?? [0]));
    });
  }

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
    mockRegisters({});
    const state = await client.getState();
    expect(client.getLastState()).toEqual(state);
  });

  it('decodes serial number correctly from register words', async () => {
    // Mock serial registers with char codes for "ABC" plus null padding
    const serialChars = [
      'A'.charCodeAt(0), // 65
      'B'.charCodeAt(0), // 66
      'C'.charCodeAt(0), // 67
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // padding to 16 words
    ];
    mockReadHoldingRegisters.mockImplementation((addr: number, len: number) => {
      if (addr === EM2GO_REGISTERS.serial) {
        return Promise.resolve(regResponse(serialChars));
      }
      // Use default mock registers for other addresses
      const values: Record<number, number[]> = {
        [EM2GO_REGISTERS.status]: [4],
        [EM2GO_REGISTERS.connectorState]: [1],
        [EM2GO_REGISTERS.errorCode]: [0],
        [EM2GO_REGISTERS.power]: [0, 7360],
        [EM2GO_REGISTERS.energy]: [0, 123],
        [EM2GO_REGISTERS.currentLimit]: [160],
        [EM2GO_REGISTERS.currents]: [107],
        [EM2GO_REGISTERS.currents + 2]: [107],
        [EM2GO_REGISTERS.currents + 4]: [107],
        [EM2GO_REGISTERS.voltages]: [2300],
        [EM2GO_REGISTERS.voltages + 2]: [2300],
        [EM2GO_REGISTERS.voltages + 4]: [2300],
        [EM2GO_REGISTERS.phases]: [3],
        [EM2GO_REGISTERS.chargeDuration]: [0, 900],
        [EM2GO_REGISTERS.maxCurrent]: [160],
        [EM2GO_REGISTERS.minCurrent]: [60],
        [EM2GO_REGISTERS.cableMaxCurrent]: [160],
        [EM2GO_REGISTERS.safeCurrent]: [60],
        [EM2GO_REGISTERS.commTimeout]: [60],
        [EM2GO_REGISTERS.chargeMode]: [0],
      };
      return Promise.resolve(regResponse(values[addr] ?? [0]));
    });
    const state = await client.getState();
    expect(state.serial).toBe('ABC');
  });
});

describe('WallboxClient control methods', () => {
  let client: InstanceType<typeof WallboxClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    client = createWallboxClient({ host: '192.168.1.254', port: 502, unitId: 255 });
    await client.connect();
  });

  it('startCharging writes ChargeCommand=1 via writeRegisters (FC16)', async () => {
    await client.startCharging();
    expect(mockWriteRegisters).toHaveBeenCalledWith(EM2GO_REGISTERS.chargeCommand, [1]);
  });

  it('stopCharging writes ChargeCommand=2', async () => {
    await client.stopCharging();
    expect(mockWriteRegisters).toHaveBeenCalledWith(EM2GO_REGISTERS.chargeCommand, [2]);
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
});

describe('WallboxClient polling', () => {
  let client: InstanceType<typeof WallboxClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    client = createWallboxClient({ host: '192.168.1.254', port: 502, unitId: 255 });
    await client.connect();
  });

  afterEach(() => {
    client.stopPolling();
    vi.useRealTimers();
  });

  it('calls the callback with state on each interval tick', async () => {
    mockReadHoldingRegisters.mockResolvedValue(regResponse([4]));
    const callback = vi.fn();

    client.startPolling(5000, callback);
    await vi.advanceTimersByTimeAsync(5000);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].rawStatus).toBe(4);
  });

  it('logs and continues polling when a poll fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockReadHoldingRegisters.mockRejectedValueOnce(new Error('ECONNRESET'));
    mockReadHoldingRegisters.mockResolvedValue(regResponse([4]));
    const callback = vi.fn();

    client.startPolling(5000, callback);
    await vi.advanceTimersByTimeAsync(5000);
    expect(callback).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[wallbox] Poll error:', 'ECONNRESET');

    await vi.advanceTimersByTimeAsync(5000);
    expect(callback).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it('stopPolling stops further callbacks', async () => {
    mockReadHoldingRegisters.mockResolvedValue(regResponse([4]));
    const callback = vi.fn();

    client.startPolling(5000, callback);
    await vi.advanceTimersByTimeAsync(5000);
    expect(callback).toHaveBeenCalledTimes(1);

    client.stopPolling();
    await vi.advanceTimersByTimeAsync(15000);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
