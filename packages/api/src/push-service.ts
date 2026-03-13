import webPush from 'web-push';
import fs from 'node:fs';
import { resolve, dirname } from 'path';

export interface NotificationPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

interface StoredSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export class PushService {
  private subscriptions: StoredSubscription[] = [];
  private filePath: string;

  constructor(dataDir: string) {
    this.filePath = resolve(dataDir, 'push-subscriptions.json');
    this.load();
  }

  subscribe(subscription: StoredSubscription): void {
    // Avoid duplicates by endpoint
    const existing = this.subscriptions.findIndex(s => s.endpoint === subscription.endpoint);
    if (existing >= 0) {
      this.subscriptions[existing] = subscription;
    } else {
      this.subscriptions.push(subscription);
    }
    this.save();
    console.log(`[push] Subscription added (total: ${this.subscriptions.length})`);
  }

  unsubscribe(endpoint: string): void {
    this.subscriptions = this.subscriptions.filter(s => s.endpoint !== endpoint);
    this.save();
    console.log(`[push] Subscription removed (total: ${this.subscriptions.length})`);
  }

  getSubscriptionCount(): number {
    return this.subscriptions.length;
  }

  async sendNotification(payload: NotificationPayload): Promise<void> {
    if (this.subscriptions.length === 0) {
      console.log('[push] No subscribers — skipping notification');
      return;
    }

    const jsonPayload = JSON.stringify(payload);
    const expiredEndpoints: string[] = [];

    await Promise.allSettled(
      this.subscriptions.map(async (sub) => {
        try {
          await webPush.sendNotification(sub, jsonPayload);
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 410 || statusCode === 404) {
            // Subscription expired or not found
            expiredEndpoints.push(sub.endpoint);
          } else {
            console.error('[push] Send error:', (err as Error).message);
          }
        }
      }),
    );

    // Clean up expired subscriptions
    if (expiredEndpoints.length > 0) {
      this.subscriptions = this.subscriptions.filter(
        s => !expiredEndpoints.includes(s.endpoint),
      );
      this.save();
      console.log(`[push] Removed ${expiredEndpoints.length} expired subscription(s)`);
    }
  }

  private load(): void {
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      this.subscriptions = JSON.parse(content) as StoredSubscription[];
      console.log(`[push] Loaded ${this.subscriptions.length} subscription(s)`);
    } catch {
      // No file yet
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.subscriptions, null, 2), 'utf-8');
    } catch (err) {
      console.error('[push] Failed to save subscriptions:', err);
    }
  }
}
