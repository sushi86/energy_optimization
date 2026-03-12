import { z } from 'zod';

const configSchema = z.object({
  VICTRON_MQTT_URL: z.string().min(1),
  VICTRON_DEVICE_ID: z.string().min(1),
  VICTRON_VRM_TOKEN: z.string().min(1),
  VICTRON_VRM_SITE_ID: z.string().min(1),
  BATTERY_CAPACITY_KWH: z.coerce.number().default(16),
  MIN_SOC_PERCENT: z.coerce.number().default(20),
  TARGET_SOC_PERCENT: z.coerce.number().default(100),
  MAX_AC_POWER_W: z.coerce.number().default(12000),
  WINTER_MODE_THRESHOLD_FACTOR: z.coerce.number().default(1.2),
  REGULATION_INTERVAL_MS: z.coerce.number().default(20000),
  LARGE_CHANGE_THRESHOLD_W: z.coerce.number().default(3000),
  DEADBAND_W: z.coerce.number().default(1500),
  PRICE_OPTIMIZATION: z.coerce.boolean().default(false),
  FEED_IN_RATE_CENT_PER_KWH: z.coerce.number().default(7),
  PREFERRED_MAX_CHARGE_W: z.coerce.number().default(5000),
  INEXOGY_EMAIL: z.string().optional(),
  INEXOGY_PASSWORD: z.string().optional(),
  INEXOGY_METER_ID: z.string().optional(),
  MPPT_TEMPERATURE_URL: z.string().optional(),
  DEPLOY_SERVER: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse(process.env);
}
