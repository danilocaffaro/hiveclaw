// ============================================================
// Memory Tool — unified agent memory (Sprint 65: Eidetic Memory)
//
// Replaces the legacy MemoryTool that used a separate `memories` table.
// Now delegates to AgentMemoryRepository (agent_memory table) +
// FTS5 archival search (messages_fts) for Total Recall.
// ============================================================

import { AgentMemoryRepository } from '../../db/agent-memory.js';
import type { MemoryType } from '../../db/agent-memory.js';
import type { Tool, ToolInput, ToolOutput, ToolDefinition, ToolContext } from './types.js';
import { getDb } from '../../db/schema.js';

export class MemoryTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'memory',
    description: `Store, search, and manage persistent agent memories. Also search full chat history.
Actions:
- create: Store a new memory (fact, decision, goal, preference, entity, event, procedure, correction)
- search: Search agent memories by query (LIKE match on key/value)
- archival_search: Full-text search across ALL past messages (FTS5 BM25)
- list: List memories, optionally filtered by type
- delete: Delete a memory by ID
- core_read: Read a core memory block (always in prompt)
- core_replace: Surgical edit of a core memory block
- core_append: Append text to a core memory block

MANDATORY: Before saying "I don't know" or "I don't remember", you MUST:
1. search(query) — check agent memories
2. archival_search(query) — check full chat history
Only after both return empty may you say you lack the information.`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'search', 'archival_search', 'list', 'delete', 'core_read', 'core_replace', 'core_append'],
          description: 'Action to perform',
        },
        // create
        key: { type: 'string', description: 'Memory key/label (required for create)' },
        value: { type: 'string', description: 'Memory content (required for create)' },
        type: {
          type: 'string',
          enum: ['fact', 'decision', 'goal', 'preference', 'entity', 'event', 'procedure', 'correction', 'short_term', 'long_term'],
          description: 'Memory type (default: fact)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for the memory (optional)',
        },
        // search / archival_search
        query: { type: 'string', description: 'Search query (required for search/archival_search)' },
        session_id: { type: 'string', description: 'Scope archival_search to a session (optional)' },
        // delete
        id: { type: 'string', description: 'Memory ID (required for delete)' },
        // list
        filter_type: { type: 'string', description: 'Filter by type when listing' },
        limit: { type: 'number', description: 'Max results (default: 20)' },
        // core_*
        block: { type: 'string', description: 'Core memory block name (persona, human, project, scratchpad)' },
        old_text: { type: 'string', description: 'Text to replace (for core_replace)' },
        new_text: { type: 'string', description: 'Replacement text (for core_replace)' },
        text: { type: 'string', description: 'Text to append (for core_append)' },
      },
      required: ['action'],
    },
  };

  async execute(input: ToolInput, context?: ToolContext): Promise<ToolOutput> {
    const action = input['action'] as string;
    const agentId = context?.agentId ?? 'default';

    try {
      const db = context?.db ?? getDb();
      const repo = new AgentMemoryRepository(db);

      switch (action) {
        case 'create': {
          const key = input['key'] as string;
          const value = input['value'] as string;
          if (!key || !value) return { success: false, error: 'key and value are required for create' };

          // S1.4: Anti-injection scan on memory entries
          const suspiciousPatterns = [
            /ignore\s+(all\s+)?previous\s+instructions/i,
            /you\s+are\s+now\s+a/i,
            /disregard\s+(all\s+)?(prior|previous|above)/i,
            /forget\s+(everything|all|your)\s+(instructions|rules|guidelines)/i,
            /new\s+system\s+prompt/i,
            /\bsystem\s*:\s*/i,
            /\[INST\]|\[\/INST\]|<\|im_start\|>|<\|system\|>/i,
            /override\s+(safety|security|rules)/i,
          ];
          const combinedText = `${key} ${value}`;
          const injectionMatch = suspiciousPatterns.find(p => p.test(combinedText));
          if (injectionMatch) {
            return { success: false, error: 'Memory entry rejected: contains suspicious pattern that may be a prompt injection attempt. If this is legitimate content, rephrase without instruction-like language.' };
          }

          const type = (input['type'] as MemoryType | undefined) ?? 'fact';
          const tags = Array.isArray(input['tags']) ? input['tags'] as string[] : undefined;

          const { memory, contradicted } = repo.setWithContradictionCheck(
            agentId, key, value, type, { source: 'agent_tool', tags },
          );

          const result: Record<string, unknown> = {
            id: memory.id,
            message: `Memory stored: [${type}] ${key}`,
          };
          if (contradicted.length > 0) {
            result.contradicted = contradicted.map(c => `[${c.type}] ${c.key}: ${c.value}`);
            result.message = `Memory stored (${contradicted.length} previous value(s) invalidated)`;
          }
          return { success: true, result };
        }

        case 'search': {
          const query = input['query'] as string;
          if (!query) return { success: false, error: 'query is required for search' };

          const limit = (input['limit'] as number) ?? 20;
          const results = repo.search(query, limit);

          if (results.length === 0) {
            return { success: true, result: 'No memories found matching query.' };
          }

          const formatted = results.map(m =>
            `[${m.type}] ${m.key}: ${m.value}${m.valid_until ? ' (EXPIRED)' : ''}`
          );
          return { success: true, result: formatted };
        }

        case 'archival_search': {
          const query = input['query'] as string;
          if (!query) return { success: false, error: 'query is required for archival_search' };

          const limit = (input['limit'] as number) ?? 10;
          const sessionId = input['session_id'] as string | undefined;
          const results = repo.archivalSearchWithSnippets(query, { sessionId, limit });

          if (results.length === 0) {
            return { success: true, result: 'No messages found in chat history matching query.' };
          }

          const formatted = results.map(r =>
            `[${r.created_at}] ${r.snippet}`
          );
          return { success: true, result: formatted };
        }

        case 'list': {
          const filterType = input['filter_type'] as MemoryType | undefined;
          const limit = (input['limit'] as number) ?? 20;
          const results = repo.list(agentId, { type: filterType, limit });

          if (results.length === 0) {
            return { success: true, result: 'No memories stored.' };
          }

          const formatted = results.map(m =>
            `[${m.type}] ${m.key}: ${m.value}${m.valid_until ? ' (EXPIRED)' : ''}`
          );
          return { success: true, result: formatted };
        }

        case 'delete': {
          const id = input['id'] as string;
          if (!id) return { success: false, error: 'id is required for delete' };
          const deleted = repo.delete(id);
          if (!deleted) return { success: false, error: `Memory not found: ${id}` };
          return { success: true, result: `Memory deleted: ${id}` };
        }

        case 'core_read': {
          const block = input['block'] as string;
          if (!block) return { success: false, error: 'block name is required' };
          const content = repo.getCoreBlock(agentId, block);
          return { success: true, result: content || '(empty)' };
        }

        case 'core_replace': {
          const block = input['block'] as string;
          const oldText = input['old_text'] as string;
          const newText = input['new_text'] as string;
          if (!block || !oldText || newText === undefined) {
            return { success: false, error: 'block, old_text, and new_text are required' };
          }
          const replaced = repo.coreBlockReplace(agentId, block, oldText, newText);
          if (!replaced) return { success: false, error: `Text "${oldText}" not found in block "${block}"` };
          return { success: true, result: `Core memory block "${block}" updated.` };
        }

        case 'core_append': {
          const block = input['block'] as string;
          const text = input['text'] as string;
          if (!block || !text) return { success: false, error: 'block and text are required' };
          repo.coreBlockAppend(agentId, block, text);
          return { success: true, result: `Appended to core memory block "${block}".` };
        }

        default:
          return { success: false, error: `Unknown action: ${action}. Use create, search, archival_search, list, delete, core_read, core_replace, core_append.` };
      }
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }
}
