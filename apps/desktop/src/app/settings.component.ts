import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, HostListener, Input, Output, computed, signal, viewChild } from '@angular/core';
import type { Signal } from '@angular/core';
import type { User } from './app';

export type SettingsSection = 'account' | 'profile' | 'voice' | 'appearance' | 'notifications' | 'system';

@Component({
  selector: 'app-settings', changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './settings.component.html', styleUrl: './settings.component.css',
})
export class SettingsComponent implements AfterViewInit {
  private readonly firstNav = viewChild<ElementRef<HTMLButtonElement>>('firstNav');
  protected readonly section = signal<SettingsSection>('account');
  protected readonly sectionTitles: Record<SettingsSection, string> = { account: 'Minha conta', profile: 'Perfil', voice: 'Voz e vídeo', appearance: 'Aparência', notifications: 'Notificações', system: 'Sistema' };
  @Input({ required: true }) user!: Signal<User | null>;
  @Input({ required: true }) appVersion!: Signal<string>;
  @Input({ required: true }) avatarSaving!: Signal<boolean>;
  @Input({ required: true }) selectedAvatarID!: Signal<string | null>;
  @Input() availableAvatars: string[] = [];
  @Input({ required: true }) hardwareAcceleration!: Signal<boolean>;
  @Input({ required: true }) hardwareAccelerationRestartRequired!: Signal<boolean>;
  @Input({ required: true }) noiseFilterEnabled!: Signal<boolean>;
  @Input({ required: true }) noiseFilterMode!: Signal<'standard' | 'advanced'>;
  @Input({ required: true }) inputVolumeDb!: Signal<number>;
  @Input({ required: true }) inputDeviceId!: Signal<string | null>;
  @Input({ required: true }) inputDevices!: Signal<MediaDeviceInfo[]>;
  @Input({ required: true }) outputVolume!: Signal<number>;
  @Input({ required: true }) outputDeviceId!: Signal<string | null>;
  @Input({ required: true }) outputDevices!: Signal<MediaDeviceInfo[]>;
  @Input({ required: true }) micLevel!: Signal<number>;
  @Input({ required: true }) micTestActive!: Signal<boolean>;
  @Input({ required: true }) mentionNotifications!: Signal<boolean>;
  @Input({ required: true }) accent!: Signal<string>;
  @Input({ required: true }) fontScale!: Signal<number>;
  @Input({ required: true }) density!: Signal<'cozy' | 'compact'>;
  @Input() accentOptions: string[] = [];
  @Input() saveProfile: (profile: { username: string; email: string }) => Promise<boolean> = async () => false;
  @Input() changePassword: (currentPassword: string, newPassword: string) => Promise<boolean> = async () => false;
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly avatarSelect = new EventEmitter<string | null>();
  @Output() readonly avatarSave = new EventEmitter<void>();
  @Output() readonly noiseFilterToggle = new EventEmitter<boolean>();
  @Output() readonly noiseFilterModeSelect = new EventEmitter<string>();
  @Output() readonly inputVolumeChange = new EventEmitter<number>();
  @Output() readonly inputDeviceSelect = new EventEmitter<string>();
  @Output() readonly outputVolumeChange = new EventEmitter<number>();
  @Output() readonly outputDeviceSelect = new EventEmitter<string>();
  @Output() readonly micTestToggle = new EventEmitter<void>();
  @Output() readonly hardwareAccelerationToggle = new EventEmitter<boolean>();
  @Output() readonly relaunch = new EventEmitter<void>();
  @Output() readonly logout = new EventEmitter<void>();
  @Output() readonly statusSelect = new EventEmitter<'online' | 'idle' | 'invisible'>();
  @Output() readonly mentionNotificationsToggle = new EventEmitter<boolean>();
  @Output() readonly accentSelect = new EventEmitter<string>();
  @Output() readonly fontScaleChange = new EventEmitter<number>();
  @Output() readonly densitySelect = new EventEmitter<'cozy' | 'compact'>();
  protected readonly accentColors: Record<string, string> = { violet: '#766cf6', blurple: '#5865f2', green: '#23a55a', pink: '#eb459e', orange: '#f97316' };
  protected readonly accentLabels: Record<string, string> = { violet: 'Violeta', blurple: 'Blurple', green: 'Verde', pink: 'Rosa', orange: 'Laranja' };
  protected readonly fontScalePercent = computed(() => Math.round(this.fontScale() * 100));
  protected readonly inputVolumePercent = computed(() => ((this.inputVolumeDb() + 30) / 60) * 100);
  protected readonly outputVolumePercent = computed(() => (this.outputVolume() / 2) * 100);
  protected readonly profileEditing = signal(false);
  protected readonly profileSaving = signal(false);
  protected readonly profileError = signal('');
  protected profileUsername = '';
  protected profileEmail = '';
  protected startProfileEdit(): void {
    this.profileUsername = this.user()?.username ?? '';
    this.profileEmail = this.user()?.email ?? '';
    this.profileError.set('');
    this.profileEditing.set(true);
  }
  protected cancelProfileEdit(): void {
    if (this.profileSaving()) return;
    this.profileEditing.set(false);
    this.profileError.set('');
  }
  protected profileValid(): boolean {
    const username = this.profileUsername.trim();
    return username.length >= 3 && username.length <= 32 && /^\S+@\S+\.\S+$/.test(this.profileEmail.trim());
  }
  protected async submitProfile(): Promise<void> {
    this.profileError.set('');
    const username = this.profileUsername.trim();
    const email = this.profileEmail.trim();
    if (username.length < 3 || username.length > 32) {
      this.profileError.set('O nome de usuário deve ter entre 3 e 32 caracteres.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      this.profileError.set('Informe um e-mail válido.');
      return;
    }
    this.profileSaving.set(true);
    const saved = await this.saveProfile({ username, email });
    this.profileSaving.set(false);
    if (saved) this.profileEditing.set(false);
    else this.profileError.set('Não foi possível salvar. Nome ou e-mail já está em uso?');
  }
  protected readonly passwordEditing = signal(false);
  protected readonly passwordSaving = signal(false);
  protected readonly passwordError = signal('');
  protected passwordCurrent = '';
  protected passwordNew = '';
  protected passwordConfirm = '';
  protected startPasswordEdit(): void {
    this.passwordCurrent = '';
    this.passwordNew = '';
    this.passwordConfirm = '';
    this.passwordError.set('');
    this.passwordEditing.set(true);
  }
  protected cancelPasswordEdit(): void {
    if (this.passwordSaving()) return;
    this.passwordEditing.set(false);
    this.passwordError.set('');
  }
  protected passwordValid(): boolean {
    return this.passwordCurrent.length > 0 && this.passwordNew.length >= 12 && this.passwordNew === this.passwordConfirm;
  }
  protected async submitPassword(): Promise<void> {
    this.passwordError.set('');
    if (this.passwordNew.length < 12) {
      this.passwordError.set('A nova senha deve ter pelo menos 12 caracteres.');
      return;
    }
    if (this.passwordNew !== this.passwordConfirm) {
      this.passwordError.set('A confirmação não confere com a nova senha.');
      return;
    }
    this.passwordSaving.set(true);
    const changed = await this.changePassword(this.passwordCurrent, this.passwordNew);
    this.passwordSaving.set(false);
    if (changed) this.passwordEditing.set(false);
    else this.passwordError.set('Não foi possível alterar a senha. Verifique a senha atual.');
  }
  protected avatarURL(avatarID: string | null | undefined): string | null {
    return avatarID ? `assets/avatars/${avatarID}.png` : null;
  }
  ngAfterViewInit(): void {
    queueMicrotask(() => this.firstNav()?.nativeElement.focus());
  }
  @HostListener('document:keydown.escape', ['$event'])
  protected closeOnEscape(event: Event): void {
    event.preventDefault();
    this.closed.emit();
  }
}
