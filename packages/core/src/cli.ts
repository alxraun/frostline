// parents: @.frostline/graph/ss-runtime.xml, @.frostline/graph/s-core.xml

import { Frostline } from "./product.ts";

const fli = new Frostline();
const args = process.argv.slice(2);
const command = args[0];

if (command === "ancestors") {
  process.exit(ancestors(args.slice(1)));
}
if (command === "graph") {
  process.exit(graph(args.slice(1)));
}
if (command === "reset-context") {
  process.exit(resetContext(args.slice(1)));
}
if (command === "reset-session") {
  process.exit(resetSession(args.slice(1)));
}
if (command === "--help" || command === "-h" || command === undefined) {
  console.log(help());
  process.exit(0);
}
console.error(`unknown command: ${command}`);
console.error(help());
process.exit(2);

function ancestors(values: string[]): number {
  const options = parseOptions(values, new Set(["--session", "--context"]));
  if (options.flags.has("--help") || options.flags.has("-h")) {
    console.log(
      "Usage: fli ancestors FILE [FILE...] [--session ID --context ID] [--json]\n\nReturns transitive parent context without downward discovery.",
    );
    return 0;
  }
  if (options.errors.length > 0) return optionErrors(options.errors);
  if (options.positionals.length === 0) {
    return usage("ancestors requires at least one FILE");
  }
  const session = options.values.get("--session")?.[0];
  const context = options.values.get("--context")?.[0];
  if ((session === undefined) !== (context === undefined)) {
    return usage("--session and --context must be provided together");
  }
  const output = fli.ancestors({
    files: options.positionals,
    deliveryScope: session !== undefined && context !== undefined
      ? { sessionId: session, contextId: context }
      : undefined,
  });
  if (options.flags.has("--json")) {
    console.log(JSON.stringify(output));
  } else {
    process.stdout.write(output.context);
    printDiagnostics(output.diagnostics);
    printWarnings(output.stateWarnings);
  }
  return 0;
}

function graph(values: string[]): number {
  const options = parseOptions(values, new Set(["--root"]));
  if (options.flags.has("--help") || options.flags.has("-h")) {
    console.log(
      "Usage: fli graph FILE|DIR [--root DIR] [--json]\n\nInfers a finite discovery boundary from the anchor, scans it downward, and follows external parents upward without widening the scan region.",
    );
    return 0;
  }
  if (options.errors.length > 0) return optionErrors(options.errors);
  if (options.positionals.length !== 1) {
    return usage("graph requires exactly one FILE or DIR anchor");
  }
  const output = fli.graph({
    anchor: options.positionals[0],
    root: options.values.get("--root")?.[0],
  });
  if (options.flags.has("--json")) {
    console.log(JSON.stringify(output));
  } else {
    if (output.root) console.log(`root: ${output.root}`);
    if (output.focus) console.log(`focus: ${output.focus}`);
    for (const edge of output.edges) {
      console.log(`${edge.child} -> ${edge.parent}`);
    }
    printDiagnostics(output.diagnostics);
  }
  return output.root ? 0 : 1;
}

function resetContext(values: string[]): number {
  const options = parseOptions(values, new Set(["--session", "--context"]));
  if (options.flags.has("--help") || options.flags.has("-h")) {
    console.log("Usage: fli reset-context --session ID --context ID [--json]");
    return 0;
  }
  if (options.errors.length > 0) return optionErrors(options.errors);
  if (options.positionals.length > 0) {
    return usage("reset-context accepts no positional arguments");
  }
  const session = options.values.get("--session")?.[0];
  const context = options.values.get("--context")?.[0];
  if (session === undefined || context === undefined) {
    return usage("reset-context requires --session and --context");
  }
  printReset(
    fli.resetContext({ sessionId: session, contextId: context }),
    options.flags.has("--json"),
  );
  return 0;
}

function resetSession(values: string[]): number {
  const options = parseOptions(values, new Set(["--session"]));
  if (options.flags.has("--help") || options.flags.has("-h")) {
    console.log("Usage: fli reset-session --session ID [--json]");
    return 0;
  }
  if (options.errors.length > 0) return optionErrors(options.errors);
  if (options.positionals.length > 0) {
    return usage("reset-session accepts no positional arguments");
  }
  const session = options.values.get("--session")?.[0];
  if (session === undefined) return usage("reset-session requires --session");
  printReset(fli.resetSession(session), options.flags.has("--json"));
  return 0;
}

interface ParsedOptions {
  values: Map<string, string[]>;
  flags: Set<string>;
  positionals: string[];
  errors: string[];
}

function parseOptions(
  values: string[],
  valueOptions: Set<string>,
): ParsedOptions {
  const result: ParsedOptions = {
    values: new Map<string, string[]>(),
    flags: new Set<string>(),
    positionals: [],
    errors: [],
  };
  const flags = new Set(["--json", "-h", "--help"]);
  for (let index = 0; index < values.length; index += 1) {
    const option = values[index];
    if (flags.has(option)) {
      result.flags.add(option);
      continue;
    }
    if (!option.startsWith("-")) {
      result.positionals.push(option);
      continue;
    }
    if (!valueOptions.has(option)) {
      result.errors.push(`unknown option: ${option}`);
      continue;
    }
    const value = values[index + 1];
    if (
      value === undefined || value.startsWith("-") || flags.has(value) ||
      valueOptions.has(value)
    ) {
      result.errors.push(`${option} requires a value`);
      continue;
    }
    if (result.values.has(option)) {
      result.errors.push(`${option} may be provided only once`);
      index += 1;
      continue;
    }
    result.values.set(option, [value]);
    index += 1;
  }
  return result;
}

function printDiagnostics(
  values: Array<{ kind: string; path?: string; message: string }>,
): void {
  for (const value of values) {
    console.error(
      `FLI ${value.kind}${
        value.path ? ` [${value.path}]` : ""
      }: ${value.message}`,
    );
  }
}

function printWarnings(values: string[]): void {
  for (const value of values) console.error(`FLI state: ${value}`);
}

function printReset(warnings: string[], json: boolean): void {
  if (json) console.log(JSON.stringify({ stateWarnings: warnings }));
  else printWarnings(warnings);
}

function help(): string {
  return "Frostline\n\nUsage:\n  fli ancestors FILE [FILE...] [options]\n  fli graph FILE|DIR [--root DIR] [--json]\n  fli reset-context --session ID --context ID [--json]\n  fli reset-session --session ID [--json]";
}

function optionErrors(errors: string[]): number {
  for (const error of errors) console.error(error);
  return 2;
}

function usage(message: string): number {
  console.error(message);
  return 2;
}
