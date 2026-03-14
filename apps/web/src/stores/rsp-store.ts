'use client';

import { create } from 'zustand';

// ─── RSP (Right-Side Panel) Context Store ─────────────────────────────────────
// Provides scoped context for all right-panel components: which agent/squad/member
// is currently active. Granular selectors prevent re-render cascades across panels.

export interface RSPState {
  /** ID of the active agent (DM or squad member) */
  activeAgentId: string | null;
  /** ID of the active squad (null when in DM mode) */
  activeSquadId: string | null;
  /** ID of selected member within a squad (for per-member view) */
  selectedMemberId: string | null;

  // ── Actions ──
  setActiveAgent: (agentId: string | null) => void;
  setActiveSquad: (squadId: string | null) => void;
  setSelectedMember: (memberId: string | null) => void;

  /** Set DM context — clears squad/member */
  enterDM: (agentId: string) => void;
  /** Set squad context — selects first member by default */
  enterSquad: (squadId: string, firstMemberId?: string) => void;
  /** Clear all context */
  reset: () => void;
}

export const useRSPStore = create<RSPState>((set) => ({
  activeAgentId: null,
  activeSquadId: null,
  selectedMemberId: null,

  setActiveAgent: (agentId) => set({ activeAgentId: agentId }),
  setActiveSquad: (squadId) => set({ activeSquadId: squadId }),
  setSelectedMember: (memberId) => set({ selectedMemberId: memberId }),

  enterDM: (agentId) =>
    set({
      activeAgentId: agentId,
      activeSquadId: null,
      selectedMemberId: null,
    }),

  enterSquad: (squadId, firstMemberId) =>
    set({
      activeSquadId: squadId,
      activeAgentId: firstMemberId ?? null,
      selectedMemberId: firstMemberId ?? null,
    }),

  reset: () =>
    set({
      activeAgentId: null,
      activeSquadId: null,
      selectedMemberId: null,
    }),
}));

// ── Granular selectors (minimize re-renders) ──────────────────────────────────
export const selectActiveAgentId = (s: RSPState) => s.activeAgentId;
export const selectActiveSquadId = (s: RSPState) => s.activeSquadId;
export const selectSelectedMemberId = (s: RSPState) => s.selectedMemberId;
export const selectIsSquadMode = (s: RSPState) => s.activeSquadId !== null;
