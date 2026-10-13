import { signPayload, type FakePayrail, type Logger, type PayrailEvent } from '@ledgerline/core';

export interface RelayOptions {
  url: string;
  secret: string;
  logger: Logger;
  fetch?: typeof fetch;
}

/**
 * Plays Payrail's part for the bundled fake provider: every event it emits is
 * signed and POSTed to the webhook endpoint, one at a time and in order.
 * Returns a function that stops relaying once queued deliveries finish.
 */
export function relayWebhooks(provider: FakePayrail, options: RelayOptions): () => Promise<void> {
  const send = options.fetch ?? fetch;
  let queue: Promise<void> = Promise.resolve();

  const deliver = async (event: PayrailEvent) => {
    const body = JSON.stringify(event);
    const signature = await signPayload(body, options.secret, Math.floor(Date.now() / 1000));
    try {
      const response = await send(options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'payrail-signature': signature },
        body,
      });
      if (!response.ok) {
        options.logger.warn({ eventId: event.id, status: response.status }, 'webhook endpoint refused a Payrail event');
      }
    } catch (error) {
      options.logger.warn({ eventId: event.id, error: error instanceof Error ? error.message : String(error) }, 'could not deliver a Payrail event');
    }
  };

  const unsubscribe = provider.onEvent((event) => {
    queue = queue.then(() => deliver(event));
  });

  return async () => {
    unsubscribe();
    await queue;
  };
}
