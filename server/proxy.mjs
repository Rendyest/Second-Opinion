/**
 * Coach proxy: the only server route the app calls. The client POSTs ONLY
 * the aggregate summary object to /api/coach (see src/coach/summary.ts);
 * this server validates it, forwards it to the configured Muse Spark
 * endpoint, and returns the coaching message.
 *
 * - The key comes from the server environment (see .env.example).
 * - Timeout and cooldown come from src/config/config.default.json.
 * - Cooldown starts after every proxied call, success or failure.
 * - Failures and fallbacks are logged to the console only, never with
 *   request values. Nothing is written to disk or sent anywhere else.
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { validateCoachSummary } from './validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BODY_LIMIT = 100 * 1024;
const MUSE_RESPONSES_URL = 'https://api.meta.ai/v1/responses';
/** Model judges must see named in the terminal log and on screen. */
const COACH_MODEL = 'muse-spark-1.3';

function loadCoachConfig() {
  const raw = readFileSync(path.join(ROOT, 'src', 'config', 'config.default.json'), 'utf-8');
  const cfg = JSON.parse(raw);
  return {
    timeoutMs: cfg.coach.timeout_ms,
    cooldownMs: cfg.coach.cooldown_ms,
    maxReplyChars: cfg.coach.max_reply_chars,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

/** Read the same Responses output text that the Python SDK aggregates. */
function extractCue(upstream) {
  if (upstream?.status !== 'completed' || !Array.isArray(upstream.output)) return null;
  const text = upstream.output
    .filter((item) => item?.type === 'message' && Array.isArray(item.content))
    .flatMap((item) => item.content)
    .filter((part) => part?.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
  const tip = JSON.parse(text);
  if (!tip ||
      typeof tip.struggling !== 'boolean' ||
      typeof tip.signal !== 'string' ||
      typeof tip.body_part !== 'string' ||
      !['none', 'mild', 'moderate', 'high'].includes(tip.severity) ||
      typeof tip.ask_pain_check !== 'boolean' ||
      typeof tip.safety_concern !== 'boolean' ||
      typeof tip.cue_text !== 'string') return null;
  return tip.cue_text.trim() || null;
}

/**
 * What the model is asked to do with the summary. Sent with every request;
 * the client never sends anything but the summary, and the server never
 * sends anything but this instruction plus that summary.
 */
const PROMPT_INSTRUCTION =
  'You are a kind movement coach. Reply with 1-2 encouraging sentences. ' +
  'Suggest ONE small adjustment. Do not diagnose any condition. ' +
  'Do not tell the person to push through pain, assume pain, or increase movement intensity. ' +
  'Do not use failure language. Base the cue only on the observations. ' +
  'Return JSON only with these fields: struggling (boolean), signal (string), body_part (string), ' +
  'severity (none, mild, moderate, or high), cue_text (string, at most 200 characters), ' +
  'ask_pain_check (boolean), and safety_concern (boolean).';

/**
 * System 1 labels never reach the model verbatim: they are neutral phrases
 * in the forwarded summary, so the reply cannot parrot diagnostic wording.
 */
const NEUTRAL_SIGNALS = {
  stall: 'paused',
  jitter: 'unsteady',
  compensation: 'shoulder lifting',
  failed_range: 'reached partway',
  drop: 'arm lowering',
};

function neutralizeSummary(summary) {
  const copy = JSON.parse(JSON.stringify(summary));
  const signal = copy?.system1?.top_signal;
  if (typeof signal === 'string' && signal in NEUTRAL_SIGNALS) {
    copy.system1.top_signal = NEUTRAL_SIGNALS[signal];
  }
  return copy;
}

const BANNED_REPLY = ['fail', 'push through', 'pain', 'diagnos'];

/** First reply problem found, else null. Only the reason name is ever logged. */
function replyProblem(message, maxChars) {
  if (message.length > maxChars) return 'reply_too_long';
  const sentences = message
    .split(/[.!?…]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length > 2) return 'reply_too_many_sentences';
  const lower = message.toLowerCase();
  if (BANNED_REPLY.some((word) => lower.includes(word))) return 'reply_banned_word';
  return null;
}

export function createCoachServer({ apiKey, timeoutMs, cooldownMs, maxReplyChars, fetchImpl = fetch }) {
  let lastCallAt = 0;
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/coach') {
      json(res, 404, { error: 'not found' });
      return;
    }
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
      json(res, 415, { error: 'expected application/json' });
      return;
    }
    let raw;
    try {
      raw = await readBody(req);
    } catch {
      console.error({ event: 'coach_failure', reason: 'body too large' });
      json(res, 413, { error: 'body too large' });
      return;
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      console.error({ event: 'coach_reject', reason: 'invalid json' });
      json(res, 400, { error: 'invalid json' });
      return;
    }
    const check = validateCoachSummary(body);
    if (!check.ok) {
      console.error({ event: 'coach_reject', reason: check.error });
      json(res, 400, { error: check.error });
      return;
    }
    if (Date.now() - lastCallAt < cooldownMs) {
      json(res, 429, { error: 'cooling down' });
      return;
    }
    lastCallAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortOnDisconnect = () => controller.abort();
    res.once('close', abortOnDisconnect);
    try {
      const upstream = await fetchImpl(MUSE_RESPONSES_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: COACH_MODEL,
          input: `${PROMPT_INSTRUCTION}\n\nMovement observations:\n${JSON.stringify(neutralizeSummary(body))}`,
          reasoning: { effort: 'low' },
          max_output_tokens: 1200,
        }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (upstream.status === 429) {
        json(res, 429, { error: 'coach rate limited' });
        return;
      }
      if (!upstream.ok) throw new Error('upstream failed');
      const message = extractCue(await upstream.json());
      if (!message) throw new Error('upstream answered without a message');
      const problem = replyProblem(message, Math.min(200, maxReplyChars));
      if (problem) {
        // Guarded reply: a 502-style error the client turns into the local
        // fallback. Only the reason name is logged, never the reply.
        console.error({ event: 'coach_reject', reason: problem });
        json(res, 502, { error: 'coach reply rejected' });
        return;
      }
      console.log({ event: 'coach_live', model: COACH_MODEL });
      json(res, 200, { message });
    } catch {
      if (res.destroyed) return;
      const timedOut = controller.signal.aborted;
      console.error({ event: 'coach_failure', reason: timedOut ? 'timeout' : 'upstream failure' });
      json(res, timedOut ? 504 : 502, { error: timedOut ? 'coach timed out' : 'coach failed' });
    } finally {
      clearTimeout(timer);
      res.off('close', abortOnDisconnect);
    }
  });
  return server;
}

const invokedAsScript = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  try {
    loadEnvFile(path.join(ROOT, '.env'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Could not load the server .env file.');
      process.exit(1);
    }
  }
  const apiKey = process.env.MODEL_API_KEY?.trim();
  if (!apiKey) {
    console.error('Set MODEL_API_KEY in the repository .env or the server environment.');
    process.exit(1);
  }
  const { timeoutMs, cooldownMs, maxReplyChars } = loadCoachConfig();
  const server = createCoachServer({
    apiKey,
    timeoutMs,
    cooldownMs,
    maxReplyChars,
  });
  const port = Number(process.env.COACH_PORT ?? 8787);
  server.listen(port, '127.0.0.1', () => console.log(`Coach proxy listening on 127.0.0.1:${port}`));
}
