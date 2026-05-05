export interface CoverActuator {
  setPosition(entityId: string, position: number): Promise<void>;
  observePosition(cb: (entityId: string, position: number) => void): void;
  current(entityId: string): number | null;
}

export interface IndoorTempSource {
  current(): number | null;
  observe(cb: (value: number) => void): void;
}

export interface PvPowerSource {
  current(): number | null;
  observe(cb: (powerW: number) => void): void;
}
