import { TestBed } from '@angular/core/testing';
import { GatewayService } from '../gateway.service';
import { RestoreDialog } from './restore-dialog';

type Obj = Record<string, any>;

/** open renders the dialog for a snapshot and returns it with what a save sends. */
function open(inputs: Record<string, unknown>): { d: RestoreDialog; sent: () => Obj | undefined } {
  let sent: Obj | undefined;
  const gw = {
    clusters: { listNodes: async () => ({ nodes: [{ name: 'node-a' }, { name: 'node-b' }] }) },
    resources: {
      applyResource: async (req: { yaml: string }) => {
        sent = JSON.parse(req.yaml);
        return {};
      },
    },
  };
  TestBed.configureTestingModule({
    imports: [RestoreDialog],
    providers: [{ provide: GatewayService, useValue: gw }],
  });
  const f = TestBed.createComponent(RestoreDialog);
  f.componentRef.setInput('cluster', 'c1');
  f.componentRef.setInput('namespace', 'team-a');
  f.componentRef.setInput('snapshot', 'snap1');
  f.componentRef.setInput('sourceGuest', 'web');
  for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
  f.detectChanges();
  return { d: f.componentInstance, sent: () => sent };
}

describe('RestoreDialog', () => {
  it('a CSI snapshot restores into a new guest only, with no memory options', async () => {
    const { d, sent } = open({ backend: 'csi-volume-snapshot' });
    expect(d.mode()).toBe('new');
    expect(d.canRestoreInPlace()).toBeFalse();
    expect(d.targetGuest()).toBe('web-clone');
    await d.save();
    const spec = sent()!['spec'];
    expect(spec['targetGuest']).toEqual({ name: 'web-clone', overwriteExisting: false });
    expect(spec['identity']).toBeUndefined();
    expect(spec['resumeAfterRestore']).toBeUndefined();
    expect(spec['targetNode']).toBeUndefined();
  });

  it('a clone of a memory snapshot always regenerates MAC addresses', async () => {
    const { d, sent } = open({ backend: 'local' });
    d.regenOther.set(false);
    await d.save();
    expect(sent()!['spec']['identity']).toEqual({ regenerate: ['macAddresses'] });
    d.regenOther.set(true);
    await d.save();
    expect(sent()!['spec']['identity']).toEqual({
      regenerate: ['hostname', 'machineId', 'sshHostKeys', 'macAddresses'],
    });
  });

  it('an in-place restore of a resumed memory snapshot needs the divergence acknowledged', async () => {
    const { d, sent } = open({ backend: 'local', resumedAfterCapture: true });
    d.setMode('inplace');
    expect(d.targetGuest()).toBe('web');
    expect(d.divergesInPlace()).toBeTrue();
    expect(d.canSave()).toBeFalse();
    d.acceptDivergence.set(true);
    expect(d.canSave()).toBeTrue();
    await d.save();
    const o = sent()!;
    expect(o['metadata']['annotations']).toEqual({ 'snapshot.kubeswift.io/accept-disk-divergence': 'true' });
    expect(o['spec']['targetGuest']).toEqual({ name: 'web', overwriteExisting: true });
    expect(o['spec']['identity']).toBeUndefined();
  });

  it('a full-state snapshot restores in place without a divergence warning', () => {
    const { d } = open({ backend: 'oci', resumedAfterCapture: true, fullState: true });
    d.setMode('inplace');
    expect(d.divergesInPlace()).toBeFalse();
    expect(d.canSave()).toBeTrue(); // in place, the node defaults to the guest's
  });

  it('an s3 or oci restore into a new guest needs a node', async () => {
    const { d, sent } = open({ backend: 's3' });
    expect(d.usesTargetNode()).toBeTrue();
    expect(d.canSave()).toBeFalse();
    d.targetNode.set('node-b');
    expect(d.canSave()).toBeTrue();
    await d.save();
    expect(sent()!['spec']['targetNode']).toBe('node-b');
    expect(sent()!['spec']['resumeAfterRestore']).toBeTrue();
  });

  it('refuses a target named like the snapshot, or the source guest as a new guest', () => {
    const { d } = open({ backend: 'local' });
    d.targetGuest.set('snap1');
    expect(d.targetProblem()).toContain('same name as the snapshot');
    d.targetGuest.set('web');
    expect(d.targetProblem()).toContain('source guest');
    expect(d.canSave()).toBeFalse();
  });
});
