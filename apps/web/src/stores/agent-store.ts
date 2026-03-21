import { create } from 'zustand';

// Mirrors the Agent type from @hiveclaw/shared
export interface Agent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  type: 'super' | 'specialist';
  systemPrompt: string;
  skills: string[];
  modelPreference: string;
  providerPreference: string;
  temperature: number;
  maxTokens: number;
  status: 'active' | 'idle' | 'busy' | 'error' | 'offline';
  color: string;
  createdAt: string;
  updatedAt: string;
  source?: 'hiveclaw';
  isExternal?: boolean;
  tier?: string;
  // Federation fields
  isShadow?: boolean;
  federationLinkId?: string;
  remoteAgentId?: string;
}

export interface AgentCreateInput {
  name: string;
  emoji?: string;
  role: string;
  type?: 'super' | 'specialist';
  systemPrompt: string;
  skills?: string[];
  modelPreference?: string;
  providerPreference?: string;
  temperature?: number;
  color?: string;
}

interface AgentStore {
  agents: Agent[];
  activeAgentId: string | null;
  setAgents: (agents: Agent[]) => void;
  setActiveAgent: (id: string | null) => void;
  fetchAgents: () => Promise<void>;
  createAgent: (agent: AgentCreateInput) => Promise<Agent>;
  updateAgent: (id: string, patch: Partial<AgentCreateInput>) => Promise<Agent>;
  deleteAgent: (id: string) => Promise<void>;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error((err as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: [],
  activeAgentId: null,

  setAgents: (agents) => set({ agents }),
  setActiveAgent: (id) => set({ activeAgentId: id }),

  fetchAgents: async () => {
    try {
      const resp = await apiFetch<{ data: Agent[] } | Agent[]>('/agents');
      const rawAgents = Array.isArray(resp) ? resp : (resp as { data: Agent[] }).data ?? [];
      // Normalize agents — normalize agent data from API
      const agents = (rawAgents as unknown as Array<Record<string, unknown>>).map((a) => ({
        id: (a.id ?? a.name ?? '') as string,
        name: (a.name ?? 'Agent') as string,
        emoji: (a.emoji ?? '🤖') as string,
        role: (a.role ?? 'agent') as string,
        type: (a.type ?? 'specialist') as 'super' | 'specialist',
        systemPrompt: (a.systemPrompt ?? a.system_prompt ?? '') as string,
        skills: (Array.isArray(a.skills) ? a.skills : []) as string[],
        modelPreference: (a.modelPreference ?? a.model_preference ?? a.model ?? '') as string,
        providerPreference: (a.providerPreference ?? a.provider_preference ?? a.provider ?? '') as string,
        temperature: (typeof a.temperature === 'number' ? a.temperature : 0.7) as number,
        maxTokens: (typeof a.maxTokens === 'number' ? a.maxTokens : (typeof a.max_tokens === 'number' ? a.max_tokens : 8192)) as number,
        status: (a.status ?? 'active') as Agent['status'],
        color: (a.color ?? '#58A6FF') as string,
        createdAt: (a.createdAt ?? a.created_at ?? new Date().toISOString()) as string,
        updatedAt: (a.updatedAt ?? a.updated_at ?? new Date().toISOString()) as string,
        source: 'hiveclaw' as const,
        isExternal: false,
      })) as Agent[];

      // S8: Fetch external agents and merge
      try {
        const extResp = await apiFetch<{ data: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>('/external-agents');
        const rawExtAgents = Array.isArray(extResp) ? extResp : (extResp as { data: Array<Record<string, unknown>> }).data ?? [];
        const extAgents = rawExtAgents.map((a) => ({
          id: (a.id ?? '') as string,
          name: (a.name ?? 'External Agent') as string,
          emoji: (a.emoji ?? '🌐') as string,
          role: (a.role ?? 'external') as string,
          type: 'specialist' as const,
          systemPrompt: '',
          skills: [] as string[],
          modelPreference: '',
          providerPreference: '__external__',
          temperature: 0.7,
          maxTokens: 4096,
          status: ((a.status as string) === 'active' ? 'active' : 'offline') as Agent['status'],
          color: (a.color ?? '#A855F7') as string,
          createdAt: (a.createdAt ?? a.created_at ?? new Date().toISOString()) as string,
          updatedAt: (a.updatedAt ?? a.updated_at ?? new Date().toISOString()) as string,
          source: 'hiveclaw' as const,
          isExternal: true,
          tier: (a.tier ?? 'lightweight') as string,
        })) as Agent[];
        agents.push(...extAgents);
      } catch {
        // Non-fatal — external agents endpoint may not exist
      }

      set({ agents });
    } catch (e) {
      console.error('fetchAgents error:', e);
    }
  },

  createAgent: async (agentData) => {
    const resp = await apiFetch<{ data: Agent } | Agent>('/agents', {
      method: 'POST',
      body: JSON.stringify(agentData),
    });
    const agent = 'data' in resp ? (resp as { data: Agent }).data : (resp as Agent);
    set((s) => ({ agents: [...s.agents, agent] }));
    return agent;
  },

  updateAgent: async (id, patch) => {
    const resp = await apiFetch<{ data: Agent } | Agent>(`/agents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    const agent = 'data' in resp ? (resp as { data: Agent }).data : (resp as Agent);
    set((s) => ({ agents: s.agents.map((a) => (a.id === id ? agent : a)) }));
    return agent;
  },

  deleteAgent: async (id) => {
    await apiFetch(`/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    set((s) => ({ agents: s.agents.filter((a) => a.id !== id) }));
  },
}));
