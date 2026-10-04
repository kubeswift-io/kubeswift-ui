import type { GatewayService } from './gateway.service';
import {
  keepIfListed,
  listGuestNames,
  listNamesReport,
  listSnapshotClasses,
  pickerErrors,
} from './wizard-util';

/** gw builds a GatewayService stand-in with only the calls a test needs. */
function gw(parts: Record<string, unknown>): GatewayService {
  return parts as unknown as GatewayService;
}

describe('wizard-util pickers', () => {
  it('keepIfListed keeps an offered selection and clears one the list lacks', () => {
    expect(keepIfListed('a', ['a', 'b'])).toBe('a');
    expect(keepIfListed('gone', ['a', 'b'])).toBe('');
    expect(keepIfListed('', ['a'])).toBe('');
  });

  it('pickerErrors names only the lists that failed', () => {
    expect(pickerErrors({ images: { names: ['x'], error: '' } })).toBeNull();
    expect(
      pickerErrors({
        images: { names: [], error: 'forbidden' },
        kernels: { names: ['k'], error: '' },
        'GPU profiles': { names: [], error: 'no such kind' },
      }),
    ).toBe('Could not list images: forbidden; GPU profiles: no such kind');
  });

  it('listNamesReport reports the gateway in-band error instead of hiding it', async () => {
    let asked: unknown;
    const g = gw({
      resources: {
        listResources: async (req: unknown) => {
          asked = req;
          return { resources: [{ ref: { name: 'b' } }, { ref: { name: 'a' } }], error: { message: 'partial' } };
        },
      },
    });
    const l = await listNamesReport(g, 'c1', 'swiftimages', 'team-a');
    expect(asked).toEqual({ cluster: 'c1', kind: 'swiftimages', namespace: 'team-a' });
    expect(l).toEqual({ names: ['a', 'b'], error: 'partial' });
  });

  it('listNamesReport turns a thrown call into an error, not an empty success', async () => {
    const g = gw({ resources: { listResources: async () => Promise.reject(new Error('permission denied')) } });
    expect(await listNamesReport(g, 'c1', 'swiftimages')).toEqual({ names: [], error: 'permission denied' });
  });

  it('listGuestNames asks GuestService for one cluster and namespace', async () => {
    let asked: unknown;
    const g = gw({
      guests: {
        listGuests: async (req: unknown) => {
          asked = req;
          return { guests: [{ ref: { name: 'web' } }], errors: [] };
        },
      },
    });
    expect(await listGuestNames(g, 'c1', 'team-a')).toEqual({ names: ['web'], error: '' });
    expect(asked).toEqual({ clusters: { clusters: ['c1'] }, namespace: 'team-a' });
  });

  it('listSnapshotClasses marks the cluster default classes', async () => {
    const g = gw({
      resources: {
        listResources: async () => ({
          resources: [
            { ref: { name: 'slow' }, columns: { default: 'false' } },
            { ref: { name: 'fast' }, columns: { default: 'true' } },
          ],
        }),
      },
    });
    expect(await listSnapshotClasses(g, 'c1')).toEqual({ names: ['fast', 'slow'], defaults: ['fast'], error: '' });
  });
});
