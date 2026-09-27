/**
 * Typed synchronous EventBus.
 *
 *   ctx.bus.on('building:built', ({ buildingId }) => …);   // returns unsubscribe fn
 *   ctx.bus.emit('building:built', { buildingId: 12 });
 *
 * The event map (`GameEvents`) is documented in core/events.ts.
 * Handlers run synchronously in subscription order; an exception in one
 * handler is logged and does not stop the others.
 */
import type { GameEvents } from './events';

type Handler<P> = (payload: P) => void;

export class EventBus<Events extends object> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => this.off(type, fn);
  }

  /** Subscribe for a single emission. */
  once<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, fn: Handler<Events[K]>): void {
    this.handlers.get(type)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    if (!set || set.size === 0) return;
    for (const fn of [...set]) {
      try {
        (fn as Handler<Events[K]>)(payload);
      } catch (err) {
        console.error(`[bus] handler for "${String(type)}" failed`, err);
      }
    }
  }

  /** Number of listeners (debug/tests). */
  listenerCount(type: keyof Events): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}

export type GameBus = EventBus<GameEvents>;
export const createBus = (): GameBus => new EventBus<GameEvents>();
