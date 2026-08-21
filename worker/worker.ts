import { Worker } from "bullmq";
import { QUEUE_NAME, JobData } from "../shared";
import { createRedis } from "../shared/redis";
import { runAgent } from "./agent";
import { addProgressReaction, removeProgressReaction } from "./writeback";

const connection = createRedis();

// One job at a time — scale out with more replicas, not in-process concurrency.
// lockDuration is 5m because an agent run far exceeds BullMQ's 30s default, which
// would otherwise flag the job as stalled and re-run it.
export const worker = new Worker<JobData>(
  QUEUE_NAME,
  async (job) => {
    console.log(`\n[worker] ▶ job ${job.id} (attempt ${job.attemptsMade + 1})`);
    const { slackChannel, slackThreadTs } = job.data.request;
    // React to show the message is being worked on; clear it either way when done.
    await addProgressReaction(slackChannel, slackThreadTs);
    try {
      return await runAgent(job.data.request);
    } finally {
      await removeProgressReaction(slackChannel, slackThreadTs);
    }
  },
  { connection, concurrency: 1, lockDuration: 5 * 60 * 1000 }
);

worker.on("completed", (job) => console.log(`[worker] ✅ job ${job.id} completed\n`));
worker.on("failed", (job, err) => console.log(`[worker] ❌ job ${job?.id} failed: ${err.message}\n`));
