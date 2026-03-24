import { create } from 'zustand';
import { getApiBase, getAuthToken } from '../lib/api-base';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkflowStep {
  name: string;
  agentRole: string;
  description: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  emoji: string;
  description: string;
  steps: WorkflowStep[];
  category: 'development' | 'content' | 'research' | 'operations';
}

export interface WorkflowRunStep {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  duration?: number;
}

export interface WorkflowRun {
  id: string;
  templateId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentStep: number;
  steps: WorkflowRunStep[];
  startedAt: string;
}

interface WorkflowState {
  templates: WorkflowTemplate[];
  activeRuns: WorkflowRun[];
  fetchTemplates: () => void;
  startWorkflow: (templateId: string) => void;
  cancelRun: (runId: string) => void;
  cleanup: () => void;
}

// Module-level SSE connection tracking to prevent EventSource leaks
const activeSources = new Map<string, EventSource>();

// ─── Store ────────────────────────────────────────────────────────────────────

export const useWorkflowStore = create<WorkflowState>((set) => ({
  templates: [],
  activeRuns: [],

  fetchTemplates: () => {
    fetch(`${getApiBase()}/workflows`)
      .then((r) => r.json())
      .then((d) => {
        const templates = (d.data ?? []).map((t: Record<string, unknown>) => ({
          ...t,
          category: t.category || 'development',
        }));
        set({ templates });
      })
      .catch(() => {
        set({ templates: [] });
      });
  },

  startWorkflow: (templateId: string) => {
    fetch(`${getApiBase()}/workflows/${templateId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then((r) => r.json())
      .then((d) => {
        const apiRun = d.data;
        if (!apiRun) return;

        const run: WorkflowRun = {
          id: apiRun.id,
          templateId: apiRun.workflowId,
          status: (apiRun.status === 'pending' ? 'running' : apiRun.status) as WorkflowRun['status'],
          currentStep: apiRun.currentStep ?? 0,
          startedAt: apiRun.startedAt || new Date().toISOString(),
          steps: (apiRun.steps ?? []).map((s: Record<string, unknown>) => ({
            name: s.name,
            status: s.status === 'done' ? 'done' : s.status,
            duration: s.durationMs,
          })),
        };

        set((s) => ({ activeRuns: [...s.activeRuns, run] }));

        // Subscribe to SSE for real-time updates
        const token = getAuthToken();
        const es = new EventSource(`${getApiBase()}/workflow-runs/${run.id}/stream${token ? `?token=${token}` : ''}`);
        activeSources.set(run.id, es);

        es.addEventListener('step.start', (e) => {
          const data = JSON.parse(e.data);
          set((s) => ({
            activeRuns: s.activeRuns.map((r) => {
              if (r.id !== run.id) return r;
              const steps = r.steps.map((st, i) =>
                i === data.stepIndex ? { ...st, status: 'running' as const } : st
              );
              return { ...r, currentStep: data.stepIndex, steps };
            }),
          }));
        });

        es.addEventListener('step.finish', (e) => {
          const data = JSON.parse(e.data);
          set((s) => ({
            activeRuns: s.activeRuns.map((r) => {
              if (r.id !== run.id) return r;
              const steps = r.steps.map((st, i) =>
                i === data.stepIndex
                  ? { ...st, status: data.status as 'done' | 'failed', duration: data.duration }
                  : st
              );
              return { ...r, steps };
            }),
          }));
        });

        es.addEventListener('run.finish', (e) => {
          const data = JSON.parse(e.data);
          set((s) => ({
            activeRuns: s.activeRuns.map((r) =>
              r.id === run.id ? { ...r, status: data.status } : r
            ),
          }));
          es.close();
          activeSources.delete(run.id);
        });

        es.onerror = () => {
          es.close();
          activeSources.delete(run.id);
        };
      })
      .catch(() => {});
  },

  cancelRun: (runId: string) => {
    // Close SSE connection for cancelled run
    const es = activeSources.get(runId);
    if (es) {
      es.close();
      activeSources.delete(runId);
    }

    fetch(`${getApiBase()}/workflow-runs/${runId}/cancel`, { method: 'POST' })
      .then(() => {
        set((s) => ({
          activeRuns: s.activeRuns.filter((r) => r.id !== runId),
        }));
      })
      .catch(() => {
        // Remove locally anyway
        set((s) => ({
          activeRuns: s.activeRuns.filter((r) => r.id !== runId),
        }));
      });
  },

  cleanup: () => {
    // Close all active SSE connections (e.g. on unmount)
    activeSources.forEach((es) => es.close());
    activeSources.clear();
  },
}));
