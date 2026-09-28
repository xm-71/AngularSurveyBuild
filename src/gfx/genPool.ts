import GenWorker from '../workers/gen.worker?worker&inline';
import { buildFloraCell, type FloraJob, type FloraResult } from '../world/floraPlacement';
import { buildPatch, type PatchJob, type PatchResult } from '../world/patchBuilder';
import type { PlanetParams } from '../world/planetTypes';
import { TerrainGenerator } from '../world/terrain';

// Schedules terrain and flora generation on a small worker pool. If workers are
// unavailable (blocked by the host page), jobs run on the main thread within a
// per-frame time budget instead.

interface BaseJob {
  id: number;
  planetId: string;
  priority: number;
  cancelled: boolean;
  worker: number;
}

interface PatchQueued extends BaseJob {
  kind: 'patch';
  job: PatchJob;
  onDone: (r: PatchResult) => void;
}

interface FloraQueued extends BaseJob {
  kind: 'flora';
  job: FloraJob;
  onDone: (r: FloraResult) => void;
}

export type QueuedJob = PatchQueued | FloraQueued;

export class GenPool {
  private workers: Worker[] = [];
  private inflight: number[] = [];
  private queue: QueuedJob[] = [];
  private running = new Map<number, QueuedJob>();
  private gens = new Map<string, TerrainGenerator>();
  private planets = new Map<string, PlanetParams>();
  private nextId = 1;
  private fallback = false;
  maxPerWorker = 3;

  constructor(count: number) {
    try {
      for (let i = 0; i < count; i++) {
        const w = new GenWorker();
        const index = i;
        w.onmessage = (e: MessageEvent) => this.onMessage(index, e.data);
        w.onerror = (e) => {
          e.preventDefault?.();
          this.switchToFallback();
        };
        this.workers.push(w);
        this.inflight.push(0);
      }
    } catch {
      this.switchToFallback();
    }
    if (this.workers.length === 0) this.fallback = true;
  }

  get usingWorkers(): boolean {
    return !this.fallback;
  }

  get pending(): number {
    return this.queue.length + this.running.size;
  }

  private switchToFallback(): void {
    if (this.fallback) return;
    this.fallback = true;
    for (const w of this.workers) {
      try {
        w.terminate();
      } catch {
        /* ignore */
      }
    }
    this.workers = [];
    // Requeue anything that was in flight.
    for (const job of this.running.values()) this.queue.push(job);
    this.running.clear();
  }

  generator(planetId: string): TerrainGenerator | undefined {
    return this.gens.get(planetId);
  }

  registerPlanet(params: PlanetParams): TerrainGenerator {
    let gen = this.gens.get(params.id);
    if (gen) return gen;
    gen = new TerrainGenerator(params);
    this.gens.set(params.id, gen);
    this.planets.set(params.id, params);
    for (const w of this.workers) w.postMessage({ type: 'planet', params });
    return gen;
  }

  dropPlanet(id: string): void {
    this.gens.delete(id);
    this.planets.delete(id);
    for (const job of this.queue) if (job.planetId === id) job.cancelled = true;
    for (const job of this.running.values()) if (job.planetId === id) job.cancelled = true;
    for (const w of this.workers) w.postMessage({ type: 'drop', id });
  }

  requestPatch(job: PatchJob, priority: number, onDone: (r: PatchResult) => void): QueuedJob {
    const q: PatchQueued = { id: this.nextId++, kind: 'patch', planetId: job.planetId, job, priority, cancelled: false, worker: -1, onDone };
    this.queue.push(q);
    return q;
  }

  requestFlora(job: FloraJob, priority: number, onDone: (r: FloraResult) => void): QueuedJob {
    const q: FloraQueued = { id: this.nextId++, kind: 'flora', planetId: job.planetId, job, priority, cancelled: false, worker: -1, onDone };
    this.queue.push(q);
    return q;
  }

  private onMessage(worker: number, msg: { type: string; jobId: number; result?: unknown }): void {
    if (msg.type !== 'done' && msg.type !== 'fail') return;
    const job = this.running.get(msg.jobId);
    if (!job) return;
    this.running.delete(msg.jobId);
    this.inflight[worker] = Math.max(0, this.inflight[worker] - 1);
    if (!job.cancelled && msg.type === 'done') {
      if (job.kind === 'patch') job.onDone(msg.result as PatchResult);
      else job.onDone(msg.result as FloraResult);
    }
    this.dispatch();
  }

  private dispatch(): void {
    for (let w = 0; w < this.workers.length; w++) {
      while (this.inflight[w] < this.maxPerWorker && this.queue.length > 0) {
        const job = this.queue.shift()!;
        if (job.cancelled) continue;
        job.worker = w;
        this.inflight[w]++;
        this.running.set(job.id, job);
        this.workers[w].postMessage({ type: job.kind, jobId: job.id, job: job.job });
      }
    }
  }

  /** Dispatch queued work. Call once per frame. */
  update(budgetMs: number): void {
    if (this.queue.length === 0) return;
    // Drop cancelled, then most urgent first.
    this.queue = this.queue.filter((j) => !j.cancelled);
    this.queue.sort((a, b) => a.priority - b.priority);

    if (!this.fallback) {
      this.dispatch();
      return;
    }

    const start = performance.now();
    while (this.queue.length > 0 && performance.now() - start < budgetMs) {
      const job = this.queue.shift()!;
      const gen = this.gens.get(job.planetId);
      if (!gen || job.cancelled) continue;
      if (job.kind === 'patch') job.onDone(buildPatch(gen, job.job));
      else job.onDone(buildFloraCell(gen, job.job));
    }
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}
