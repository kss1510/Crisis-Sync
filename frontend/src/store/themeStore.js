import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useThemeStore = create(() => ({
  mode: 'light',
  toggle: () => {},
  setMode: () => {},
  applyDomClass: () => {
    document.documentElement.classList.remove('dark');
  },
}));