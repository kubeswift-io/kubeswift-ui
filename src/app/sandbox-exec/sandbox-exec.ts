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
 * SandboxExec is an interactive xterm shell inside a running SwiftSandbox. It
 * opens a raw WebSocket to the gateway's /sandbox-exec bridge (pod-exec -> vsock
 * agent) and wires it both ways: keystrokes are sent as binary frames (stdin),
 * TTY resizes as a text control message ({"resize":{cols,rows}}), and the
 * agent's stdout/stderr binary frames are written to the terminal. An overlay
 * opened from the sandbox drawer; mirrors Console with the resize channel added.
 */
@Component({
  selector: 'app-sandbox-exec',
  imports: [MatIconModule, MatButtonModule],
  templateUrl: './sandbox-exec.html',
  styleUrl: './sandbox-exec.scss',
})
export class SandboxExec implements AfterViewInit, OnDestroy {
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
  private readonly onResize = () => this.doFit();

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

    const enc = new TextEncoder();
    const t = this.gw.sandboxExecWs(this.cluster(), this.namespace(), this.name());
    const ws = new WebSocket(t.url, t.protocols);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.status.set('open');
      term.focus();
      this.sendResize();
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') term.write(ev.data);
      else term.write(new Uint8Array(ev.data as ArrayBuffer));
    };
    ws.onclose = () => this.status.set('closed');
    ws.onerror = () => this.status.set('closed');
    term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(enc.encode(d));
    });
    this.ws = ws;
  }

  private doFit(): void {
    this.fit?.fit();
    this.sendResize();
  }

  private sendResize(): void {
    const t = this.term;
    const ws = this.ws;
    if (t && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ resize: { cols: t.cols, rows: t.rows } }));
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.ws?.close();
    this.term?.dispose();
  }
}
