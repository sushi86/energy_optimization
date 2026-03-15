import webPush from 'web-push';
import fs from 'node:fs';
import { resolve, dirname } from 'path';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let vapidKeys: VapidKeys | null = null;

export function initVapid(dataDir: string): VapidKeys {
  const keyPath = resolve(dataDir, 'vapid-keys.json');

  try {
    const content = fs.readFileSync(keyPath, 'utf-8');
    vapidKeys = JSON.parse(content) as VapidKeys;
    console.log('[vapid] Loaded existing VAPID keys');
  } catch {
    const keys = webPush.generateVAPIDKeys();
    vapidKeys = { publicKey: keys.publicKey, privateKey: keys.privateKey };
    fs.mkdirSync(dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, JSON.stringify(vapidKeys, null, 2), 'utf-8');
    console.log('[vapid] Generated new VAPID keys');
  }

  const subject = process.env.VAPID_SUBJECT ?? 'mailto:energy@example.com';
  webPush.setVapidDetails(subject, vapidKeys.publicKey, vapidKeys.privateKey);

  return vapidKeys;
}

export function getVapidPublicKey(): string {
  if (!vapidKeys) throw new Error('VAPID not initialized — call initVapid() first');
  return vapidKeys.publicKey;
}
