import { z } from 'zod';

const configSchema = z.object({
  VICTRON_MQTT_URL: z.string().default('tcp://192.168.1.224:1883'),
  VICTRON_DEVICE_ID: z.string().default('c0619ab5450c'),
  VICTRON_VRM_TOKEN: z.string().min(1),
  VICTRON_VRM_SITE_ID: z.string().min(1),
  BATTERY_CAPACITY_KWH: z.coerce.number().default(16),
  MIN_SOC_PERCENT: z.coerce.number().default(20),
  TARGET_SOC_PERCENT: z.coerce.number().default(100),
  MAX_AC_POWER_W: z.coerce.number().default(12000),
  WINTER_MODE_THRESHOLD_FACTOR: z.coerce.number().default(1.2),
  REGULATION_INTERVAL_MS: z.coerce.number().default(20000),
  LARGE_CHANGE_THRESHOLD_W: z.coerce.number().default(3000),
  DEADBAND_W: z.coerce.number().default(50),
  PRICE_OPTIMIZATION: z.coerce.boolean().default(false),
  ALLOW_FEED_IN_NEGATIVE_PRICE: z.coerce.boolean().default(false),
  FEED_IN_RATE_CENT_PER_KWH: z.coerce.number().default(7),
  PREFERRED_MAX_CHARGE_W: z.coerce.number().default(5000),
  ACTIVE_MORNING_DISCHARGE: z.coerce.boolean().default(false),
  ACTIVE_MORNING_DISCHARGE_MIN_SOC_PERCENT: z.coerce.number().default(5),
  MANUAL_MODE_FLOOR_PERCENT: z.coerce.number().default(50),
  INEXOGY_EMAIL: z.string().optional(),
  INEXOGY_PASSWORD: z.string().optional(),
  INEXOGY_METER_ID: z.string().optional(),
  NIBE_URL: z.string().optional(),
  NIBE_USERNAME: z.string().optional(),
  NIBE_PASSWORD: z.string().optional(),
  WALLBOX_URL: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse(process.env);
}
