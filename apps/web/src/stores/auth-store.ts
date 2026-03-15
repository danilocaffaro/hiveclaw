import { create } from 'zustand';

interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  avatarUrl: string | null;
}

interface AuthState {
  user: AuthUser | null;
  checked: boolean;
  setUser: (user: AuthUser | null) => void;
  setChecked: (v: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  checked: false,
  setUser: (user) => set({ user, checked: true }),
  setChecked: (checked) => set({ checked }),
  logout: () => {
    localStorage.removeItem('hiveclaw-api-key');
    set({ user: null, checked: true });
  },
}));
