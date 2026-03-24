'use client';

import { create } from 'zustand';
import { useSessionStore } from './session-store';

// ─── RSP (Right-Side Panel) Context Store ─────────────────────────────────────
// S1+S2+X4 refactor: activeAgentId and activeSquadId are now DERIVED from
// session-store (single source of truth). Only selectedMemberId is local state.
//
// The public API (enterDM, enterSquad, selectors) is preserved so all consumers
// (RightPanel, AgentTabBar, CodePanel, SprintPanel, etc.) keep working unchanged.

export interface RSPState {
  /** Selected member within a squad (local UI state) */
  selectedMemberId: string | null;

  /** @deprecated — derived from session-store, kept for selector compatibility */
  activeAgentId: string | null;
  /** @deprecated — derived from session-store, kept for selector compatibility */
  activeSquadId: string | null;

  // ── Actions ──
  setActiveAgent: (agentId: string | null) => void;
  setActiveSquad: (squadId: string | null) => void;
  setSelectedMember: (memberId: string | null) => void;

  /** Set DM context — delegates to session-store */
  enterDM: (agentId: string) => void;
  /** Set squad context — delegates to session-store */
  enterSquad: (squadId: string, firstMemberId?: string) => void;
  /** Clear selected member */
  reset: () => void;
}

// Internal helper: sync derived fields from session-store into RSP for selector compatibility
function derivedFromSession(): { activeAgentId: string | null; activeSquadId: string | null } {
  const { activeSessionId, sessions, activeSquadId } = useSessionStore.getState();
  let agentId: string | null = null;
  if (activeSessionId) {
    const session = sessions.find((s) => s.id === activeSessionId);
    agentId = session?.agent_id ?? null;
  }
  return { activeAgentId: agentId, activeSquadId };
}

export const useRSPStore = create<RSPState>((set) => ({
  activeAgentId: null,
  activeSquadId: null,
  selectedMemberId: null,

  setActiveAgent: (_agentId) => set({ ...derivedFromSession() }),
  setActiveSquad: (_squadId) => set({ ...derivedFromSession() }),
  setSelectedMember: (memberId) => set({ selectedMemberId: memberId }),

  enterDM: (_agentId) =>
    set({ selectedMemberId: null, ...derivedFromSession() }),

  enterSquad: (_squadId, firstMemberId) =>
    set({ selectedMemberId: firstMemberId ?? null, ...derivedFromSession() }),

  reset: () =>
    set({ selectedMemberId: null, activeAgentId: null, activeSquadId: null }),
}));

// Keep RSP in sync when session-store changes (single subscription, minimal overhead)
useSessionStore.subscribe((state, prev) => {
  if (state.activeSessionId !== prev.activeSessionId || state.activeSquadId !== prev.activeSquadId) {
    useRSPStore.setState(derivedFromSession());
  }
});

// ── Granular selectors (same signature as before — consumers don't change) ────
export const selectActiveAgentId = (s: RSPState) => s.activeAgentId;
export const selectActiveSquadId = (s: RSPState) => s.activeSquadId;
export const selectSelectedMemberId = (s: RSPState) => s.selectedMemberId;
export const selectIsSquadMode = (s: RSPState) => s.activeSquadId !== null;
