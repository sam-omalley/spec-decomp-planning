/**
 * Shared commit-with-error-banner helper for the Engagement views (#163).
 *
 * The workspace mutations throw `EngagementError` on invalid input, and a
 * throwing commit propagates — which in a view means the click silently
 * does nothing. Every engagement view therefore wraps its commits the same
 * way: run it, surface the message if it's an expected domain error, let
 * anything else through as a real bug.
 *
 * `coalesce` collapses a run of keystrokes into one undo step, exactly as
 * on the graph side.
 */

import { useState } from 'react';
import { engagementStore } from '../engagement/store.ts';
import { EngagementError } from '../engagement/workspace.ts';
import type { Workspace } from '../engagement/types.ts';

export interface EngagementRun {
  /** Commits a mutation; returns false (and shows the banner) if it was
   *  rejected, so callers can skip clearing a form on failure. */
  run: (mutate: (ws: Workspace) => Workspace, coalesce?: string) => boolean;
  error: string | null;
  dismiss: () => void;
}

export function useEngagementRun(): EngagementRun {
  const [error, setError] = useState<string | null>(null);
  return {
    run(mutate, coalesce) {
      try {
        engagementStore.commit(mutate, coalesce ? { coalesce } : undefined);
        setError(null);
        return true;
      } catch (e) {
        if (e instanceof EngagementError) {
          setError(e.message);
          return false;
        }
        throw e;
      }
    },
    error,
    dismiss: () => setError(null),
  };
}
