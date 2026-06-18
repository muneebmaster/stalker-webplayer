import { randomUUID } from "crypto";
import { StalkerClient } from "./stalkerClient.js";
import type { StalkerCredentials } from "./types.js";

interface StoredSession {
  client: StalkerClient;
  credentials: StalkerCredentials;
  createdAt: number;
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const sessions = new Map<string, StoredSession>();

export function createSession(
  client: StalkerClient,
  credentials: StalkerCredentials
): {
  sessionId: string;
  client: StalkerClient;
} {
  const sessionId = randomUUID();
  sessions.set(sessionId, { client, credentials, createdAt: Date.now() });
  return { sessionId, client };
}

export function getSession(sessionId: string | undefined): StalkerClient {
  if (!sessionId) {
    throw new SessionError("Missing session id. Connect to a portal first.");
  }
  const entry = sessions.get(sessionId);
  if (!entry) {
    throw new SessionError("Session not found or expired. Reconnect to the portal.");
  }
  if (Date.now() - entry.createdAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    throw new SessionError("Session expired. Reconnect to the portal.");
  }
  return entry.client;
}

export function destroySession(sessionId: string): void {
  sessions.delete(sessionId);
}

export class SessionError extends Error {}
