/** Type definitions for repo-aeo-mcp. */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface ToolDescriptor {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** Result payload shape shared by every tool. */
export interface ToolPayload {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export declare const SERVER_NAME: 'repo-aeo-mcp';
export declare const SERVER_VERSION: string;
export declare const PROTOCOL_VERSION: string;

/** Handles a single JSON-RPC message; returns null for notifications. */
export declare function handleMessage(message: JsonRpcRequest | unknown, context?: { cwd?: string }): Promise<JsonRpcResponse | null>;

/** Runs the stdio JSON-RPC loop. */
export declare function serve(options?: {
  cwd?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  readOnly?: boolean;
}): Promise<void>;
