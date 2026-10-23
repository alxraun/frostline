# Security Policy

Frostline is **experimental software — not security-hardened**. It is an early-stage project: expect bugs and security holes, and assume **no security support and no security guarantees**. Use it only for local development and testing on repositories you trust.

## Trust boundary

Frostline's hooks observe supported file-read operations, classify shell commands, and execute local subprocesses (`fli`, `fli-classify-reads`, the Codex native adapter). Everything they read can end up delivered verbatim into an AI agent's context, and from there to the model provider.

## Known risks

- **Reads outside the repository.** A `parents:` declaration is resolved by searching upward from the declaring file to the filesystem root. A malicious or careless declaration such as `parents: ../../../secrets.md` makes Frostline read arbitrary local files that are reachable that way and inject their contents into the AI model context.
- **Unprotected local cache.** Frostline persists document contents and delivery state under the user's cache directory (XDG or HOME based) with default filesystem permissions (typically `0755`/`0644`). Any local process or user that can read that directory sees everything Frostline has cached.
- **Local subprocess execution.** The hooks spawn local binaries on supported read events. Compromise of the bundled binaries, or of the PATH they resolve through, is code execution in the user's environment.

## Safe usage

- Point Frostline only at repositories whose full contents and `parents:` declarations you trust.
- Do not install packages from unverified sources; the only supported installation path is the dev install script from a local checkout.
- There is no public plugin distribution or marketplace delivery yet.

## Reporting

There is no private vulnerability disclosure process. If you find a security-relevant defect, open a public GitHub issue and label it clearly; verify it reproduces on the latest `main` first.
