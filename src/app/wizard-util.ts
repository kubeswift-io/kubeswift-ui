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
): Promise<string[]> {
  if (!cluster) return [];
  try {
    const r = await gw.resources.listResources({ cluster, kind });
    return r.resources
      .map((x) => x.ref?.name ?? '')
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}
