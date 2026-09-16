import { z } from 'zod';
import type { ManagementConfig } from './config.js';
import type { ManagementOperation } from './tools.js';

const MAX_REQUEST_BYTES = 512_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const envelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ ok: z.literal(false), error: z.object({
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(2000),
    field: z.string().max(160).optional(),
  }).strict() }).strict(),
]);

export type ManagementResponse = z.infer<typeof envelopeSchema>;

const failure = (code: string, message: string): ManagementResponse => ({ ok: false, error: { code, message } });

/** No retry here: callers must deliberately reuse an idempotency key after uncertain writes. */
export class ManagementBackend {
  constructor(private readonly config: ManagementConfig, private readonly request: typeof fetch = fetch) {}

  async call(operation: ManagementOperation, input: Record<string, unknown>, signal?: AbortSignal): Promise<ManagementResponse> {
    const body = JSON.stringify({ environment: this.config.environment, operation, input });
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
      return failure('invalid-input', 'The request is too large. Reduce the content size.');
    }
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([timeout, signal]) : timeout;

    try {
      const response = await this.request(this.config.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${this.config.token}` },
        body,
        // Do not forward management credentials to a redirect destination.
        redirect: 'error',
        signal: requestSignal,
      });

      if (!response.body) return failure('service-failure', 'The management gateway returned an empty response.');
      const reader = response.body.getReader();
      let length = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          return failure('response-too-large', 'The management response is too large. Request a smaller page or a single record.');
        }
        chunks.push(next.value);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return failure('service-failure', 'The management gateway returned an invalid response.'); }
      // Redact after decoding so JSON Unicode escapes cannot hide an echoed
      // credential. This also covers unexpected credential-bearing object keys.
      parsed = JSON.parse(JSON.stringify(parsed).split(this.config.token).join('[REDACTED]'));
      const envelope = envelopeSchema.safeParse(parsed);
      if (!envelope.success || (envelope.data.ok && (!response.ok || !Object.hasOwn(parsed as object, 'result')))) {
        return failure('service-failure', 'The management gateway returned an invalid response.');
      }
      return envelope.data;
    } catch {
      if (signal?.aborted) return failure('cancelled', 'The request was cancelled. A write may have completed; retry only with the identical input and idempotency key.');
      if (timeout.aborted) return failure('timeout', 'The management request timed out. A write may have completed; retry only with the identical input and idempotency key.');
      // Fetch errors can contain URLs or authorization diagnostics. Keep them out of results and logs.
      return failure('service-failure', 'Unable to contact the management gateway. Check the configured origin and network connection.');
    }
  }
}
