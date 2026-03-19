'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

export interface ControllerDetails {
  currentSurplusW: number;
  desiredChargePowerW: number;
  feedInW: number;
  batteryNeedKwh: number;
  remainingHours: number;
  remainingForecastKwh: number;
  isClippingRisk: boolean;
  earlyClippingOverride: boolean;
  batterySoc: number;
  targetSocPercent: number;
  goal: string;
  // Predictive clipping fields
  forcedChargeKwh: number;
  voluntaryChargeKwh: number;
  clippingHours: number;
  strategy: string;
  priceOptimization?: {
    active: boolean;
    currentPriceEurMwh: number | null;
    avgPriceEurMwh: number;
    mode: 'feed-in' | 'charge' | 'negative';
    reason: string;
  };
}

export interface ChargePlanSlot {
  hour: number;
  minute: number;
  timestamp: string;
  chargePowerW: number;
  feedInPowerW: number;
  forecastW: number;
  estimatedSoc: number;
  revenueFixedCent: number;
  revenueMarketCent: number;
  clippingW: number;
  consumptionW: number;
}

export interface ChargePlan {
  slots: ChargePlanSlot[];
  intervalMinutes: 15;
  totalFeedInKwh: number;
  totalRevenueFixedCent: number;
  totalRevenueMarketCent: number;
  feedInRateCentPerKwh: number;
  estimatedFullHour: number | null;
  currentSoc: number;
  forecastCorrectionFactor: number;
  negativeStreak6hActive?: boolean;
  negativeStreak6hDeductionCent?: number;
}

export interface SystemStatus {
  pv: { power: number };
  grid: { power: number; setpoint: number };
  battery: { power: number; soc: number };
  consumption: { power: number };
  inverter?: {
    phases: {
      L1: number;
      L2: number;
      L3: number;
      feedIn: { L1: number; L2: number; L3: number };
      selfConsumption: { L1: number; L2: number; L3: number };
    };
  };
  controller: { mode: string; activeSetpoint: number; reason?: string; details?: ControllerDetails | null };
  batteryCapacityKwh?: number;
  priceOptimizationEnabled?: boolean;
  forecastCorrectionOverride?: number | null;
  multiplusRatedPowerW?: number;
  pvPeakKwp?: number;
  regulation?: { lastTime: string; intervalMs: number };
  chargePlan?: ChargePlan | null;
  priceError?: string | null;
  mpptTemperatureC?: number | null;
  heatPumpPowerW?: number | null;
  wallboxPowerW?: number | null;
  timestamp: string;
}

export function useWebSocket() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stalenessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const RECONNECT_INTERVAL = 3000;
  const CONNECT_TIMEOUT = 5000;
  const STALENESS_TIMEOUT = 15000;
  const ALIVE_CHECK_INTERVAL = 10000;

  const clearTimers = useCallback(() => {
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
    if (connectTimeout.current) { clearTimeout(connectTimeout.current); connectTimeout.current = null; }
    if (stalenessTimer.current) { clearTimeout(stalenessTimer.current); stalenessTimer.current = null; }
    if (aliveInterval.current) { clearInterval(aliveInterval.current); aliveInterval.current = null; }
  }, []);

  const scheduleReconnect = useCallback((fn: () => void) => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnectTimer.current = setTimeout(fn, RECONNECT_INTERVAL);
  }, []);

  const forceReconnect = useCallback(() => {
    clearTimers();
    // Close existing connection
    const old = wsRef.current;
    wsRef.current = null;
    if (old) {
      old.onclose = null;
      old.onerror = null;
      old.close();
    }
    setConnected(false);

    if (typeof window === 'undefined') return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    // If stuck in CONNECTING for too long, kill and retry
    connectTimeout.current = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
        if (wsRef.current === ws) {
          wsRef.current = null;
          setConnected(false);
          scheduleReconnect(forceReconnect);
        }
      }
    }, CONNECT_TIMEOUT);

    const resetStaleness = () => {
      if (stalenessTimer.current) clearTimeout(stalenessTimer.current);
      stalenessTimer.current = setTimeout(() => {
        // No message received for too long — reconnect
        if (wsRef.current === ws) {
          forceReconnect();
        }
      }, STALENESS_TIMEOUT);
    };

    ws.onopen = () => {
      if (connectTimeout.current) { clearTimeout(connectTimeout.current); connectTimeout.current = null; }
      setConnected(true);
      resetStaleness();

      // Periodic alive check — iOS can silently kill sockets without firing onclose
      if (aliveInterval.current) clearInterval(aliveInterval.current);
      aliveInterval.current = setInterval(() => {
        if (wsRef.current !== ws) return;
        if (ws.readyState !== WebSocket.OPEN) {
          forceReconnect();
        }
      }, ALIVE_CHECK_INTERVAL);
    };

    ws.onclose = () => {
      setConnected(false);
      if (wsRef.current === ws) {
        wsRef.current = null;
        scheduleReconnect(forceReconnect);
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror, so just let it handle reconnect
    };

    ws.onmessage = (event) => {
      resetStaleness();
      try {
        setStatus(JSON.parse(event.data));
      } catch { /* ignore */ }
    };
  }, [clearTimers, scheduleReconnect]);

  useEffect(() => {
    forceReconnect();

    // iOS Safari kills WebSocket in background but readyState stays OPEN.
    // Always force a fresh connection when page becomes visible again.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        forceReconnect();
      }
    };

    // Safari bfcache: pageshow fires when restoring from cache
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        forceReconnect();
      }
    };

    const handleOnline = () => forceReconnect();

    // focus event covers cases where visibilitychange doesn't fire on iOS
    const handleFocus = () => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        forceReconnect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleFocus);
      clearTimers();
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    };
  }, [forceReconnect, clearTimers]);

  return { status, connected, reconnect: forceReconnect };
}
