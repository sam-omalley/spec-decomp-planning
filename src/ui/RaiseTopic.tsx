/**
 * "Raise this with someone" (#163) — the bridge *into* the engagement
 * tracker from the plan side.
 *
 * A concern the tool has just computed ("this release is projected past
 * its window") is usually not something you fix by editing the plan; it's
 * something you have to say to a person. This turns one into a topic
 * targeted at whoever you'd say it to, carrying a soft link back to the
 * group it came from.
 *
 * Note this is a view that *writes to the other store* — the one place
 * that happens deliberately. It's a soft `ProjectLink`, never a graph
 * edge: the two stores can't reference each other structurally (see the
 * engagement section of CLAUDE.md).
 *
 * The picker is an inline `<select>` rather than a popover: there is
 * exactly one decision to make (who), and a select needs no new
 * dismissal/focus machinery to get right.
 */

import { useState } from 'react';
import { engagementStore, useWorkspace } from '../engagement/store.ts';
import { addItem, createId } from '../engagement/workspace.ts';
import type { ItemTarget, ProjectLink } from '../engagement/types.ts';

export function RaiseTopic({
  title,
  details,
  link,
}: {
  /** Seeds the item's title — what you'd actually say. */
  title: string;
  /** Seeds its details; the computed explanation behind the concern. */
  details?: string;
  /** Where it came from, when it came from a specific node. */
  link?: ProjectLink | null;
}) {
  const workspace = useWorkspace();
  const [picking, setPicking] = useState(false);
  const [raised, setRaised] = useState(false);

  const people = workspace.people.filter((p) => p.archivedAt === null);
  const targets: { value: string; label: string; target: ItemTarget }[] = [
    ...people.map((p) => ({
      value: `person:${p.id}`,
      label: p.role ? `${p.name} (${p.role})` : p.name,
      target: { kind: 'person' as const, id: p.id },
    })),
    ...workspace.forums.map((f) => ({
      value: `forum:${f.id}`,
      label: `${f.name} (forum)`,
      target: { kind: 'forum' as const, id: f.id },
    })),
  ];

  if (raised) {
    return (
      <span className="agenda-tag" title="Added to the engagement tracker">
        raised ✓
      </span>
    );
  }

  // Nothing to raise it with yet — say so instead of offering an empty
  // picker that silently does nothing.
  if (targets.length === 0) {
    return (
      <button
        className="agenda-row-btn"
        title="Add a stakeholder on the Engagement → People tab first"
        disabled
      >
        Raise…
      </button>
    );
  }

  if (!picking) {
    return (
      <button
        className="agenda-row-btn"
        title="Add this to the engagement tracker as a topic to raise"
        onClick={() => setPicking(true)}
      >
        Raise…
      </button>
    );
  }

  return (
    <select
      className="meta-input raise-picker"
      aria-label="Raise with"
      autoFocus
      defaultValue=""
      onBlur={() => setPicking(false)}
      onChange={(e) => {
        const choice = targets.find((t) => t.value === e.target.value);
        if (!choice) return;
        engagementStore.commit((ws) =>
          addItem(ws, {
            id: createId(),
            title,
            details: details ?? '',
            target: choice.target,
            link: link ?? null,
          }),
        );
        setPicking(false);
        setRaised(true);
      }}
    >
      <option value="" disabled>
        Raise with…
      </option>
      {targets.map((t) => (
        <option key={t.value} value={t.value}>
          {t.label}
        </option>
      ))}
    </select>
  );
}
