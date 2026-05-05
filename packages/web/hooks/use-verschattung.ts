'use client';
import { useEffect, useState } from 'react';
import type { components } from '@energy-control/shared';

export type VerschattungState = components['schemas']['VerschattungStateResponse'];
export type VerschattungDecision = components['schemas']['VerschattungDecision'];

export interface UseVerschattungResult {
  state: VerschattungState | null;
  decisions: VerschattungDecision[];
}

export function useVerschattung(): UseVerschattungResult {
  const [state, setState] = useState<VerschattungState | null>(null);
  const [decisions, setDecisions] = useState<VerschattungDecision[]>([]);

  useEffect(() => {
    let alive = true;
    let ws: WebSocket | null = null;

    const connect = () => {
      ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.verschattung) {
            setDecisions(msg.verschattung.recentDecisions ?? []);
          }
        } catch { /* ignore */ }
      };
    };
    const refresh = async () => {
      try {
        const r = await fetch('/api/verschattung/state');
        if (r.ok && alive) setState(await r.json());
      } catch { /* ignore */ }
      try {
        const r = await fetch('/api/verschattung/decisions');
        if (r.ok && alive) setDecisions(await r.json());
      } catch { /* ignore */ }
    };

    connect();
    refresh();
    const refreshInterval = setInterval(refresh, 30_000);
    return () => {
      alive = false;
      ws?.close();
      clearInterval(refreshInterval);
    };
  }, []);

  return { state, decisions };
}
