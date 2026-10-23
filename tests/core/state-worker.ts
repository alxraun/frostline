// parents: @.frostline/graph/v-m-discovery.xml

import { updateState } from "../../packages/core/src/runtime/state.ts";

const [cache, id] = Deno.args;
if (!cache || !id) throw new Error("state-worker requires cache and id");

updateState(cache, (state) => {
  state.projects[`worker-${id}`] = { files: {} };
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, 20);
});
