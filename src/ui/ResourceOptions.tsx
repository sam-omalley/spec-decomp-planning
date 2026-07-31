/**
 * The `<option>` list shared by every resource picker (the details card and
 * the plan table's Resource column), so both order and label the roster the
 * same way.
 *
 * People off the team on `on` (#161 — left already, or not started yet) stay
 * selectable but move into their own group with a "left …"/"joins …" label:
 * you still need to be able to say who finished something last quarter, but
 * they shouldn't sit in the middle of the list of people you can hand new
 * work to. Grouping + a text label rather than styling, so the distinction
 * survives in a native select on any platform.
 */

import type { Resource } from '../model/types.ts';
import { isAvailableOn, standingLabel } from '../model/resources.ts';

function label(r: Resource): string {
  return r.name.trim() || 'Unnamed';
}

export function ResourceOptions({ resources, on }: { resources: readonly Resource[]; on: string }) {
  const onTeam = resources.filter((r) => isAvailableOn(r, on));
  const offTeam = resources.filter((r) => !isAvailableOn(r, on));
  const plain = onTeam.map((r) => (
    <option key={r.id} value={r.id}>
      {label(r)}
    </option>
  ));
  if (offTeam.length === 0) return <>{plain}</>;
  return (
    <>
      {onTeam.length > 0 && <optgroup label="On the team">{plain}</optgroup>}
      <optgroup label="Off the team">
        {offTeam.map((r) => (
          <option key={r.id} value={r.id}>
            {label(r)} — {standingLabel(r, on)}
          </option>
        ))}
      </optgroup>
    </>
  );
}
