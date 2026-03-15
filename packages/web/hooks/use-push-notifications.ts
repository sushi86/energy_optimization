'use client';

import { useEffect, useState, useCallback } from 'react';

interface PushState {
  supported: boolean;
  subscribed: boolean;
  loading: boolean;
  error: string | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer as ArrayBuffer;
}

export function usePushNotifications(): PushState {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const isSupported = 'serviceWorker' in navigator && 'PushManager' in window;
    setSupported(isSupported);

    if (!isSupported) {
      setLoading(false);
      return;
    }

    // Register SW first, then check existing subscription
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Wait for the SW to be active
        if (reg.active) return reg;
        return navigator.serviceWorker.ready;
      })
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        setSubscribed(sub !== null);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[push] Init failed:', err);
        setLoading(false);
      });
  }, []);

  const subscribe = useCallback(async () => {
    if (!supported) return;
    setLoading(true);

    try {
      setError(null);

      // Register service worker if not already
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      // Get VAPID key from backend
      const vapidRes = await fetch('/api/push/vapid-key');
      if (!vapidRes.ok) throw new Error(`VAPID-Key Fehler: ${vapidRes.status}`);
      const { publicKey } = await vapidRes.json();
      if (!publicKey) throw new Error('Kein VAPID Public Key vom Server');

      // Subscribe to push
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // Send subscription to backend
      const subRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!subRes.ok) throw new Error(`Subscription speichern fehlgeschlagen: ${subRes.status}`);

      setSubscribed(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[push] Subscribe failed:', msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [supported]);

  const unsubscribe = useCallback(async () => {
    if (!supported) return;
    setLoading(true);

    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();

      if (subscription) {
        // Remove from backend
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });

        // Unsubscribe locally
        await subscription.unsubscribe();
      }

      setSubscribed(false);
    } catch (err) {
      console.error('[push] Unsubscribe failed:', err);
    } finally {
      setLoading(false);
    }
  }, [supported]);

  return { supported, subscribed, loading, error, subscribe, unsubscribe };
}
