import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { GatewayService } from './gateway.service';

/**
 * listNames fetches the names of a kind on a cluster for a picker dropdown, as
 * the signed-in user. Returns [] on any error (a picker that can't load just
 * shows empty). Shared by the guided create wizards.
 */
export async function listNames(
  gw: GatewayService,
  cluster: string,
  kind: string,
  namespace = '',
): Promise<string[]> {
  if (!cluster) return [];
  try {
    const r = await gw.resources.listResources({ cluster, kind, namespace });
    return r.resources
      .map((x) => x.ref?.name ?? '')
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
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
