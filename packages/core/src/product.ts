// parents: @.frostline/graph/ss-runtime.xml

import { Engine } from "./runtime/engine.ts";
import { renderContext } from "./runtime/context.ts";
import { DeliveryStore } from "./runtime/delivery.ts";
import { defaultCacheDirectory } from "./runtime/state.ts";
import {
  graphBoundary,
  projectDiscriminator,
  relativeIdentity,
} from "./runtime/paths.ts";
import type {
  AncestorsOutput,
  AncestorsRequest,
  ContextDocument,
  DeliveredDocument,
  DeliveryScope,
  GraphOutput,
  GraphRequest,
} from "./types.ts";

export class Frostline {
  private readonly engine: Engine;
  private readonly delivery: DeliveryStore;

  constructor(cacheDirectory: string = defaultCacheDirectory()) {
    this.engine = new Engine(cacheDirectory);
    this.delivery = new DeliveryStore(cacheDirectory);
  }

  ancestors(request: AncestorsRequest): AncestorsOutput {
    const core = this.engine.process(request.files);
    let documents = core.documents;
    let stateWarnings: string[] = [];
    if (request.deliveryScope) {
      const delivery = this.delivery.filter(request.deliveryScope, documents);
      documents = delivery.documents;
      stateWarnings = delivery.warnings;
    }
    return {
      context: renderContext(documents),
      documents: documents.map(deliveredDocument),
      diagnostics: core.diagnostics,
      stateWarnings,
    };
  }

  graph(request: GraphRequest): GraphOutput {
    return this.engine.graph(request);
  }

  resetContext(scope: DeliveryScope): string[] {
    return this.delivery.resetContext(scope);
  }

  resetSession(sessionId: string): string[] {
    return this.delivery.resetSession(sessionId);
  }
}

/**
 * Structured delivery identity for integration UX notices: project-relative
 * path plus project discriminator inside an inferred graph boundary, exact
 * delivery identity preserved for dedup.
 */
function deliveredDocument(document: ContextDocument): DeliveredDocument {
  const boundary = graphBoundary(document.path);
  if (boundary.root !== undefined) {
    const relative = relativeIdentity(boundary.root, document.path);
    if (relative !== document.path) {
      return {
        path: relative,
        identity: document.identity,
        project: projectDiscriminator(boundary.root),
      };
    }
  }
  return { path: document.path, identity: document.identity };
}
