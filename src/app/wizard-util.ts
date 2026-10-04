import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { GatewayService } from './gateway.service';

/** NameList is a picker's names, and why it could not list them, if it couldn't. */
export interface NameList {
  names: string[];
  error: string;
}

/**
 * listNamesReport fetches the names of a kind on a cluster for a picker
 * dropdown, as the signed-in user, and reports a failure instead of hiding it:
 * the gateway reports a list it could not make (no RBAC, kind absent) in-band,
 * and an empty dropdown with no word on why reads as "there are none".
 */
export async function listNamesReport(
  gw: GatewayService,
  cluster: string,
  kind: string,
  namespace = '',
): Promise<NameList> {
  if (!cluster) return { names: [], error: '' };
  try {
    const r = await gw.resources.listResources({ cluster, kind, namespace });
    return {
      names: r.resources
        .map((x) => x.ref?.name ?? '')
        .filter(Boolean)
        .sort(),
      error: r.error?.message ?? '',
    };
  } catch (e) {
    return { names: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * listNames is listNamesReport's names only, for a picker whose failure the
 * form does not report.
 */
export async function listNames(
  gw: GatewayService,
  cluster: string,
  kind: string,
  namespace = '',
): Promise<string[]> {
  return (await listNamesReport(gw, cluster, kind, namespace)).names;
}

/**
 * pickerErrors formats the lists that failed, by label ("GPU profiles: …"),
 * for a warning banner; null when all listed.
 */
export function pickerErrors(lists: Record<string, NameList>): string | null {
  const failed = Object.entries(lists)
    .filter(([, l]) => l.error)
    .map(([label, l]) => `${label}: ${l.error}`);
  return failed.length ? 'Could not list ' + failed.join('; ') : null;
}

/**
 * keepIfListed keeps a selection that is still offered and clears one that is
 * not: after a namespace change, a name picked in the old namespace would make
 * the object reference something its own namespace does not have.
 */
export function keepIfListed(value: string, list: string[]): string {
  return !value || list.includes(value) ? value : '';
}

/** toYaml serializes an object to YAML for the Form→YAML toggle. */
export function toYaml(obj: unknown): string {
  return stringifyYaml(obj, { sortMapEntries: false });
}

/** fromYaml parses YAML (or JSON — a subset) back to an object; throws on bad input. */
export function fromYaml(text: string): Record<string, unknown> {
  return (parseYaml(text) ?? {}) as Record<string, unknown>;
}

/** deepClone via structuredClone (objects here are plain JSON-shaped). */
export function deepClone<T>(o: T): T {
  return structuredClone(o);
}

/**
 * listGuestNames lists the SwiftGuests in one namespace of one cluster.
 * SwiftGuests have their own view rather than a catalog entry, so they are
 * listed through GuestService, not the generic resource list.
 */
export async function listGuestNames(
  gw: GatewayService,
  cluster: string,
  namespace: string,
): Promise<NameList> {
  if (!cluster) return { names: [], error: '' };
  try {
    const r = await gw.guests.listGuests({ clusters: { clusters: [cluster] }, namespace });
    return {
      names: r.guests
        .map((g) => g.ref?.name ?? '')
        .filter(Boolean)
        .sort(),
      error: r.errors.map((e) => e.message).join('; '),
    };
  } catch (e) {
    return { names: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** SnapshotClassList is a cluster's VolumeSnapshotClasses and which are marked default. */
export interface SnapshotClassList extends NameList {
  defaults: string[];
}

/**
 * listSnapshotClasses lists the cluster's VolumeSnapshotClasses for a CSI
 * snapshot picker. defaults are those marked as the cluster default (one per
 * CSI driver); with none, a snapshot that names no class and gets none from a
 * storage location fails at once (NoVolumeSnapshotClass).
 */
export async function listSnapshotClasses(
  gw: GatewayService,
  cluster: string,
): Promise<SnapshotClassList> {
  if (!cluster) return { names: [], defaults: [], error: '' };
  try {
    const r = await gw.resources.listResources({ cluster, kind: 'volumesnapshotclasses' });
    const names: string[] = [];
    const defaults: string[] = [];
    for (const x of r.resources) {
      const n = x.ref?.name ?? '';
      if (!n) continue;
      names.push(n);
      if (x.columns['default'] === 'true') defaults.push(n);
    }
    return { names: names.sort(), defaults: defaults.sort(), error: r.error?.message ?? '' };
  } catch (e) {
    return { names: [], defaults: [], error: e instanceof Error ? e.message : String(e) };
  }
}
