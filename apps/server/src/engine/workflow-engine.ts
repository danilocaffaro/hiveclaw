// ============================================================
// Workflow Engine — Orchestrates multi-step workflow execution
// ============================================================

import { WorkflowRepository, type WorkflowRun, type WorkflowRunStep } from '../db/workflow-repository.js';
import { getProviderRouter } from './providers/index.js';
import { getSessionManager } from './session-manager.js';
import { type MessageBus } from './message-bus.js';
import type { LLMMessage } from './providers/types.js';

// ─── Engine ───────────────────────────────────────────────────────────────────

export class WorkflowEngine {
  private activeSessions = new Map<string, AbortController>();

  constructor(
    private repo: WorkflowRepository,
    public readonly bus: MessageBus,
  ) {}

  async startRun(workflowId: string, params?: Record<string, string>): Promise<WorkflowRun> {
    const run = this.repo.createRun(workflowId, params);
    this.repo.updateRunStatus(run.id, 'running');

    // Execute steps in background (don't await)
    const controller = new AbortController();
    this.activeSessions.set(run.id, controller);
    void this.executeRun(run.id, controller.signal);

    return this.repo.getRun(run.id)!;
  }

  cancelRun(runId: string): void {
    const controller = this.activeSessions.get(runId);
    if (controller) {
      controller.abort();
      this.activeSessions.delete(runId);
    }
    this.repo.updateRunStatus(runId, 'cancelled');
    this.publishEvent(runId, 'run.finish', { runId, status: 'cancelled' });
  }

  getRun(runId: string): WorkflowRun | null {
    return this.repo.getRun(runId);
  }

  listRuns(status?: string): WorkflowRun[] {
    return this.repo.listRuns(status);
  }

  // ── Internal Execution ──────────────────────────────────────────────────────

  private async executeRun(runId: string, signal: AbortSignal): Promise<void> {
    try {
      const run = this.repo.getRun(runId);
      if (!run) return;

      let previousOutput = '';

      for (let i = 0; i < run.steps.length; i++) {
        if (signal.aborted) return;

        const step = run.steps[i];
        this.repo.updateStepStatus(step.id, 'running');
        this.publishEvent(runId, 'step.start', {
          runId,
          stepIndex: i,
          name: step.name,
        });

        const startTime = Date.now();

        try {
          // Create a session for this step
          const sm = getSessionManager();
          const session = sm.createSession({ title: `WF: ${step.name}` });

          // Build step prompt with context from previous steps
          const stepPrompt = this.buildStepPrompt(step, previousOutput, run.params);

          // Save user message
          sm.addMessage(session.id, {
            role: 'user',
            content: stepPrompt,
          });

          // Use the provider directly (standalone mode)
          // TODO: B003 Phase 2 — route through OpenClaw Bridge for model routing
          const router = getProviderRouter();
          const provider = router.getDefault();
          if (!provider) throw new Error('No provider available');

          const messages: LLMMessage[] = [
            {
              role: 'system',
              content: `You are a workflow step executor. Your role: ${step.agentRole}. Complete the following task thoroughly and output your result.`,
            },
            {
              role: 'user',
              content: stepPrompt,
            },
          ];

          let output = '';
          for await (const chunk of router.chatWithFallback(messages, {
            model: typeof provider.models[0] === 'string' ? provider.models[0] : provider.models[0],
            maxTokens: 4096,
          }, [provider.id])) {
            if (signal.aborted) return;
            if (chunk.type === 'text') output += chunk.text;
          }

          const duration = Date.now() - startTime;
          this.repo.updateStepStatus(step.id, 'done', output, duration);
          previousOutput = output;

          // Save assistant response
          sm.addMessage(session.id, {
            role: 'assistant',
            content: output,
          });

          this.publishEvent(runId, 'step.finish', {
            runId,
            stepIndex: i,
            status: 'done',
            duration,
          });
        } catch (err) {
          const duration = Date.now() - startTime;
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.repo.updateStepStatus(step.id, 'failed', errorMsg, duration);
          throw err;
        }
      }

      this.repo.updateRunStatus(runId, 'completed');
      this.publishEvent(runId, 'run.finish', { runId, status: 'completed' });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.repo.updateRunStatus(runId, 'failed', errorMsg);
      this.publishEvent(runId, 'run.finish', {
        runId,
        status: 'failed',
        error: errorMsg,
      });
    } finally {
      this.activeSessions.delete(runId);
    }
  }

  private buildStepPrompt(
    step: WorkflowRunStep,
    previousOutput: string,
    params: Record<string, string>,
  ): string {
    let prompt = `## Task: ${step.name}\n\n${step.inputContext || 'Complete this workflow step.'}\n`;

    if (previousOutput) {
      prompt += `\n## Context from Previous Step:\n${previousOutput}\n`;
    }

    if (Object.keys(params).length > 0) {
      prompt += `\n## Parameters:\n${JSON.stringify(params, null, 2)}\n`;
    }

    return prompt;
  }

  /**
   * Publish a workflow event to the message bus using the AgentMessage format.
   */
  private publishEvent(
    runId: string,
    topic: string,
    payload: Record<string, unknown>,
  ): void {
    this.bus.publish({
      from: 'system',
      to: `workflow.run.${runId}`,
      type: 'broadcast',
      content: JSON.stringify({ topic, ...payload }),
      metadata: {
        sessionId: runId,
        priority: 0,
        timestamp: Date.now(),
      },
    });
  }
}

// ─── Seed Built-in Workflows ──────────────────────────────────────────────────

export function seedBuiltinWorkflows(repo: WorkflowRepository): void {
  repo.seedBuiltins([
    {
      name: 'Code Review Pipeline',
      emoji: '🔍',
      description: 'Automated code review: lint → security → logic → style',
      category: 'development',
      steps: [
        { name: 'Lint Check', agentRole: 'coder', description: 'Run linters and fix auto-fixable issues' },
        { name: 'Security Scan', agentRole: 'devops', description: 'Check for security vulnerabilities' },
        { name: 'Logic Review', agentRole: 'architect', description: 'Review business logic and edge cases' },
        { name: 'Style Review', agentRole: 'reviewer', description: 'Check code style and best practices' },
      ],
    },
    {
      name: 'Feature Development',
      emoji: '🚀',
      description: 'Plan → Code → Test → Review → Deploy',
      category: 'development',
      steps: [
        { name: 'Planning', agentRole: 'architect', description: 'Design the feature architecture' },
        { name: 'Implementation', agentRole: 'coder', description: 'Write the code' },
        { name: 'Testing', agentRole: 'coder', description: 'Write and run tests' },
        { name: 'Code Review', agentRole: 'reviewer', description: 'Review the implementation' },
        { name: 'Deploy', agentRole: 'devops', description: 'Deploy to staging/production' },
      ],
    },
    {
      name: 'Content Creation',
      emoji: '✍️',
      description: 'Research → Draft → Edit → Publish',
      category: 'content',
      steps: [
        { name: 'Research', agentRole: 'analyst', description: 'Research topic and gather sources' },
        { name: 'Draft', agentRole: 'writer', description: 'Write the first draft' },
        { name: 'Edit', agentRole: 'reviewer', description: 'Edit for clarity and accuracy' },
        { name: 'Publish', agentRole: 'writer', description: 'Format and publish' },
      ],
    },
    {
      name: 'Bug Fix Pipeline',
      emoji: '🐛',
      description: 'Reproduce → Diagnose → Fix → Verify',
      category: 'development',
      steps: [
        { name: 'Reproduce', agentRole: 'coder', description: 'Create minimal reproduction' },
        { name: 'Root Cause', agentRole: 'architect', description: 'Identify the root cause' },
        { name: 'Fix', agentRole: 'coder', description: 'Implement the fix' },
        { name: 'Verify', agentRole: 'reviewer', description: 'Verify fix and check for regressions' },
      ],
    },
    {
      name: 'Research Report',
      emoji: '📊',
      description: 'Gather → Analyze → Synthesize → Present',
      category: 'research',
      steps: [
        { name: 'Data Gathering', agentRole: 'analyst', description: 'Collect data from multiple sources' },
        { name: 'Analysis', agentRole: 'analyst', description: 'Analyze trends and patterns' },
        { name: 'Synthesis', agentRole: 'writer', description: 'Synthesize findings into a report' },
        { name: 'Presentation', agentRole: 'writer', description: 'Create executive summary and visuals' },
      ],
    },
    {
      name: 'Morning Briefing',
      emoji: '☀️',
      description: 'News → Weather → Calendar → Summary',
      category: 'operations',
      steps: [
        { name: 'News Scan', agentRole: 'analyst', description: 'Scan top news sources for relevant headlines' },
        { name: 'Weather Check', agentRole: 'assistant', description: 'Get weather forecast for the day' },
        { name: 'Calendar Review', agentRole: 'assistant', description: 'Review today\'s schedule and reminders' },
        { name: 'Daily Brief', agentRole: 'writer', description: 'Compile everything into a concise morning brief' },
      ],
    },
    {
      name: 'Social Media Pipeline',
      emoji: '📱',
      description: 'Idea → Draft → Edit → Schedule',
      category: 'content',
      steps: [
        { name: 'Topic Research', agentRole: 'analyst', description: 'Research trending topics and audience interests' },
        { name: 'Draft Posts', agentRole: 'writer', description: 'Write posts adapted for each platform' },
        { name: 'Review & Polish', agentRole: 'reviewer', description: 'Edit for tone, grammar, and engagement' },
        { name: 'Schedule', agentRole: 'assistant', description: 'Prepare for publishing at optimal times' },
      ],
    },
    {
      name: 'Email Digest',
      emoji: '📧',
      description: 'Scan → Summarize → Prioritize → Draft',
      category: 'operations',
      steps: [
        { name: 'Inbox Scan', agentRole: 'assistant', description: 'Review unread emails and flag important ones' },
        { name: 'Summarize', agentRole: 'writer', description: 'Summarize each important email in 1-2 sentences' },
        { name: 'Prioritize', agentRole: 'analyst', description: 'Rank by urgency and suggest action items' },
        { name: 'Draft Replies', agentRole: 'writer', description: 'Draft replies for emails that need response' },
      ],
    },
    {
      name: 'Market Research',
      emoji: '🔍',
      description: 'Search → Compare → Analyze → Recommend',
      category: 'research',
      steps: [
        { name: 'Web Search', agentRole: 'analyst', description: 'Search for products, services, or competitors' },
        { name: 'Data Collection', agentRole: 'analyst', description: 'Gather pricing, features, and reviews' },
        { name: 'Comparison', agentRole: 'analyst', description: 'Build comparison matrix and identify trade-offs' },
        { name: 'Recommendation', agentRole: 'writer', description: 'Write recommendation with pros/cons and best pick' },
      ],
    },
  ]);
}
