'use client';

import { useMemo, type ReactNode } from 'react';
import { ThemeProvider, createTheme, type PaletteMode } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { useUIStore } from '@/stores/ui-store';

/* ══════════════════════════════════════════════════════════════════════════════
   MUI Theme — Scope A (Theme Only)
   
   Maps our existing CSS variable palette to MUI's theme system.
   Dark mode is default. Each HiveClaw color theme maps to MUI palette overrides.
   Existing inline styles continue to work via CSS variables — this adds MUI's
   ThemeProvider + CssBaseline so any future MUI components inherit the right colors.
   ══════════════════════════════════════════════════════════════════════════════ */

// Resolve palette mode from our theme names
function resolveMode(theme: string): PaletteMode {
  if (theme === 'light') return 'light';
  if (theme === 'system') {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  }
  return 'dark'; // dark, midnight, forest, rose, honey
}

// Color palettes per theme — these mirror globals.css exactly
const THEME_PALETTES: Record<string, {
  bg: string; surface: string; border: string;
  text: string; textSecondary: string; textMuted: string;
  primary: string; accent: string; error: string;
  success: string; warning: string; info: string;
}> = {
  dark: {
    bg: '#0D1117', surface: '#161B22', border: '#30363D',
    text: '#E6EDF3', textSecondary: '#8B949E', textMuted: '#484F58',
    primary: '#E6EDF3', accent: '#F59E0B', error: '#F85149',
    success: '#3FB950', warning: '#D29922', info: '#58A6FF',
  },
  light: {
    bg: '#FFFFFF', surface: '#F6F8FA', border: '#D0D7DE',
    text: '#1F2328', textSecondary: '#656D76', textMuted: '#8C959F',
    primary: '#1F2328', accent: '#D97706', error: '#CF222E',
    success: '#1A7F37', warning: '#9A6700', info: '#0969DA',
  },
  midnight: {
    bg: '#0C111B', surface: '#141926', border: '#232B3D',
    text: '#ECF0F6', textSecondary: '#8B95A9', textMuted: '#4A5567',
    primary: '#E2E8F0', accent: '#6C8EEF', error: '#F87171',
    success: '#34D399', warning: '#FBBF24', info: '#6C8EEF',
  },
  forest: {
    bg: '#0C1210', surface: '#141E1A', border: '#22332B',
    text: '#E8F5EF', textSecondary: '#7BA692', textMuted: '#3D5A4C',
    primary: '#E8F5EF', accent: '#34D399', error: '#FB7185',
    success: '#34D399', warning: '#FBBF24', info: '#38BDF8',
  },
  rose: {
    bg: '#110C10', surface: '#1C1519', border: '#33242D',
    text: '#F5EDF1', textSecondary: '#B88DA2', textMuted: '#6B4A5B',
    primary: '#F5EDF1', accent: '#F472B6', error: '#FCA5A5',
    success: '#6EE7B7', warning: '#FDE68A', info: '#7DD3FC',
  },
  honey: {
    bg: '#11100B', surface: '#1B1812', border: '#302A1E',
    text: '#F5F1E6', textSecondary: '#B09B6F', textMuted: '#6B5D3F',
    primary: '#F5F1E6', accent: '#F59E0B', error: '#FB7185',
    success: '#34D399', warning: '#FBBF24', info: '#38BDF8',
  },
};

function buildTheme(themeName: string) {
  const mode = resolveMode(themeName);
  const pal = THEME_PALETTES[themeName] ?? THEME_PALETTES['dark'];

  return createTheme({
    palette: {
      mode,
      background: {
        default: pal.bg,
        paper: pal.surface,
      },
      primary: {
        main: pal.accent,
      },
      secondary: {
        main: pal.info,
      },
      error: {
        main: pal.error,
      },
      success: {
        main: pal.success,
      },
      warning: {
        main: pal.warning,
      },
      info: {
        main: pal.info,
      },
      text: {
        primary: pal.text,
        secondary: pal.textSecondary,
        disabled: pal.textMuted,
      },
      divider: pal.border,
      action: {
        hover: `${pal.accent}14`, // 8% opacity
        selected: `${pal.accent}1F`, // 12% opacity
        focus: `${pal.accent}1F`,
      },
    },
    typography: {
      fontFamily: 'var(--font-sans), Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: 13, // compact density
      h1: { fontSize: '1.75rem', fontWeight: 700 },
      h2: { fontSize: '1.4rem', fontWeight: 600 },
      h3: { fontSize: '1.15rem', fontWeight: 600 },
      body1: { fontSize: '0.875rem' },
      body2: { fontSize: '0.8125rem' },
      button: { textTransform: 'none' as const, fontWeight: 500 },
    },
    shape: {
      borderRadius: 8,
    },
    spacing: 8,
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          // Don't let MUI reset override our globals.css
          body: {
            backgroundColor: 'var(--bg)',
            color: 'var(--text)',
          },
        },
      },
      MuiButton: {
        defaultProps: {
          disableElevation: true,
          size: 'small',
        },
        styleOverrides: {
          root: {
            borderRadius: 8,
            fontSize: 13,
            padding: '6px 16px',
          },
        },
      },
      MuiTextField: {
        defaultProps: {
          size: 'small',
          variant: 'outlined',
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 14,
            backgroundImage: 'none',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            borderRadius: 10,
          },
        },
      },
      MuiTooltip: {
        defaultProps: {
          arrow: true,
        },
        styleOverrides: {
          tooltip: {
            fontSize: 12,
            borderRadius: 6,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none', // Remove MUI's default gradient overlay on dark mode
          },
        },
      },
    },
  });
}

export function MuiThemeProvider({ children }: { children: ReactNode }) {
  const themeName = useUIStore((s) => s.theme);

  const muiTheme = useMemo(() => buildTheme(themeName), [themeName]);

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline enableColorScheme />
      {children}
    </ThemeProvider>
  );
}
