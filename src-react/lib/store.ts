/**
 * Zustand store — client-side state for Agenstrix.
 * Manages: skeleton worker, self-test warnings, fullscreen state.
 */
import { create } from "zustand";
import type { SelfTestWarning } from "../../src-bun/system/selftest";

// Re-export for use in components
export type { SelfTestWarning };

interface AppState {
  skeletonWorkerId: string | null;
  skeletonPid: number | null;
  skeletonStartedAt: number | null;
  cwd: string;
  selfTestWarnings: SelfTestWarning[];
  fullscreenWorkerId: string | null;

  setSkeletonWorker: (id: string, pid?: number, startedAt?: number) => void;
  setCwd: (cwd: string) => void;
  setSelfTestWarnings: (warnings: SelfTestWarning[]) => void;
  toggleFullscreen: (workerId: string) => void;
  clearFullscreen: () => void;
}

export const useStore = create<AppState>((set) => ({
  skeletonWorkerId: null,
  skeletonPid: null,
  skeletonStartedAt: null,
  cwd: "",
  selfTestWarnings: [],
  fullscreenWorkerId: null,

  setSkeletonWorker: (id, pid, startedAt) =>
    set({
      skeletonWorkerId: id,
      skeletonPid: pid ?? null,
      skeletonStartedAt: startedAt ?? Date.now(),
    }),

  setCwd: (cwd) => set({ cwd }),

  setSelfTestWarnings: (warnings) => set({ selfTestWarnings: warnings }),

  toggleFullscreen: (workerId) =>
    set((state) => ({
      fullscreenWorkerId: state.fullscreenWorkerId === workerId ? null : workerId,
    })),

  clearFullscreen: () => set({ fullscreenWorkerId: null }),
}));
