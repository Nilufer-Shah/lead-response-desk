"use client";

import { openDB } from "idb";

export interface OfflineMutation { id: string; endpoint: string; body: unknown; clientInitiatedAt: string; queuedAt: string }

async function queueDb() {
  return openDB("lead-desk-offline", 1, { upgrade(db) { db.createObjectStore("mutations", { keyPath: "id" }); } });
}

export async function queueOfflineMutation(endpoint: string, body: Record<string, unknown>) {
  const mutation: OfflineMutation = { id: crypto.randomUUID(), endpoint, body: { ...body, clientInitiatedAt: new Date().toISOString() }, clientInitiatedAt: new Date().toISOString(), queuedAt: new Date().toISOString() };
  await (await queueDb()).put("mutations", mutation);
  return mutation;
}

export async function flushOfflineQueue() {
  const db = await queueDb();
  const pending = await db.getAll("mutations") as OfflineMutation[];
  for (const mutation of pending) {
    try {
      const response = await fetch(mutation.endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(mutation.body) });
      if (response.ok) await db.delete("mutations", mutation.id);
    } catch { break; }
  }
  return pending.length;
}
