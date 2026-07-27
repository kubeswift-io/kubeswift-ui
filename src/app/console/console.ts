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
import type { ObjectRef } from '../gen/kubeswift/v1/common_pb';
import { GatewayService } from '../gateway.service';

/**
 * Console is the xterm.js serial terminal for one VM. It opens a raw WebSocket
 * to the gateway's /console exec-pipe (D5 bootstrap) and wires it both ways:
 * keystrokes → ws.send, ws binary frames → term.write. It is an overlay opened
 * from the detail drawer.
 */
@Component({
  selector: 'app-console',
  imports: [MatIconModule, MatButtonModule],
  templateUrl: './console.html',
  styleUrl: './console.scss',
})
export class Console implements AfterViewInit, OnDestroy {
  private readonly gw = inject(GatewayService);
  readonly ref = input.required<ObjectRef>();
  readonly closed = output<void>();
  readonly status = signal<'connecting' | 'open' | 'closed'>('connecting');

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('term');
  private term?: Terminal;
  private fit?: FitAddon;
  private ws?: WebSocket;
  private readonly onResize = () => this.fit?.fit();

  ngAfterViewInit(): void {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      convertEol: true,
      theme: { background: '#1e1e1e' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(this.host().nativeElement);
    fit.fit();
    this.term = term;
    this.fit = fit;
    window.addEventListener('resize', this.onResize);

    const r = this.ref();
    const t = this.gw.consoleWs(r.cluster, r.namespace, r.name);
    const ws = new WebSocket(t.url, t.protocols);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.status.set('open');
      term.focus();
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') term.write(ev.data);
      else term.write(new Uint8Array(ev.data as ArrayBuffer));
    };
    ws.onclose = () => this.status.set('closed');
    ws.onerror = () => this.status.set('closed');
    term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(d);
    });
    this.ws = ws;
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.ws?.close();
    this.term?.dispose();
  }
}
