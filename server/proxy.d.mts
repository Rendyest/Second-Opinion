import type { Server } from 'node:http';

export interface CoachServerOptions {
  apiKey: string;
  timeoutMs: number;
  cooldownMs: number;
  maxReplyChars: number;
  fetchImpl?: typeof fetch;
}

export function createCoachServer(options: CoachServerOptions): Server;
