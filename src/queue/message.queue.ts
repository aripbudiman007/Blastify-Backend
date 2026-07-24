import { Queue } from 'bullmq';
import { getRedisClient } from '../redis/client';

export interface MessageJobData {
  messageId: string;
  deviceId: string;
  userId: string;
  to: string;
  type: string;
  content: string;
  mediaUrl?: string;
  caption?: string;
  // Per-device anti-ban delay (ms). Falls back to global config if not set.
  minDelay?: number;
  maxDelay?: number;
  // Link preview control (undefined = auto, false = disabled)
  linkPreview?: boolean;
  // Plan info for watermark injection
  userPlan?: string;
}

const QUEUE_NAME = 'wa-messages';

let messageQueue: Queue<MessageJobData> | null = null;

export function getMessageQueue(): Queue<MessageJobData> {
  if (!messageQueue) {
    messageQueue = new Queue<MessageJobData>(QUEUE_NAME, {
      connection: getRedisClient(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5_000,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return messageQueue;
}

export async function enqueueMessage(
  data: MessageJobData,
  delay?: number,
): Promise<string> {
  const queue = getMessageQueue();
  const job = await queue.add(`send:${data.deviceId}`, data, {
    delay,
    jobId: data.messageId,
  });
  return job.id!;
}
