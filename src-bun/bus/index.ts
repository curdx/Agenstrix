/**
 * In-memory pub/sub EventBus.
 * Singleton bus — all subscribers in the same process.
 */

type Handler = (payload: unknown) => void;

export interface EventBus {
  publish(topic: string, payload: unknown): void;
  subscribe(topic: string, handler: Handler): () => void; // returns unsubscribe
}

function createEventBus(): EventBus {
  const subscribers = new Map<string, Set<Handler>>();

  return {
    publish(topic: string, payload: unknown): void {
      const handlers = subscribers.get(topic);
      if (!handlers) return;
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch {
          // Isolate handler failures — one bad handler must not break others
        }
      }
    },

    subscribe(topic: string, handler: Handler): () => void {
      if (!subscribers.has(topic)) {
        subscribers.set(topic, new Set());
      }
      subscribers.get(topic)!.add(handler);

      // Return unsubscribe closure
      return () => {
        const set = subscribers.get(topic);
        if (set) {
          set.delete(handler);
          if (set.size === 0) {
            subscribers.delete(topic);
          }
        }
      };
    },
  };
}

export const bus: EventBus = createEventBus();
