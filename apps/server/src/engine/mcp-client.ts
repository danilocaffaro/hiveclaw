import { logger } from '../lib/logger.js';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command?: string; // for stdio: e.g. "npx -y @modelcontextprotocol/server-filesystem /tmp"
  args?: string[];
  url?: string; // for http: e.g. "http://localhost:3001"
  env?: Record<string, string>;
  enabled: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
  serverName: string;
}

export interface MCPResource {
  uri: string;
  name: string;
  mimeType?: string;
  serverId: string;
}

export class MCPClient extends EventEmitter {
  private servers: Map<string, MCPServerConnection> = new Map();
  private tools: MCPTool[] = [];

  async connect(config: MCPServerConfig): Promise<void> {
    if (!config.enabled) return;

    const conn = new MCPServerConnection(config);
    await conn.initialize();
    this.servers.set(config.id, conn);

    // Fetch tools from this server
    const serverTools = await conn.listTools();
    this.tools.push(
      ...serverTools.map((t) => ({
        ...t,
        serverId: config.id,
        serverName: config.name,
      })),
    );

    this.emit('connected', config.id);
  }

  async disconnect(serverId: string): Promise<void> {
    const conn = this.servers.get(serverId);
    if (conn) {
      await conn.close();
      this.servers.delete(serverId);
      this.tools = this.tools.filter((t) => t.serverId !== serverId);
      this.emit('disconnected', serverId);
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [id] of this.servers) {
      await this.disconnect(id);
    }
  }

  getTools(): MCPTool[] {
    return this.tools;
  }

  getConnectedServers(): string[] {
    return Array.from(this.servers.keys());
  }

  isConnected(serverId: string): boolean {
    return this.servers.has(serverId);
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const conn = this.servers.get(serverId);
    if (!conn) throw new Error(`MCP server ${serverId} not connected`);
    return conn.callTool(toolName, args);
  }
}

class MCPServerConnection {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> =
    new Map();
  private buffer = '';

  constructor(private config: MCPServerConfig) {}

  async initialize(): Promise<void> {
    if (this.config.transport === 'stdio') {
      return this.initStdio();
    }
    // HTTP transport: just verify the server is reachable
    if (this.config.url) {
      try {
        const res = await fetch(this.config.url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok && res.status !== 404) {
          throw new Error(`MCP HTTP server returned ${res.status}`);
        }
      } catch (e) {
        throw new Error(
          `Cannot reach MCP server at ${this.config.url}: ${(e as Error).message}`,
        );
      }
    }
  }

  private async initStdio(): Promise<void> {
    if (!this.config.command) throw new Error('stdio transport requires command');

    const [cmd, ...defaultArgs] = this.config.command.split(' ');
    const args = [...defaultArgs, ...(this.config.args || [])];

    this.process = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.config.env } as NodeJS.ProcessEnv,
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.on('error', (err: Error) => {
      logger.error(`MCP server ${this.config.id} error: ${err.message}`);
    });

    this.process.on('exit', (code: number | null) => {
      logger.info(`MCP server ${this.config.id} exited with code ${code}`);
      // Reject all pending requests
      for (const [, { reject }] of this.pending) {
        reject(new Error('MCP server exited'));
      }
      this.pending.clear();
    });

    // Send initialize request
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'hiveclaw', version: '0.2.0' },
    });

    // Send initialized notification
    this.sendNotification('notifications/initialized', {});
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as {
          id?: number;
          error?: { message?: string };
          result?: unknown;
        };
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || 'MCP error'));
          else resolve(msg.result);
        }
      } catch {
        /* ignore non-JSON lines */
      }
    }
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pending.set(id, { resolve, reject });

      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });

      if (this.config.transport === 'stdio' && this.process?.stdin) {
        this.process.stdin.write(msg + '\n');
      }

      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request ${method} timed out`));
        }
      }, 30000);
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    if (this.config.transport === 'stdio' && this.process?.stdin) {
      this.process.stdin.write(msg + '\n');
    }
  }

  async listTools(): Promise<
    Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
  > {
    try {
      const result = (await this.sendRequest('tools/list', {})) as {
        tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
      } | null;
      return (result?.tools || []).map((t) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || {},
      }));
    } catch {
      return [];
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = (await this.sendRequest('tools/call', { name, arguments: args })) as {
      content?: Array<{ text?: string }>;
    } | null;
    return result?.content?.[0]?.text || result;
  }

  async close(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.pending.clear();
  }
}

// Singleton
let mcpClient: MCPClient | null = null;

export function getMCPClient(): MCPClient {
  if (!mcpClient) mcpClient = new MCPClient();
  return mcpClient;
}
