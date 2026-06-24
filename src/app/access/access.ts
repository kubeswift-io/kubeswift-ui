import { Component, OnInit, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import type { Capability, Role, Assignment } from '../gen/kubeswift/v1/access_pb';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';

/**
 * Access is the RBAC editor (decision A2). It assigns the predefined or custom
 * KubeSwift roles to OIDC users/groups — cluster-wide or per namespace — and
 * builds custom roles from the capability catalogue. Every call runs as the
 * signed-in user, so the gateway/k8s RBAC gates who may actually edit access; a
 * permission denial surfaces in the error banner, never silently.
 */
@Component({
  selector: 'app-access',
  imports: [MatIconModule],
  templateUrl: './access.html',
  styleUrl: './access.scss',
})
export class Access implements OnInit {
  private readonly gw = inject(GatewayService);

  readonly clusters = signal<Cluster[]>([]);
  readonly selectedCluster = signal<string>('');
  readonly capabilities = signal<Capability[]>([]);
  readonly roles = signal<Role[]>([]);
  readonly assignments = signal<Assignment[]>([]);
  readonly namespaces = signal<string[]>([]);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  // Assign form.
  readonly aSubjectKind = signal<'User' | 'Group'>('User');
  readonly aSubjectName = signal('');
  readonly aRole = signal('');
  readonly aNamespace = signal(''); // '' = cluster-wide

  // Create-custom-role form.
  readonly showCreate = signal(false);
  readonly newRoleName = signal('');
  readonly newRoleDisplay = signal('');
  readonly newRoleCaps = signal<Set<string>>(new Set());

  async ngOnInit(): Promise<void> {
    try {
      const [cl, caps] = await Promise.all([
        this.gw.clusters.listClusters({}),
        this.gw.access.listCapabilities({}),
      ]);
      this.clusters.set(cl.clusters);
      this.capabilities.set(caps.capabilities);
      const first = cl.clusters.find((c) => c.ready)?.name ?? cl.clusters[0]?.name ?? '';
      this.selectedCluster.set(first);
      if (first) await this.refresh();
    } catch (e) {
      this.error.set(this.msg(e));
    }
  }

  async selectCluster(name: string): Promise<void> {
    this.selectedCluster.set(name);
    this.aRole.set('');
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster) return;
    this.error.set(null);
    try {
      const [roles, asg] = await Promise.all([
        this.gw.access.listRoles({ cluster }),
        this.gw.access.listAssignments({ cluster }),
      ]);
      this.roles.set(roles.roles);
      this.assignments.set(asg.assignments);
      const err = roles.error ?? asg.error;
      if (err) this.error.set(`${err.cluster}: ${err.message}`);
      if (!this.aRole() && roles.roles.length) this.aRole.set(roles.roles[0].name);
    } catch (e) {
      this.error.set(this.msg(e));
    }
    // Namespaces for the scope picker — best-effort (needs view-resources).
    try {
      const ns = await this.gw.resources.listResources({ cluster, kind: 'namespaces' });
      this.namespaces.set(
        ns.resources
          .map((r) => r.ref?.name ?? '')
          .filter(Boolean)
          .sort(),
      );
    } catch {
      this.namespaces.set([]);
    }
  }

  capName(key: string): string {
    return this.capabilities().find((c) => c.key === key)?.displayName ?? key;
  }

  async assign(): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster || !this.aSubjectName().trim() || !this.aRole()) return;
    await this.run(() =>
      this.gw.access.assignRole({
        cluster,
        subject: { kind: this.aSubjectKind(), name: this.aSubjectName().trim() },
        role: this.aRole(),
        namespace: this.aNamespace(),
      }),
    );
    this.aSubjectName.set('');
  }

  async remove(a: Assignment): Promise<void> {
    await this.run(() =>
      this.gw.access.removeAssignment({
        cluster: this.selectedCluster(),
        bindingName: a.bindingName,
        namespace: a.namespace,
      }),
    );
  }

  toggleCap(key: string): void {
    const s = new Set(this.newRoleCaps());
    if (s.has(key)) s.delete(key);
    else s.add(key);
    this.newRoleCaps.set(s);
  }

  async createRole(): Promise<void> {
    const cluster = this.selectedCluster();
    const name = this.newRoleName().trim();
    if (!cluster || !name || this.newRoleCaps().size === 0) return;
    await this.run(() =>
      this.gw.access.createRole({
        cluster,
        name,
        displayName: this.newRoleDisplay().trim() || name,
        capabilities: [...this.newRoleCaps()],
      }),
    );
    this.newRoleName.set('');
    this.newRoleDisplay.set('');
    this.newRoleCaps.set(new Set());
    this.showCreate.set(false);
  }

  async deleteRole(r: Role): Promise<void> {
    if (r.predefined) return;
    await this.run(() =>
      this.gw.access.deleteRole({ cluster: this.selectedCluster(), name: r.name }),
    );
  }

  // run executes a mutating call, then refreshes; errors surface in the banner.
  private async run(fn: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
      await this.refresh();
    } catch (e) {
      this.error.set(this.msg(e));
    } finally {
      this.busy.set(false);
    }
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
