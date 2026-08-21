import { Queue } from "bullmq";
import { QUEUE_NAME, JobData, SupportRequest } from "../shared";
import { createRedis } from "../shared/redis";

const connection = createRedis();

export const queue = new Queue<JobData>(QUEUE_NAME, { connection });

export async function enqueueRequest(request: SupportRequest): Promise<string | undefined> {
  // jobId = requestId dedupes duplicate Slack events (e.g. a retry).
  const job = await queue.add(
    "investigate",
    { request },
    {
      jobId: request.requestId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 50,
    }
  );
  return job.id;
}
