import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

type BackendState = 'checking' | 'available' | 'unavailable';
type User = { username: string; email: string; role: string };

@Component({
  selector: 'app-root', changeDetection: ChangeDetectionStrategy.OnPush, imports: [FormsModule], templateUrl: './app.html', styleUrl: './app.css',
})
export class AppComponent implements OnInit, OnDestroy {
  protected readonly status = signal<BackendState>('checking');
  protected readonly user = signal<User | null>(null);
  protected readonly servers = signal<Server[]>([]);
  protected readonly channels = signal<Channel[]>([]);
  protected readonly selectedServer = signal<Server | null>(null);
  protected readonly selectedChannel = signal<Channel | null>(null);
  protected readonly messages = signal<Message[]>([]);
  protected readonly error = signal('');
  protected readonly loading = signal(false);
  protected readonly leaveConfirmationOpen = signal(false);
  protected identity = ''; protected password = ''; protected serverName = ''; protected serverDescription = ''; protected channelName = ''; protected messageContent = ''; protected inviteCode = ''; protected createdInvite = '';
  private healthCheckTimer?: ReturnType<typeof setInterval>;
  private removeRealtimeConnectedListener?: () => void;
  private removeRealtimeMessageListener?: () => void;

  ngOnInit(): void {
    void this.refreshBackendStatus();
    void this.restoreSession();
    this.healthCheckTimer = setInterval(() => void this.refreshBackendStatus(), 5_000);
    this.removeRealtimeConnectedListener = window.desktop.realtime.onConnected(() => {
      const channel = this.selectedChannel();
      if (channel) void this.selectChannel(channel);
    });
    this.removeRealtimeMessageListener = window.desktop.realtime.onMessageCreated((message) => {
      if (this.selectedChannel()?.id !== message.channel_id) return;
      this.messages.update((items) => items.some((item) => item.id === message.id) ? items : [...items, message]);
    });
  }
  ngOnDestroy(): void {
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    this.removeRealtimeConnectedListener?.();
    this.removeRealtimeMessageListener?.();
  }
  @HostListener('document:click', ['$event'])
  protected closePopoversWhenClickingOutside(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const containingDetails = target.closest<HTMLDetailsElement>('details.create-server, details.join-server, details.actions');
    document.querySelectorAll<HTMLDetailsElement>('details.create-server[open], details.join-server[open], details.actions[open]').forEach((details) => {
      if (details !== containingDetails) details.open = false;
    });
  }
  protected async login(): Promise<void> {
    this.loading.set(true); this.error.set('');
    try { this.user.set(await window.desktop.auth.login(this.identity, this.password)); this.password = ''; await this.loadServers(); }
    catch (error) { this.error.set(this.messageFor(error, 'Login failed. Check your credentials and backend connection.')); }
    finally { this.loading.set(false); }
  }
  protected async logout(): Promise<void> { await window.desktop.auth.logout(); this.user.set(null); this.servers.set([]); this.channels.set([]); this.selectedServer.set(null); this.error.set(''); }
  protected async createServer(): Promise<void> {
    this.loading.set(true); this.error.set('');
    try { const server = await window.desktop.servers.create(this.serverName, this.serverDescription); this.serverName = ''; this.serverDescription = ''; await this.loadServers(server.id); }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to create server.')); }
    finally { this.loading.set(false); }
  }
  protected async selectServer(server: Server): Promise<void> {
    this.error.set(''); this.selectedServer.set(server); this.selectedChannel.set(null); this.messages.set([]); this.channels.set([]);
    try { this.channels.set(await window.desktop.channels.list(server.id)); }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to load channels.')); }
  }
  protected async selectChannel(channel: Channel): Promise<void> { this.selectedChannel.set(channel); this.error.set(''); try { this.messages.set((await window.desktop.messages.list(channel.id)).messages.reverse()); } catch (error) { this.error.set(this.messageFor(error, 'Unable to load messages.')); } }
  protected async sendMessage(): Promise<void> { const channel = this.selectedChannel(); if (!channel) return; this.loading.set(true); try { await window.desktop.messages.create(channel.id, this.messageContent); this.messageContent = ''; await this.selectChannel(channel); } catch (error) { this.error.set(this.messageFor(error, 'Unable to send message.')); } finally { this.loading.set(false); } }
  protected async createInvite(): Promise<void> { const server=this.selectedServer(); if(!server)return; try { this.createdInvite=(await window.desktop.invites.createAndCopy(server.id)).code; } catch(error){this.error.set(this.messageFor(error,'Unable to create invite.'));} }
  protected async joinInvite(): Promise<void> { try { const joined=await window.desktop.invites.join(this.inviteCode); this.inviteCode=''; await this.loadServers(joined.server_id); } catch(error){this.error.set(this.messageFor(error,'Unable to join invite.'));} }
  protected async createChannel(): Promise<void> {
    const server = this.selectedServer(); if (!server) return;
    this.loading.set(true); this.error.set(''); const name = this.channelName;
    try { await window.desktop.channels.create(server.id, name); this.channelName = ''; this.channels.set(await window.desktop.channels.list(server.id)); }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to create channel.')); }
    finally { this.loading.set(false); }
  }
  protected async leaveSelectedServer(): Promise<void> {
    const server = this.selectedServer(); if (!server) return;
    this.loading.set(true); this.error.set('');
    try { await window.desktop.servers.leave(server.id); await this.loadServers(); }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to leave server.')); }
    finally { this.loading.set(false); }
  }
  protected requestLeaveServer(): void {
    if (this.selectedServer()) this.leaveConfirmationOpen.set(true);
  }
  protected cancelLeaveServer(): void { this.leaveConfirmationOpen.set(false); }
  protected async confirmLeaveServer(): Promise<void> {
    this.leaveConfirmationOpen.set(false);
    await this.leaveSelectedServer();
  }
  private async restoreSession(): Promise<void> { try { this.user.set(await window.desktop.auth.currentSession()); if (this.user()) await this.loadServers(); } catch { this.user.set(null); } }
  private async loadServers(selectID?: number): Promise<void> {
    const servers = await window.desktop.servers.list(); this.servers.set(servers);
    const selected = this.selectedServer(); const next = selectID ? servers.find((server) => server.id === selectID) : selected && servers.find((server) => server.id === selected.id);
    if (next) await this.selectServer(next); else { this.selectedServer.set(null); this.channels.set([]); }
  }
  private async refreshBackendStatus(): Promise<void> { try { const health = await window.desktop.backend.getHealth(); this.status.set(health.status === 'alive' ? 'available' : 'unavailable'); } catch { this.status.set('unavailable'); } }
  private messageFor(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback; }
}
