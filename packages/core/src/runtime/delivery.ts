// parents: @.frostline/graph/m-context.xml

import { updateState } from "./state.ts";
import type { ContextDocument, DeliveryScope } from "../types.ts";

type DeliveredDocuments = Record<string, string>;
type SessionDelivery = Record<string, DeliveredDocuments>;
type DeliveryState = Record<string, SessionDelivery>;

export interface DeliveryResult {
  documents: ContextDocument[];
  warnings: string[];
}

export class DeliveryStore {
  constructor(private readonly cacheDirectory: string) {}

  filter(scope: DeliveryScope, documents: ContextDocument[]): DeliveryResult {
    try {
      return updateState(this.cacheDirectory, (state) => {
        const sessionKey = deliveryKey(scope.sessionId);
        const contextKey = deliveryKey(scope.contextId);
        const session = ownSession(state.delivery, sessionKey) ?? {};
        const delivered = ownContext(session, contextKey) ?? {};
        const fresh: ContextDocument[] = [];
        for (const document of documents) {
          const key = documentKey(document);
          if (
            Object.hasOwn(delivered, key) && delivered[key] === document.content
          ) {
            continue;
          }
          delivered[key] = document.content;
          fresh.push(document);
        }
        session[contextKey] = delivered;
        state.delivery[sessionKey] = session;
        return { documents: fresh, warnings: [] };
      });
    } catch (error) {
      return {
        documents,
        warnings: [
          `cannot update FLI delivery state: ${
            errorText(error)
          }; reinjecting safely`,
        ],
      };
    }
  }

  resetContext(scope: DeliveryScope): string[] {
    try {
      updateState(this.cacheDirectory, (state) => {
        const sessionKey = deliveryKey(scope.sessionId);
        const contextKey = deliveryKey(scope.contextId);
        const session = ownSession(state.delivery, sessionKey);
        if (!session) return;
        delete session[contextKey];
        if (Object.keys(session).length === 0) {
          delete state.delivery[sessionKey];
        }
      });
      return [];
    } catch (error) {
      return [`cannot reset FLI delivery context: ${errorText(error)}`];
    }
  }

  resetSession(sessionId: string): string[] {
    try {
      updateState(this.cacheDirectory, (state) => {
        delete state.delivery[deliveryKey(sessionId)];
      });
      return [];
    } catch (error) {
      return [`cannot reset FLI delivery session: ${errorText(error)}`];
    }
  }
}

function deliveryKey(value: string): string {
  return `id:${value}`;
}

function ownSession(
  delivery: DeliveryState,
  key: string,
): SessionDelivery | undefined {
  return Object.hasOwn(delivery, key) ? delivery[key] : undefined;
}

function ownContext(
  session: SessionDelivery,
  key: string,
): DeliveredDocuments | undefined {
  return Object.hasOwn(session, key) ? session[key] : undefined;
}

function documentKey(document: ContextDocument): string {
  return document.identity;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
