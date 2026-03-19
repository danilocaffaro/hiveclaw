// ============================================================
// Tool Registry — all 21 tools
// ============================================================
import type { Tool } from './types.js';

import { BashTool } from './bash.js';
import { EditTool } from './edit.js';
import { GlobTool } from './glob.js';
import { GrepTool } from './grep.js';
import { ReadTool } from './read.js';
import { WriteTool } from './write.js';
import { WebFetchTool } from './webfetch.js';
import { TaskTool } from './task.js';
import { TodoTool } from './todo.js';
import { MemoryTool } from './memory.js';
import { VisualMemoryTool } from './visual-memory.js';
import { PlansTool } from './plans.js';
import { QuestionTool } from './question.js';
import { DataAnalysisTool } from './data-analysis.js';
import { BrowserTool } from './browser.js';
import { CredentialTool } from './credential.js';
import { ScreenshotTool } from './screenshot.js';
import { WebSearchTool } from './web-search.js';
import { MacControlTool } from './mac-control.js';
import { CanvasTool } from './canvas.js';
import { NodeControlTool } from '../nodes/node-tool.js';

export { BashTool } from './bash.js';
export { EditTool } from './edit.js';
export { GlobTool } from './glob.js';
export { GrepTool } from './grep.js';
export { ReadTool } from './read.js';
export { WriteTool } from './write.js';
export { WebFetchTool } from './webfetch.js';
export { TaskTool } from './task.js';
export { TodoTool } from './todo.js';
export { MemoryTool } from './memory.js';
export { VisualMemoryTool } from './visual-memory.js';
export { PlansTool } from './plans.js';
export { QuestionTool } from './question.js';
export { DataAnalysisTool } from './data-analysis.js';
export { BrowserTool } from './browser.js';
export { CredentialTool } from './credential.js';
export { ScreenshotTool } from './screenshot.js';
export { WebSearchTool } from './web-search.js';
export { MacControlTool } from './mac-control.js';
export { CanvasTool } from './canvas.js';
export { NodeControlTool } from '../nodes/node-tool.js';

export type { Tool, ToolInput, ToolOutput, ToolDefinition, ToolContext } from './types.js';
export { formatToolResult } from './types.js';

/**
 * Returns a Map of all registered tools, keyed by their name.
 */
export function getToolRegistry(): Map<string, Tool> {
  const tools: Tool[] = [
    new BashTool(),
    new EditTool(),
    new GlobTool(),
    new GrepTool(),
    new ReadTool(),
    new WriteTool(),
    new WebFetchTool(),
    new TaskTool(),
    new TodoTool(),
    new MemoryTool(),
    new VisualMemoryTool(),
    new PlansTool(),
    new QuestionTool(),
    new DataAnalysisTool(),
    new BrowserTool(),
    new CredentialTool(),
    new ScreenshotTool(),
    new WebSearchTool(),
    new MacControlTool(),
    new CanvasTool(),
    new NodeControlTool(),
  ];

  const registry = new Map<string, Tool>();
  for (const tool of tools) {
    registry.set(tool.definition.name, tool);
  }
  return registry;
}
