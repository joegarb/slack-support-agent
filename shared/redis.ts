import IORedis from "ioredis";

// BullMQ requires maxRetriesPerRequest: null so its blocking job-wait commands aren't aborted.
export function createRedis(): IORedis {
  const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  return new IORedis(url, { maxRetriesPerRequest: null });
}
