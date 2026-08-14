import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, signal } from '@angular/core';

type BackendState = 'checking' | 'available' | 'unavailable';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <h1>brigames-station</h1>
      <p>Backend status: <strong>{{ status() }}</strong></p>
    </main>
  `,
  styles: `
    main { padding: 2rem; }
    strong { text-transform: capitalize; }
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  protected readonly status = signal<BackendState>('checking');
  private healthCheckTimer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    void this.refreshBackendStatus();
    this.healthCheckTimer = setInterval(() => void this.refreshBackendStatus(), 5_000);
  }

  ngOnDestroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
  }

  private async refreshBackendStatus(): Promise<void> {
    try {
      const health = await window.desktop.backend.getHealth();
      this.status.set(health.status === 'alive' ? 'available' : 'unavailable');
    } catch {
      this.status.set('unavailable');
    }
  }
}
