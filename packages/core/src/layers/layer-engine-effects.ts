import { GISRuntimeError } from '../errors.js';

export interface LayerEngineEffect {
  apply(): void;
  rollback(): void;
}

export function applyEngineEffects(effects: readonly LayerEngineEffect[], stage: string): void {
  const attempted: LayerEngineEffect[] = [];
  try {
    for (const effect of effects) {
      attempted.push(effect);
      effect.apply();
    }
  } catch (cause) {
    const cleanupErrors: unknown[] = [];
    for (const effect of attempted.reverse()) {
      try {
        effect.rollback();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length) {
      throw new GISRuntimeError({
        code: 'APP_INVALID_STATE',
        message: 'Could not restore the previous layer state.',
        stage,
        cause,
        cleanupErrors,
      });
    }
    throw cause;
  }
}
