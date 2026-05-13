import { BackgroundQueue } from './background-queue';

describe('BackgroundQueue', () => {
  it('runs enqueued tasks', async () => {
    const q = new BackgroundQueue(4);
    const ran: string[] = [];

    expect(q.enqueue('a', async () => {
      await new Promise(r => setTimeout(r, 5));
      ran.push('a');
    })).toBe(true);
    expect(q.enqueue('b', async () => { ran.push('b'); })).toBe(true);

    await q.drain();
    expect(ran.sort()).toEqual(['a', 'b']);
  });

  it('dedupes by key while a task is in-flight', async () => {
    const q = new BackgroundQueue(4);
    let count = 0;
    const release: Array<() => void> = [];
    const blocker = new Promise<void>(r => { release.push(r); });

    expect(q.enqueue('same', async () => {
      count += 1;
      await blocker;
    })).toBe(true);
    expect(q.enqueue('same', async () => { count += 1; })).toBe(false);
    expect(q.enqueue('same', async () => { count += 1; })).toBe(false);

    release[0]();
    await q.drain();
    expect(count).toBe(1);
  });

  it('drops tasks when above maxInflight', async () => {
    const q = new BackgroundQueue(1);
    const release: Array<() => void> = [];
    const block = new Promise<void>(r => release.push(r));

    expect(q.enqueue('first', async () => { await block; })).toBe(true);
    expect(q.enqueue('second', async () => undefined)).toBe(false);

    release[0]();
    await q.drain();
  });

  it('lifts inflight slot after task completes', async () => {
    const q = new BackgroundQueue(1);
    expect(q.enqueue('a', async () => undefined)).toBe(true);
    await q.drain();
    expect(q.enqueue('b', async () => undefined)).toBe(true);
    await q.drain();
  });

  it('does not propagate task errors and clears dedupe', async () => {
    const q = new BackgroundQueue(2);
    expect(q.enqueue('boom', async () => {
      throw new Error('intentional');
    })).toBe(true);
    await q.drain();
    
    expect(q.enqueue('boom', async () => undefined)).toBe(true);
    await q.drain();
  });
});
