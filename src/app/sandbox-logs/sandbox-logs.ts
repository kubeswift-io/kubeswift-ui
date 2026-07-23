import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { GatewayService } from '../gateway.service';

/**
 * SandboxLogs is a read-only xterm view of a SwiftSandbox's captured console
 * log. It opens a raw WebSocket to the gateway's /sandbox-logs exec-tail and
 * streams frames into the terminal (follow). An overlay opened from the sandbox
 * drawer; mirrors Console but has no input side (disableStdin, no onData send).
 */
@Component({
  selector: 'app-sandbox-logs',
  imports: [MatIconModule, MatButtonModule],
  templateUrl: './sandbox-logs.html',
  styleUrl: './sandbox-logs.scss',
})
export class SandboxLogs implements AfterViewInit, OnDestroy {
  private readonly gw = inject(GatewayService);
  readonly cluster = input.required<string>();
  readonly namespace = input.required<string>();
  readonly name = input.required<string>();
  readonly closed = output<void>();
  readonly status = signal<'connecting' | 'open' | 'closed'>('connecting');

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('term');
  private term?: Terminal;
  private fit?: FitAddon;
  private ws?: WebSocket;
  private readonly onResize = () => this.fit?.fit();

  ngAfterViewInit(): void {
    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      convertEol: true,
      disableStdin: true,
      theme: { background: '#1e1e1e' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(this.host().nativeElement);
    fit.fit();
    this.term = term;
    this.fit = fit;
    window.addEventListener('resize', this.onResize);

    const ws = new WebSocket(
      this.gw.sandboxLogsWsUrl(this.cluster(), this.namespace(), this.name()),
    );
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => this.status.set('open');
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') term.write(ev.data);
      else term.write(new Uint8Array(ev.data as ArrayBuffer));
    };
    ws.onclose = () => this.status.set('closed');
    ws.onerror = () => this.status.set('closed');
    this.ws = ws;
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.ws?.close();
    this.term?.dispose();
  }
}
