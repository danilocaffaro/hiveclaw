import { create } from 'zustand';

// Mirrors the Squad type from @hiveclaw/shared
export interface Squad {
  id: string;
  name: string;
  emoji: string;
  description: string;
  agentIds: string[];
  sprintConfig: Record<string, unknown>;
  routingStrategy: 'sequential' | 'debate' | 'specialist' | 'round-robin';
  debateEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SquadCreateInput {
  name: string;
  emoji?: string;
  description?: string;
  agentIds: string[];
  routingStrategy?: 'sequential' | 'debate' | 'specialist' | 'round-robin';
  debateEnabled?: boolean;
  members?: Array<{ agentId: string; nexusRole: string }>;
}

interface SquadStore {
  squads: Squad[];
  setSquads: (squads: Squad[]) => void;
  fetchSquads: () => Promise<void>;
  createSquad: (squad: SquadCreateInput) => Promise<Squad>;
  updateSquad: (id: string, updates: Partial<SquadCreateInput>) => Promise<Squad>;
  deleteSquad: (id: string) => Promise<void>;
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

export const useSquadStore = create<SquadStore>((set) => ({
  squads: [],

  setSquads: (squads) => set({ squads }),

  fetchSquads: async () => {
    try {
      const resp = await apiFetch<{ data: Squad[] } | Squad[]>('/squads');
      const squads = Array.isArray(resp) ? resp : (resp as { data: Squad[] }).data ?? [];
      set({ squads });
    } catch (e) {
      console.error('fetchSquads error:', e);
    }
  },

  createSquad: async (squadData) => {
    const resp = await apiFetch<{ data: Squad } | Squad>('/squads', {
      method: 'POST',
      body: JSON.stringify(squadData),
    });
    const squad = 'data' in resp ? (resp as { data: Squad }).data : (resp as Squad);
    set((s) => ({ squads: [...s.squads, squad] }));
    return squad;
  },

  updateSquad: async (id, updates) => {
    const resp = await apiFetch<{ data: Squad } | Squad>(`/squads/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    const squad = 'data' in resp ? (resp as { data: Squad }).data : (resp as Squad);
    set((s) => ({ squads: s.squads.map((sq) => (sq.id === id ? squad : sq)) }));
    return squad;
  },

  deleteSquad: async (id) => {
    await apiFetch(`/squads/${encodeURIComponent(id)}`, { method: 'DELETE' });
    set((s) => ({ squads: s.squads.filter((sq) => sq.id !== id) }));
  },
}));
