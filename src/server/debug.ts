const enabled = process.env.DEBUG_PERF === "1";

export function debugPerf(msg: string): void {
  if (enabled) console.debug(msg);
}
