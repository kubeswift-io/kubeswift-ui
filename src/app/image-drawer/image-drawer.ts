import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';

interface RawImage {
  spec?: {
    source?: {
      http?: { url?: string };
      pvcClone?: { name?: string; namespace?: string };
      oci?: {
        repository?: string;
        tag?: string;
        digest?: string;
        insecure?: boolean;
        credentialsSecretRef?: { name?: string };
        verifyKeySecretRef?: { name?: string };
      };
    };
    format?: string;
    cloneStrategy?: string;
  };
  status?: {
    phase?: string;
    sourceFormat?: string;
    preparedFormat?: string;
    sizeHint?: number;
  };
}

/**
 * describeSource says where an image is imported from: an HTTP URL, an OCI
 * artifact (repository:tag, or @digest when pinned, with how it is pulled), or
 * a PVC clone (namespace/name; the image's own namespace when none is set).
 */
export function describeSource(s: NonNullable<RawImage['spec']>['source'], imageNamespace: string): string {
  if (s?.http?.url) return 'HTTP: ' + s.http.url;
  if (s?.oci?.repository) {
    const o = s.oci;
    const ref = o.digest
      ? `${o.repository}@${o.digest}`
      : o.tag
        ? `${o.repository}:${o.tag}`
        : `${o.repository} (no tag or digest: the import cannot pull it)`;
    const how: string[] = [];
    if (o.verifyKeySecretRef?.name) how.push('signature verified with ' + o.verifyKeySecretRef.name);
    if (o.credentialsSecretRef?.name) how.push('credentials ' + o.credentialsSecretRef.name);
    if (o.insecure) how.push('plain HTTP');
    return 'OCI: ' + ref + (how.length ? ' (' + how.join(', ') + ')' : '');
  }
  if (s?.pvcClone?.name) return 'PVC clone: ' + (s.pvcClone.namespace || imageNamespace) + '/' + s.pvcClone.name;
  return '—';
}

/**
 * ImageDrawer is the resource-aware detail drawer for a SwiftImage, opened from
 * the Explorer's Images kind. It shows the import source (HTTP / OCI / PVC
 * clone), format, clone strategy, and the import status (phase, prepared format,
 * size). Read-only; create/import an image with the Explorer's New button.
 */
@Component({
  selector: 'app-image-drawer',
  imports: [MatIconModule],
  templateUrl: './image-drawer.html',
  styleUrl: './image-drawer.scss',
})
export class ImageDrawer implements OnInit {
  private readonly gw = inject(GatewayService);
  readonly cluster = input.required<string>();
  readonly namespace = input.required<string>();
  readonly name = input.required<string>();
  readonly closed = output<void>();

  readonly source = signal('');
  readonly format = signal('');
  readonly cloneStrategy = signal('');
  readonly phase = signal('');
  readonly sourceFormat = signal('');
  readonly preparedFormat = signal('');
  readonly size = signal(0);
  readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const r = await this.gw.resources.getResource({
        cluster: this.cluster(),
        kind: 'swiftimages',
        namespace: this.namespace(),
        name: this.name(),
      });
      const o = JSON.parse(r.json) as RawImage;
      this.source.set(describeSource(o.spec?.source, this.namespace()));
      this.format.set(o.spec?.format ?? '');
      this.cloneStrategy.set(o.spec?.cloneStrategy ?? '');
      this.phase.set(o.status?.phase ?? '');
      this.sourceFormat.set(o.status?.sourceFormat ?? '');
      this.preparedFormat.set(o.status?.preparedFormat ?? '');
      this.size.set(o.status?.sizeHint ?? 0);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  humanBytes(b: number): string {
    if (!b) return '—';
    const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let i = 0;
    let v = b;
    while (v >= 1024 && i < u.length - 1) {
      v /= 1024;
      i++;
    }
    return v.toFixed(i ? 1 : 0) + ' ' + u[i];
  }
}
