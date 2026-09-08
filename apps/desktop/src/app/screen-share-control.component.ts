import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, HostListener, Input, Output, effect, inject, signal, viewChild } from '@angular/core';

@Component({
  selector: 'app-screen-share-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button #trigger class="screen-share-control" type="button" [class.active]="active" [disabled]="busy"
      [title]="active ? 'Opções da transmissão' : 'Compartilhar tela'"
      [attr.aria-label]="active ? 'Opções da transmissão' : 'Compartilhar tela'"
      [attr.aria-haspopup]="active ? 'menu' : null" [attr.aria-expanded]="active ? menuOpen() : null"
      [attr.aria-controls]="menuOpen() ? 'screen-share-menu' : null" (click)="toggle()" (keydown.arrowdown)="openWithKeyboard($event)">
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="14" rx="2"/><path d="m8 21 4-4 4 4"/><path d="M12 17v4"/></svg>
    </button>
    @if (menuOpen() && active) {
      <div #menu id="screen-share-menu" class="screen-share-menu" role="menu" aria-label="Opções da transmissão" (keydown)="navigateMenu($event)">
        <button type="button" role="menuitem" class="stop-sharing" [disabled]="busy" (click)="choose('stop')">Parar transmissão</button>
        <button type="button" role="menuitem" [disabled]="busy" (click)="choose('change')">Alterar transmissão</button>
      </div>
    }
  `,
  styles: `
    :host{position:relative;display:block}
    button{font:inherit;border:0;cursor:pointer}
    button:focus-visible{outline:2px solid #a59eff;outline-offset:2px}
    button:disabled{cursor:wait;opacity:.5}
    .screen-share-control{display:grid;place-items:center;width:2.2rem;height:2.2rem;padding:.55rem;border-radius:.45rem;color:var(--muted);background:var(--raised)}
    .screen-share-control:hover{color:var(--text);background:var(--hover)}
    .screen-share-control.active{color:#fff;background:var(--accent)}
    svg{width:1.1rem;height:1.1rem}
    .screen-share-menu{position:absolute;z-index:1;bottom:calc(100% + .4rem);left:50%;display:grid;gap:.2rem;width:12.5rem;padding:.4rem;border:1px solid #41495b;border-radius:.6rem;background:#292e3c;box-shadow:0 .6rem 1.5rem #0008;transform:translateX(-50%)}
    .screen-share-menu button{padding:.65rem .7rem;border-radius:.35rem;color:var(--text);background:transparent;text-align:left;font-size:.8rem}
    .screen-share-menu button:hover,.screen-share-menu button:focus-visible{background:var(--hover)}
    .screen-share-menu .stop-sharing{color:#ff9ba2}
  `,
})
export class ScreenShareControlComponent {
  @Input() active = false;
  @Input() busy = false;
  @Output() readonly start = new EventEmitter<void>();
  @Output() readonly stop = new EventEmitter<void>();
  @Output() readonly change = new EventEmitter<void>();
  protected readonly menuOpen = signal(false);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');

  constructor() {
    effect(() => this.menu()?.nativeElement.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
  }

  ngOnChanges(): void { if (!this.active || this.busy) this.menuOpen.set(false); }

  protected toggle(): void {
    if (this.busy) return;
    if (this.active) this.menuOpen.update((open) => !open);
    else this.start.emit();
  }

  protected openWithKeyboard(event: Event): void {
    if (!this.active || this.busy) return;
    event.preventDefault();
    this.menuOpen.set(true);
  }

  protected choose(action: 'stop' | 'change'): void {
    this.close(true);
    if (action === 'stop') this.stop.emit();
    else this.change.emit();
  }

  protected navigateMenu(event: KeyboardEvent): void {
    const buttons = Array.from(this.menu()?.nativeElement.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (!buttons.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  @HostListener('document:click', ['$event'])
  protected closeOutside(event: MouseEvent): void {
    if (event.target instanceof Node && !this.element.nativeElement.contains(event.target)) this.close();
  }

  @HostListener('focusout', ['$event'])
  protected closeOnBlur(event: FocusEvent): void {
    if (!(event.relatedTarget instanceof Node) || !this.element.nativeElement.contains(event.relatedTarget)) this.close();
  }

  @HostListener('document:keydown.escape', ['$event'])
  protected closeOnEscape(event: Event): void {
    if (!this.menuOpen()) return;
    event.preventDefault();
    this.close(true);
  }

  private close(restoreFocus = false): void {
    this.menuOpen.set(false);
    if (restoreFocus) this.trigger()?.nativeElement.focus();
  }
}
