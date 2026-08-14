import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

type BackendState = 'checking' | 'available' | 'unavailable';
type User = { username: string; email: string; role: string };

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class AppComponent implements OnInit, OnDestroy {
  protected readonly status = signal<BackendState>('checking');
  protected readonly user = signal<User | null>(null);
  protected readonly error = signal('');
  protected readonly loading = signal(false);
  protected identity = '';
  protected password = '';
  private healthCheckTimer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    void this.refreshBackendStatus();
    void this.restoreSession();
    this.healthCheckTimer = setInterval(() => void this.refreshBackendStatus(), 5_000);
  }
  ngOnDestroy(): void { if (this.healthCheckTimer) clearInterval(this.healthCheckTimer); }
  protected async login(): Promise<void> {
    this.loading.set(true); this.error.set('');
    try { this.user.set(await window.desktop.auth.login(this.identity, this.password)); this.password = ''; }
    catch { this.error.set('Login failed. Check your credentials and backend connection.'); }
    finally { this.loading.set(false); }
  }
  protected async logout(): Promise<void> { await window.desktop.auth.logout(); this.user.set(null); }
  private async restoreSession(): Promise<void> { try { this.user.set(await window.desktop.auth.currentSession()); } catch { this.user.set(null); } }
  private async refreshBackendStatus(): Promise<void> {
    try { const health = await window.desktop.backend.getHealth(); this.status.set(health.status === 'alive' ? 'available' : 'unavailable'); }
    catch { this.status.set('unavailable'); }
  }
}
