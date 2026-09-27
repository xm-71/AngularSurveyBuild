/// <reference lib="webworker" />
import { buildFloraCell, type FloraJob } from '../world/floraPlacement';
import { buildPatch, patchTransferables, type PatchJob } from '../world/patchBuilder';
import type { PlanetParams } from '../world/planetTypes';
import { TerrainGenerator } from '../world/terrain';

// Background generator: builds terrain patches and flora cells off the main thread.

type Msg =
  | { type: 'ping' }
  | { type: 'planet'; params: PlanetParams }
  | { type: 'drop'; id: string }
  | { type: 'patch'; jobId: number; job: PatchJob }
  | { type: 'flora'; jobId: number; job: FloraJob };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const gens = new Map<string, TerrainGenerator>();

ctx.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  switch (m.type) {
    case 'ping':
      ctx.postMessage({ type: 'pong' });
      break;
    case 'planet':
      gens.set(m.params.id, new TerrainGenerator(m.params));
      break;
    case 'drop':
      gens.delete(m.id);
      break;
    case 'patch': {
      const g = gens.get(m.job.planetId);
      if (!g) {
        ctx.postMessage({ type: 'fail', jobId: m.jobId });
        return;
      }
      const result = buildPatch(g, m.job);
      ctx.postMessage({ type: 'done', jobId: m.jobId, result }, patchTransferables(result));
      break;
    }
    case 'flora': {
      const g = gens.get(m.job.planetId);
      if (!g) {
        ctx.postMessage({ type: 'fail', jobId: m.jobId });
        return;
      }
      const result = buildFloraCell(g, m.job);
      ctx.postMessage({ type: 'done', jobId: m.jobId, result }, [result.data.buffer as ArrayBuffer, result.ids.buffer as ArrayBuffer]);
      break;
    }
  }
};
