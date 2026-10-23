// parents: @.frostline/graph/v-ss-runtime.xml

import { inspect, isDeepStrictEqual } from "node:util";

export function assertEquals<T>(
  actual: T,
  expected: T,
  message?: string,
): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(
      message ?? `expected ${inspect(expected)}, got ${inspect(actual)}`,
    );
  }
}

export function assertStringIncludes(value: string, needle: string): void {
  if (!value.includes(needle)) {
    throw new Error(`expected value to include ${JSON.stringify(needle)}`);
  }
}
