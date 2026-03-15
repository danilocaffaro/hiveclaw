import { create } from 'zustand';

export type RightPanelTab = 'code' | 'preview' | 'browser' | 'sprint' | 'flows' | 'console' | 'memory';
export type SidebarTab = 'sessions' | 'agents' | 'squads';
export type SettingsTab =
  | 'general'
  | 'appearance'
  | 'providers'
  | 'models'
  | 'agents'
  | 'gateways'
  | 'mcp'
  | 'skills'
  | 'keybindings'
  | 'security'
  | 'users'
  | 'data-storage'
  | 'integrations'
  | 'vault'
  | 'advanced'
  | 'deploys';
export type InterfaceMode = 'lite' | 'pro';
export type MobileScreen = 'conversations' | 'chat';

export interface UIState {
  sidebarCollapsed: boolean;
  sidebarTab: SidebarTab;
  rightPanelCollapsed: boolean;
  rightPanelTab: RightPanelTab;
  commandPaletteOpen: boolean;
  theme: 'dark' | 'light' | 'system';

  // Mobile overlay state
  mobileSidebarOpen: boolean;
  mobileRightPanelOpen: boolean;
  mobileScreen: MobileScreen;

  // Settings
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  selectedModel: string;

  // Interface mode (lite = chat only, pro = full dashboard)
  interfaceMode: InterfaceMode;

  // Main view (B056)
  mainView: 'chat' | 'backlog';
  setMainView: (v: 'chat' | 'backlog') => void;

  setSidebarCollapsed: (v: boolean) => void;
  toggleSidebar: () => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setRightPanelCollapsed: (v: boolean) => void;
  toggleRightPanel: () => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setCommandPaletteOpen: (v: boolean) => void;
  toggleCommandPalette: () => void;
  setTheme: (theme: 'dark' | 'light' | 'system') => void;

  // Mobile actions
  setMobileSidebarOpen: (open: boolean) => void;
  setMobileRightPanelOpen: (open: boolean) => void;
  setMobileScreen: (screen: MobileScreen) => void;

  // Settings actions
  setSettingsOpen: (v: boolean) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  toggleSettings: () => void;
  setSelectedModel: (model: string) => void;

  // Interface mode actions
  setInterfaceMode: (mode: InterfaceMode) => void;
  toggleInterfaceMode: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: false,
  sidebarTab: 'sessions',
  rightPanelCollapsed: false,
  rightPanelTab: 'code',
  commandPaletteOpen: false,
  theme: 'dark',

  // Mobile overlay defaults
  mobileSidebarOpen: false,
  mobileRightPanelOpen: false,
  mobileScreen: 'conversations' as MobileScreen,

  // Settings defaults
  settingsOpen: false,
  settingsTab: 'general',
  selectedModel: '',

  // Interface mode — persisted in localStorage, default: 'lite'
  // On mobile first visit (no localStorage key), force 'lite'
  interfaceMode: (typeof window !== 'undefined'
    ? (localStorage.getItem('hiveclaw-interface-mode') as InterfaceMode) || 'lite'
    : 'lite') as InterfaceMode,

  mainView: 'chat',
  setMainView: (v) => set({ mainView: v }),

  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setRightPanelCollapsed: (v) => set({ rightPanelCollapsed: v }),
  toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  setCommandPaletteOpen: (v) => set({ commandPaletteOpen: v }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setTheme: (theme) => set({ theme }),

  // Mobile actions
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
  setMobileRightPanelOpen: (open) => set({ mobileRightPanelOpen: open }),
  setMobileScreen: (screen) => set({ mobileScreen: screen }),

  // Settings actions
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  setSelectedModel: (model) => set({ selectedModel: model }),

  // Interface mode actions
  setInterfaceMode: (mode) => {
    set({ interfaceMode: mode });
    if (typeof window !== 'undefined') {
      localStorage.setItem('hiveclaw-interface-mode', mode);
    }
  },
  toggleInterfaceMode: () => {
    const current = get().interfaceMode;
    const next = current === 'lite' ? 'pro' : 'lite';
    get().setInterfaceMode(next);
  },
}));

// Expose store for debugging (accessible via window.__UI_STORE__)
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as unknown as Record<string, unknown>).__UI_STORE__ = useUIStore;
}
