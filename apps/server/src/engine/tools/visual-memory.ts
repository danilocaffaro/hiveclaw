// ============================================================
// Visual Memory Tool — Describe-then-Store pattern (Sprint 67)
//
// When an image is received (screenshot, upload, camera snap),
// this tool:
//   1. Stores a text description in agent_memory (L4)
//   2. Saves the image path reference in episodes (L5)
//   3. Enables later re-analysis on demand
//
// Does NOT store image blobs in DB — only paths + descriptions.
// ============================================================

import { AgentMemoryRepository } from '../../db/agent-memory.js';
import type { Tool, ToolInput, ToolOutput, ToolDefinition, ToolContext } from './types.js';
import { getDb } from '../../db/schema.js';

export class VisualMemoryTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'visual_memory',
    description: `Store visual information as searchable text memories. Use when you see or process an image.
Actions:
- store: Describe an image and store the description + path reference
- recall: Search visual memories by query
- list: List stored visual memories

For 'store': provide a description of what you see, the image_path, and a source tag.
The description becomes searchable via FTS5 and agent memory graph.`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['store', 'recall', 'list'],
          description: 'Action to perform',
        },
        // store
        description: {
          type: 'string',
          description: 'Text description of the visual content (required for store)',
        },
        image_path: {
          type: 'string',
          description: 'File path or URL of the image (required for store)',
        },
        source: {
          type: 'string',
          enum: ['screenshot', 'upload', 'camera', 'browser', 'generated'],
          description: 'How the image was obtained (default: upload)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization (optional)',
        },
        // recall
        query: {
          type: 'string',
          description: 'Search query for visual memories (required for recall)',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 10)',
        },
      },
      required: ['action'],
    },
  };

  async execute(input: ToolInput, context?: ToolContext): Promise<ToolOutput> {
    const action = input['action'] as string;
    const agentId = context?.agentId ?? 'default';
    const sessionId = context?.sessionId ?? '';

    try {
      const db = context?.db ?? getDb();
      const repo = new AgentMemoryRepository(db);

      switch (action) {
        case 'store': {
          const description = input['description'] as string;
          const imagePath = input['image_path'] as string;
          if (!description) return { success: false, error: 'description is required for store' };
          if (!imagePath) return { success: false, error: 'image_path is required for store' };

          const source = (input['source'] as string) ?? 'upload';
          const tags = Array.isArray(input['tags']) ? input['tags'] as string[] : [];

          // Store description as a fact in agent_memory (searchable via FTS5)
          const memKey = `visual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const memValue = `[Visual: ${source}] ${description}`;
          const memory = repo.set(agentId, memKey, memValue, 'fact', 0.8, undefined, {
            source: `visual_memory:${source}`,
            tags: ['visual', ...tags],
          });

          // Log episode with image path reference
          repo.logEpisode({
            sessionId,
            agentId,
            type: 'event',
            content: `Visual memory stored: ${description.slice(0, 100)}...`,
            eventAt: new Date().toISOString(),
            metadata: {
              image_path: imagePath,
              source,
              memory_id: memory.id,
              description_length: description.length,
            },
          });

          return {
            success: true,
            result: {
              memory_id: memory.id,
              message: `Visual memory stored. Description saved as searchable fact. Image path: ${imagePath}`,
            },
          };
        }

        case 'recall': {
          const query = input['query'] as string;
          if (!query) return { success: false, error: 'query is required for recall' };

          const limit = (input['limit'] as number) ?? 10;

          // Search agent memories tagged with 'visual'
          const allResults = repo.search(`${query}`, limit * 2);
          const visualResults = allResults
            .filter(m => {
              const parsedTags = (() => {
                try { return JSON.parse(m.tags as unknown as string ?? '[]') as string[]; } catch { return []; }
              })();
              return parsedTags.includes('visual') || m.value.startsWith('[Visual:');
            })
            .slice(0, limit);

          if (visualResults.length === 0) {
            return { success: true, result: 'No visual memories found matching query.' };
          }

          const formatted = visualResults.map(m => ({
            id: m.id,
            description: m.value,
            created_at: m.created_at,
          }));
          return { success: true, result: formatted };
        }

        case 'list': {
          const limit = (input['limit'] as number) ?? 20;
          const all = repo.list(agentId, { limit: limit * 2 });
          const visual = all
            .filter(m => m.value.startsWith('[Visual:'))
            .slice(0, limit);

          if (visual.length === 0) {
            return { success: true, result: 'No visual memories stored.' };
          }

          const formatted = visual.map(m => ({
            id: m.id,
            key: m.key,
            description: m.value,
            created_at: m.created_at,
          }));
          return { success: true, result: formatted };
        }

        default:
          return { success: false, error: `Unknown action: ${action}. Use store, recall, list.` };
      }
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }
}
