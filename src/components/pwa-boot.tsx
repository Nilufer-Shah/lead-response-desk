"use client";

import { useEffect } from "react";
import { flushOfflineQueue } from "@/lib/offline-queue";

export function PwaBoot() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
    const flush = () => void flushOfflineQueue();
    window.addEventListener("online", flush);
    if (navigator.onLine) flush();
    return () => window.removeEventListener("online", flush);
  }, []);
  return null;
}
