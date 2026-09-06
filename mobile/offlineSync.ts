import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RunPoint } from './locationTask';

// Starting and finishing a run both used to require a live server
// round-trip before anything local even began: handleStartRun awaited
// POST /runs/start for a runId BEFORE calling
// Location.startLocationUpdatesAsync, and handleStopRun awaited
// PATCH /runs/:id/finish before clearing the local buffer. In a park or
// anywhere signal drops mid-run, that meant either the run never started
// recording at all, or a fully-recorded run's data was stuck showing an
// error with no way to save it. GPS recording itself (locationTask.ts) has
// never needed the network - only these two calls did. This module lets
// both calls fail silently offline and queues the run to be created/synced
// the next time the app is online, so nothing recorded is ever lost.
const QUEUE_KEY = 'runapp_offline_run_queue';

export interface PendingRun {
  /** null until POST /runs/start has succeeded for this entry at least once. */
  runId: string | null;
  plannedRoutePath?: RunPoint[] | null;
  plannedDistanceMeters?: number | null;
  path: RunPoint[];
}

export function makeLocalRunId(): string {
  // Prefixed so callers can tell "a real server run id" (a Prisma-generated
  // UUID) apart from "a placeholder for a run that started offline" with a
  // single string check, without a separate AsyncStorage flag to keep in
  // sync.
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isLocalRunId(id: string): boolean {
  return id.startsWith('local-');
}

async function getQueue(): Promise<PendingRun[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: PendingRun[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueuePendingRun(entry: PendingRun): Promise<void> {
  const queue = await getQueue();
  queue.push(entry);
  await saveQueue(queue);
}

export async function pendingRunCount(): Promise<number> {
  return (await getQueue()).length;
}

interface SyncApi {
  post: (url: string, body: unknown) => Promise<{ data: any }>;
  patch: (url: string, body: unknown) => Promise<{ data: any }>;
}

// Best-effort sync of every queued run: create it server-side if it doesn't
// have a confirmed runId yet, then submit its finish path. An entry is only
// ever removed once BOTH calls have succeeded - if either fails (still
// offline, or a transient server error) it stays queued for the next
// attempt rather than being dropped, and a runId obtained from a successful
// /runs/start is persisted immediately so a later retry can't accidentally
// create the same run twice.
export async function syncPendingRuns(api: SyncApi): Promise<{ synced: number; remaining: number }> {
  // A mutable working copy, persisted after every state change (not just at
  // the end) - if the app is killed or connectivity drops again partway
  // through, whatever's already been saved to disk reflects exactly what's
  // still owed to the server, with no risk of a double /runs/start.
  const queue = await getQueue();
  if (queue.length === 0) return { synced: 0, remaining: 0 };

  let synced = 0;
  const done: boolean[] = queue.map(() => false);

  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    try {
      if (!entry.runId) {
        const res = await api.post(
          '/runs/start',
          entry.plannedRoutePath
            ? { plannedRoutePath: entry.plannedRoutePath, plannedDistanceMeters: entry.plannedDistanceMeters }
            : {},
        );
        entry.runId = res.data.id;
        await saveQueue(queue.filter((_, idx) => !done[idx]));
      }
      await api.patch(`/runs/${entry.runId}/finish`, { path: entry.path });
      synced += 1;
      done[i] = true;
      await saveQueue(queue.filter((_, idx) => !done[idx]));
    } catch {
      // Still offline, or a transient server error - leave it queued
      // rather than discarding a recorded run.
    }
  }

  const remaining = queue.filter((_, idx) => !done[idx]);
  return { synced, remaining: remaining.length };
}
