/// <reference lib="webworker" />
import * as opaque from "@serenity-kit/opaque";
import { runOpaque, type OpaqueCall } from "./core";

self.onmessage = async (e: MessageEvent<{ id: number; call: OpaqueCall }>) => {
  const { id, call } = e.data;
  try {
    self.postMessage({ id, result: await runOpaque(opaque, call) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
