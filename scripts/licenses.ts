// Generate third-party license notices for a distribution package.
//
// Usage:
//   deno run --allow-read --allow-write --allow-run \
//     scripts/licenses.ts --output DIR MANIFEST.cargo.toml...
//
// For every crate in the given Cargo manifests' resolved dependency graph
// (cargo metadata over pinned Cargo.lock files), NOTICE.md maps the crate to
// its SPDX expression, and one canonical SPDX text per license family is
// copied from scripts/license-texts/ into the output directory. Deterministic:
// identical inputs produce byte-identical output.

const licenseTextsRoot = new URL("license-texts/", import.meta.url);

interface CargoPackage {
  name: string;
  version: string;
  license?: string;
}

function runCargoMetadata(manifest: string): CargoPackage[] {
  const command = new Deno.Command("cargo", {
    args: [
      "metadata",
      "--format-version",
      "1",
      "--manifest-path",
      manifest,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const output = command.outputSync();
  if (!output.success) {
    throw new Error(
      `cargo metadata failed for ${manifest}: ${
        new TextDecoder().decode(output.stderr)
      }`,
    );
  }
  const parsed = JSON.parse(new TextDecoder().decode(output.stdout));
  return parsed.packages as CargoPackage[];
}

/** Split an SPDX expression into license/exception identifiers. */
export function spdxIdentifiers(expression: string): string[] {
  const identifiers = new Set<string>();
  for (const token of expression.split(/\s+/)) {
    const upper = token.toUpperCase();
    if (upper === "OR" || upper === "AND" || upper === "WITH") continue;
    if (/^[0-9a-z.+-]+$/i.test(token)) identifiers.add(token);
  }
  return [...identifiers].sort();
}

export interface GeneratedNotices {
  crates: string[];
  licenseFiles: string[];
}

export function generateNotices(
  manifests: string[],
  outputDirectory: string,
): GeneratedNotices {
  const crates = new Map<string, string>();
  for (const manifest of manifests) {
    for (const pkg of runCargoMetadata(manifest)) {
      if (pkg.license === undefined) continue;
      crates.set(`${pkg.name}@${pkg.version}`, pkg.license);
    }
  }
  if (crates.size === 0) {
    throw new Error("no licensed crates found in the given manifests");
  }

  const licenseFiles = new Set<string>();
  for (const expression of crates.values()) {
    for (const id of spdxIdentifiers(expression)) {
      licenseFiles.add(`${id}.txt`);
    }
  }
  for (const file of licenseFiles) {
    const source = new URL(file, licenseTextsRoot);
    Deno.copyFileSync(source, `${outputDirectory}/${file}`);
  }

  const rows = [...crates.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([crate, expression]) => `| ${crate} | ${expression} |`);
  const notice = [
    "# Third-party notices",
    "",
    "This package contains third-party software distributed under the",
    "licenses below. The canonical license text for every license family is",
    "provided alongside this file. Frostline itself is licensed MIT; the",
    "bundled Core binary embeds the Deno runtime (MIT).",
    "",
    "| Crate | License |",
    "| --- | --- |",
    ...rows,
    "",
  ].join("\n");
  Deno.writeTextFileSync(`${outputDirectory}/NOTICE.md`, notice);

  return { crates: [...crates.keys()], licenseFiles: [...licenseFiles] };
}

const args = [...Deno.args];
const outputIndex = args.indexOf("--output");
if (outputIndex === -1 || args.length < 4) {
  console.error(
    "Usage: deno run --allow-read --allow-write --allow-run " +
      "scripts/licenses.ts --output DIR MANIFEST...",
  );
  Deno.exit(2);
}
const output = args[outputIndex + 1];
const manifests = args.filter((value, index) =>
  index !== outputIndex && index !== outputIndex + 1
);
Deno.mkdirSync(output, { recursive: true });
const result = generateNotices(manifests, output);
console.error(
  `licenses: ${result.crates.length} crates, ${result.licenseFiles.length} license texts -> ${output}`,
);
