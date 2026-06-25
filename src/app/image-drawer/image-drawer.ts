import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';

interface RawImage {
  spec?: {
    source?: {
      http?: { url?: string };
      upload?: object;
      pvcClone?: { sourcePVC?: string };
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
 * ImageDrawer is the resource-aware detail drawer for a SwiftImage, opened from
 * the Explorer's Images kind. It shows the import source (HTTP / upload / PVC
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
      const s = o.spec?.source;
      this.source.set(
        s?.http?.url
          ? 'HTTP: ' + s.http.url
          : s?.pvcClone?.sourcePVC
            ? 'PVC clone: ' + s.pvcClone.sourcePVC
            : s?.upload
              ? 'Upload'
              : '—',
      );
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
