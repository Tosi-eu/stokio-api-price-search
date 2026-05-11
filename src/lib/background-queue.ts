import { logger } from '../logger';

/**
 * Fila in-memory simples e bounded para tarefas de refresh assíncrono
 * (stale-while-revalidate). Sem dependências externas — descarta tarefas
 * quando a fila atinge o limite, evitando crescer descontroladamente sob
 * alta concorrência.
 */
export class BackgroundQueue {
  private inflight = new Set<Promise<void>>();
  private dedupe = new Set<string>();

  constructor(private readonly maxInflight: number) {}

  /**
   * Enfileira uma tarefa. Se a fila estiver cheia ou já houver uma com a
   * mesma `dedupeKey` em andamento, ignora silenciosamente. Não retorna
   * Promise — chamadores não devem bloquear no resultado.
   */
  enqueue(dedupeKey: string, task: () => Promise<void>): boolean {
    if (this.inflight.size >= this.maxInflight) {
      logger.debug('BackgroundQueue full — dropping task', {
        operation: 'bg_queue_drop',
        dedupeKey,
        inflight: this.inflight.size,
        max: this.maxInflight,
      });
      return false;
    }
    if (this.dedupe.has(dedupeKey)) {
      return false;
    }

    this.dedupe.add(dedupeKey);
    const p = (async () => {
      try {
        await task();
      } catch (err) {
        logger.warn('Background task error', {
          operation: 'bg_queue_task',
          dedupeKey,
          error: (err as Error).message,
        });
      } finally {
        this.dedupe.delete(dedupeKey);
      }
    })();
    this.inflight.add(p);
    p.finally(() => this.inflight.delete(p));
    return true;
  }

  size(): number {
    return this.inflight.size;
  }

  async drain(): Promise<void> {
    while (this.inflight.size > 0) {
      await Promise.allSettled(Array.from(this.inflight));
    }
  }
}
