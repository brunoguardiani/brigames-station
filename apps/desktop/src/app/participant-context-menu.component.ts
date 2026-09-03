import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild, inject } from '@angular/core';
import type { ParticipantAudioPreference } from './participant-audio.service';
import { fitContextMenuPosition } from './participant-context-menu-state';

@Component({
  selector: 'app-participant-context-menu', changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section #menu class="participant-context-menu" role="menu" [attr.aria-label]="'Ações de ' + participantName" [style.left.px]="left" [style.top.px]="top" (pointerdown)="$event.stopPropagation()">
      <header>{{ participantName }}</header>
      <div class="volume-row">
        <button class="icon-button" type="button" role="menuitem" [class.active]="audioPreference.muted" [attr.aria-label]="audioPreference.muted ? 'Ouvir ' + participantName + ' novamente' : 'Silenciar ' + participantName + ' para mim'" [title]="audioPreference.muted ? 'Ouvir novamente' : 'Silenciar para mim'" (click)="muteToggle.emit()">
          @if (audioPreference.muted) { <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4Z"/><path d="m16 9 5 5M21 9l-5 5"/></svg> }
          @else { <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg> }
        </button>
        <input type="range" min="0" max="100" step="1" [value]="audioPreference.volume * 100" [attr.aria-label]="'Volume local de ' + participantName" (keydown)="onVolumeKeydown($event)" (input)="volumeChange.emit(+$any($event.target).value)">
        <strong>{{ (audioPreference.volume * 100).toFixed(0) }}%</strong>
      </div>
      <div class="media-actions" aria-label="Mídia do participante">
        <button class="icon-button media-button" type="button" role="menuitem" [disabled]="!hasScreenShare" [class.active]="screenShareActive" [attr.aria-pressed]="screenShareActive" [attr.aria-label]="!hasScreenShare ? 'Transmissão indisponível para ' + participantName : (screenShareActive ? 'Parar de assistir transmissão de ' : 'Assistir transmissão de ') + participantName" [title]="!hasScreenShare ? 'Transmissão desligada' : screenShareActive ? 'Parar de assistir transmissão' : 'Assistir transmissão'" (click)="screenShare.emit()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="m10 9 4 2-4 2Z"/><path d="M8 22h8M12 18v4"/>@if (!hasScreenShare) { <path class="off-line" d="M3 3l18 18"/> }</svg>
        </button>
        <button class="icon-button media-button" type="button" role="menuitem" [disabled]="!hasCamera" [class.active]="cameraActive" [attr.aria-pressed]="cameraActive" [attr.aria-label]="!hasCamera ? 'Câmera indisponível para ' + participantName : (cameraActive ? 'Parar de ver câmera de ' : 'Ver câmera de ') + participantName" [title]="!hasCamera ? 'Câmera desligada' : cameraActive ? 'Parar de ver câmera' : 'Ver câmera'" (click)="camera.emit()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 4.5-2.25A1 1 0 0 1 21 8.65v6.7a1 1 0 0 1-1.5.9L15 14"/>@if (!hasCamera) { <path class="off-line" d="M3 3l18 18"/> }</svg>
        </button>
      </div>
      <small>Volume somente para você</small>
    </section>`,
  styles: [`
    .participant-context-menu{position:fixed;z-index:80;width:14rem;padding:.45rem;border:1px solid #454d61;border-radius:.65rem;color:var(--text);background:#222734f7;box-shadow:0 .8rem 2rem #0009;backdrop-filter:blur(.6rem)}header{overflow:hidden;padding:.35rem .45rem .55rem;color:#d9d6ff;font-size:.78rem;font-weight:800;text-overflow:ellipsis;white-space:nowrap}
    .volume-row{display:grid;grid-template-columns:2rem minmax(0,1fr) 2.45rem;align-items:center;gap:.4rem;padding:.35rem;border-radius:.45rem;background:#171a22}.volume-row input{width:100%;height:1rem;padding:0;accent-color:var(--accent);cursor:pointer}.volume-row strong{color:#d9d6ff;font-size:.67rem;font-variant-numeric:tabular-nums;text-align:right}
    .icon-button{position:relative;display:grid;place-items:center;width:2rem;height:2rem;padding:0;border-radius:.42rem;color:var(--muted);background:#353c4d}.icon-button:hover,.icon-button:focus-visible{color:#fff;background:#4a5265;outline:2px solid #a59eff;outline-offset:1px}.icon-button.active{color:#fff;background:var(--accent);box-shadow:inset 0 0 0 1px #c8c4ff}.icon-button.active:after{content:'';position:absolute;right:.18rem;bottom:.18rem;width:.3rem;height:.3rem;border:1px solid #222734;border-radius:50%;background:#7fe1a8}.icon-button:disabled{color:#697184;background:#292e3a;cursor:not-allowed;opacity:.72}.icon-button:disabled:hover{color:#697184;background:#292e3a;outline:0}.icon-button svg{width:1.05rem;height:1.05rem;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.icon-button svg .off-line{stroke-width:2.6}.media-actions{display:flex;justify-content:center;gap:.55rem;padding:.55rem .2rem .2rem}.media-button{width:2.2rem;height:2.2rem}small{display:block;padding:.35rem .35rem .1rem;color:var(--subtle);font-size:.6rem;text-align:center}
  `],
})
export class ParticipantContextMenuComponent implements AfterViewInit {
  private readonly changeDetector = inject(ChangeDetectorRef);
  @Input({ required: true }) participantName = ''; @Input({ required: true }) x = 0; @Input({ required: true }) y = 0;
  @Input({ required: true }) audioPreference: ParticipantAudioPreference = { volume: 1, muted: false };
  @Input() hasCamera = false; @Input() hasScreenShare = false; @Input() cameraActive = false; @Input() screenShareActive = false;
  @Output() readonly closed = new EventEmitter<void>(); @Output() readonly camera = new EventEmitter<void>(); @Output() readonly screenShare = new EventEmitter<void>();
  @Output() readonly volumeChange = new EventEmitter<number>(); @Output() readonly muteToggle = new EventEmitter<void>();
  @ViewChild('menu', { static: true }) private menu!: ElementRef<HTMLElement>;
  protected left = 0; protected top = 0;
  ngAfterViewInit(): void { const element = this.menu.nativeElement; const fitted = fitContextMenuPosition(this.x, this.y, element.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }); this.left = fitted.x; this.top = fitted.y; this.changeDetector.detectChanges(); queueMicrotask(() => element.querySelector<HTMLElement>('input, button')?.focus()); }
  @HostListener('document:pointerdown', ['$event']) protected outside(event: PointerEvent): void { if (!this.menu.nativeElement.contains(event.target as Node)) this.closed.emit(); }
  @HostListener('document:keydown', ['$event']) protected keydown(event: KeyboardEvent): void { if (event.key === 'Escape') { event.preventDefault(); this.closed.emit(); return; } if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.target instanceof HTMLInputElement) return; const items = [...this.menu.nativeElement.querySelectorAll<HTMLElement>('button:not([disabled]), input')]; if (!items.length) return; event.preventDefault(); const current = items.indexOf(document.activeElement as HTMLElement); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length; items[next]?.focus(); }
  @HostListener('window:resize') protected resize(): void { this.closed.emit(); } @HostListener('window:blur') protected blur(): void { this.closed.emit(); }
  @HostListener('document:scroll', ['$event']) protected scroll(event: Event): void { if (!this.menu.nativeElement.contains(event.target as Node)) this.closed.emit(); }
  protected onVolumeKeydown(event: KeyboardEvent): void { event.stopPropagation(); }
}
