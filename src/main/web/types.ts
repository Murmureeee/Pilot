// @env node
import type { WebSource } from "../../shared/contract";

export interface WebDocument {
  bytes: Buffer;
  url: URL;
  contentType: string;
  truncated: boolean;
}

export type WebRequest = (url: URL, signal?: AbortSignal) => Promise<WebDocument>;
export type ResolveWebProxy = (url: URL) => Promise<string>;

export interface WebRequests {
  page: WebRequest;
  search: WebRequest;
}

export interface WebHit extends WebSource {
  snippet: string;
}
