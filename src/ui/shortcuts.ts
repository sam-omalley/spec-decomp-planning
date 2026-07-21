/**
 * Keyboard shortcut reference shown by the `?`-triggered cheatsheet
 * (`ShortcutCheatsheet.tsx`). One place listing what the handlers actually
 * do, keyed off the same navigation state as the app (`route.ts`), so it
 * can't drift out of sync between views.
 */

import type { GraphMode, PlanMode, Section } from './route.ts';

export interface ShortcutEntry {
  keys: string;
  description: string;
}

export interface ShortcutGroup {
  heading: string;
  entries: ShortcutEntry[];
}

const APP_GROUP: ShortcutGroup = {
  heading: 'App',
  entries: [
    { keys: '?', description: 'Open this cheatsheet' },
    { keys: 'Esc', description: 'Close this cheatsheet / clear search' },
    { keys: '⌘/Ctrl Z', description: 'Undo' },
    { keys: '⌘/Ctrl ⇧ Z', description: 'Redo' },
  ],
};

const OUTLINER_GROUP: ShortcutGroup = {
  heading: 'Outliner',
  entries: [
    { keys: 'Enter', description: 'New row after' },
    { keys: '⇧ Enter', description: 'New row before' },
    { keys: '⌘/Ctrl Enter', description: 'Toggle details card' },
    { keys: 'Tab', description: 'Indent' },
    { keys: '⇧ Tab', description: 'Outdent' },
    { keys: '↑ / ↓', description: 'Move to previous / next row' },
    { keys: '⌥ ↑ / ↓', description: 'Reorder among siblings' },
    { keys: '⇧ ↑ / ↓', description: 'Extend selection' },
    { keys: '⇧-click / ⌘-click', description: 'Range / toggle multi-select' },
    { keys: 'Backspace', description: 'Delete row (when empty, or with ⌘/Ctrl)' },
    { keys: '⌘/Ctrl .', description: 'Collapse / expand' },
    { keys: 'Esc', description: 'Close row' },
  ],
};

const DETAILS_CARD_GROUP: ShortcutGroup = {
  heading: 'Details card',
  entries: [
    { keys: 'Enter', description: 'Add key (Keys field) / add first match (Dependency field)' },
    { keys: 'Esc', description: 'Clear query, then close' },
  ],
};

const ASSIGN_GROUP: ShortcutGroup = {
  heading: 'Assign',
  entries: [
    {
      keys: 'a',
      description:
        'Spec row(s) selected: pick a group to assign into. Group row selected: ' +
        'assign the current spec selection into it',
    },
    { keys: '↑ / ↓', description: 'Move through the group picker' },
    { keys: 'Enter', description: 'Confirm the highlighted group' },
    { keys: 'Esc', description: 'Cancel the group picker' },
  ],
};

const TABLE_GROUP: ShortcutGroup = {
  heading: 'Table',
  entries: [
    { keys: '↑ / ↓', description: 'Move focus, same column' },
    { keys: '⇧ ↑ / ↓', description: 'Extend row selection' },
    { keys: '⇧-click / ⌘-click', description: 'Range / toggle row selection' },
  ],
};

const GRAPH_GROUP: ShortcutGroup = {
  heading: 'Graph',
  entries: [{ keys: 'Esc', description: 'Cancel an in-progress arrow drag' }],
};

/** The shortcut groups relevant to the current view. */
export function shortcutsFor(
  section: Section,
  planMode: PlanMode,
  graphMode: GraphMode,
): ShortcutGroup[] {
  const groups: ShortcutGroup[] = [];
  if (section === 'spec') {
    groups.push(OUTLINER_GROUP);
  } else if (section === 'planning' && planMode === 'outline') {
    groups.push(OUTLINER_GROUP, DETAILS_CARD_GROUP, ASSIGN_GROUP);
  } else if (section === 'planning' && planMode === 'table') {
    groups.push(TABLE_GROUP);
  } else if (section === 'graph') {
    void graphMode; // same Escape-cancels-drag shortcut in both Map and Dependency modes
    groups.push(GRAPH_GROUP);
  }
  groups.push(APP_GROUP);
  return groups;
}
