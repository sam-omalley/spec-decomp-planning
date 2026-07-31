/**
 * Renders a forum's agenda as Markdown (#163) — the issue's "for that
 * meeting I should easily be able to get the list of actions to raise",
 * in a form you can paste into the invite, an email, or your own notes.
 *
 * Pure and derived from exactly the same `agendaFor` the Agenda view
 * draws, so the copied text and the screen can never disagree about what's
 * on the agenda. Nothing here is stored.
 */

import type { Workspace } from './types.ts';
import { agendaFor, type AgendaSectionKind } from './agenda.ts';
import { forumStatuses } from './recency.ts';
import { personById } from './workspace.ts';

const SECTION_HEADING: Record<AgendaSectionKind, string> = {
  standing: 'Standing items',
  to_raise: 'To raise',
  chase: 'Chasing them',
  report_back: 'I owe them',
};

/**
 * The agenda for `forumId` on `now` as a Markdown document: an H1 naming
 * the forum and date, a cadence line, then one H2 per non-empty section.
 * Returns a short "nothing outstanding" note rather than an empty string
 * when there is nothing to bring — pasting a blank into an invite is worse
 * than pasting a sentence.
 */
export function agendaMarkdown(workspace: Workspace, forumId: string, now: string): string {
  const forum = workspace.forums.find((f) => f.id === forumId);
  if (!forum) return '';
  const today = now.slice(0, 10);
  const standing = forumStatuses(workspace, today).find((f) => f.forumId === forumId);
  const attendees = forum.attendees
    .map((id) => personById(workspace, id)?.name)
    .filter((name): name is string => name !== undefined);

  const lines: string[] = [`# ${forum.name} — ${today}`, ''];
  if (attendees.length > 0) lines.push(`**Attending:** ${attendees.join(', ')}`, '');
  if (standing) {
    lines.push(
      `_Every ${forum.cadenceDays} days · last held ${standing.lastHeldAt?.slice(0, 10) ?? 'never'}_`,
      '',
    );
  }

  const sections = agendaFor(workspace, forumId, today);
  if (sections.length === 0) {
    lines.push('Nothing outstanding for this forum.');
    return `${lines.join('\n')}\n`;
  }

  for (const section of sections) {
    lines.push(`## ${SECTION_HEADING[section.kind]}`, '');
    for (const entry of section.entries) {
      const parts: string[] = [entry.item.title];
      if (entry.item.ownerId !== null) {
        parts.push(`— ${personById(workspace, entry.item.ownerId)?.name ?? 'Unknown'}`);
      }
      if (entry.note) parts.push(`(${entry.note})`);
      lines.push(`- ${parts.join(' ')}`);
      // Details are the "what I actually want to say" note, so they carry
      // into the paste rather than being left behind on screen.
      for (const line of entry.item.details.split('\n')) {
        if (line.trim() !== '') lines.push(`  ${line}`);
      }
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
