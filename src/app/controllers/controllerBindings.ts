import type { BraceletBindings } from '../../features/bracelet/controllers/braceletRuntime';
import type { TryOnRuntime } from '../services/tryOnRuntime';
import type { Mode } from '../../shared/types/tryOn';
export type ApplicationBindings = BraceletBindings & {
  state: {
    current: TryOnRuntime;
  };
  mode: Mode;
  stop: () => void;
  submitLatestCamera: (generation: number) => void;
  setLatency: (n: number) => void;
  setBusy: (v: boolean) => void;
  setSaved: (v: boolean) => void;
  setSource: (v: 'empty' | 'camera' | 'image') => void;
};
