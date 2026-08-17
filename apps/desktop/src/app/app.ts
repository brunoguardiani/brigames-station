import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Room, RoomEvent, Track } from 'livekit-client';

type BackendState = 'checking' | 'available' | 'unavailable';
type User = { username: string; email: string; role: string };

@Component({
  selector: 'app-root', changeDetection: ChangeDetectionStrategy.OnPush, imports: [FormsModule], templateUrl: './app.html', styleUrl: './app.css',
})
export class AppComponent implements OnInit, OnDestroy {
  protected readonly macOS = navigator.userAgent.includes('Macintosh');
  protected readonly status = signal<BackendState>('checking');
  protected readonly user = signal<User | null>(null);
  protected readonly servers = signal<Server[]>([]);
  protected readonly channels = signal<Channel[]>([]);
  protected readonly members = signal<ServerMember[]>([]);
  protected readonly selectedServer = signal<Server | null>(null);
  protected readonly selectedChannel = signal<Channel | null>(null);
  protected readonly messages = signal<Message[]>([]);
  protected readonly error = signal('');
  protected readonly loading = signal(false);
  protected readonly leaveConfirmationOpen = signal(false);
  protected readonly voiceChannel = signal<Channel | null>(null);
  protected readonly voiceParticipants = signal<VoiceParticipant[]>([]);
  protected readonly activeSpeakerIDs = signal<string[]>([]);
  protected readonly microphoneMuted = signal(false);
  protected registrationMode = false;
  protected identity = ''; protected username = ''; protected email = ''; protected password = ''; protected passwordConfirmation = ''; protected serverName = ''; protected serverDescription = ''; protected channelName = ''; protected channelType: 'text' | 'voice' = 'text'; protected messageContent = ''; protected inviteCode = ''; protected createdInvite = '';
  private healthCheckTimer?: ReturnType<typeof setInterval>;
  private removeRealtimeConnectedListener?: () => void;
  private removeRealtimeMessageListener?: () => void;
  private removeRealtimePresenceListener?: () => void;
  private voiceRoom?: Room;
  private voiceAudioElements: HTMLAudioElement[] = [];
  private voiceAudioContext?: AudioContext;

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
    this.removeRealtimePresenceListener = window.desktop.realtime.onPresenceChanged((presence) => {
      this.members.update((members) => members.map((member) => member.id === presence.user_id ? { ...member, online: presence.online } : member));
    });
  }
  ngOnDestroy(): void {
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    this.removeRealtimeConnectedListener?.();
    this.removeRealtimeMessageListener?.();
    this.removeRealtimePresenceListener?.();
    void this.leaveVoiceChannel();
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
  protected toggleRegistrationMode(): void {
    this.registrationMode = !this.registrationMode;
    this.error.set('');
    this.password = '';
    this.passwordConfirmation = '';
  }
  protected async register(): Promise<void> {
    if (this.password !== this.passwordConfirmation) {
      this.error.set('Passwords do not match.');
      return;
    }
    this.loading.set(true); this.error.set('');
    try {
      this.user.set(await window.desktop.auth.register(this.username, this.email, this.password));
      this.password = ''; this.passwordConfirmation = '';
      await this.loadServers();
    } catch (error) { this.error.set(this.messageFor(error, 'Unable to create the account.')); }
    finally { this.loading.set(false); }
  }
  protected async logout(): Promise<void> { await this.leaveVoiceChannel(); await window.desktop.auth.logout(); this.user.set(null); this.servers.set([]); this.channels.set([]); this.selectedServer.set(null); this.error.set(''); }
  protected async createServer(): Promise<void> {
    this.loading.set(true); this.error.set('');
    try { const server = await window.desktop.servers.create(this.serverName, this.serverDescription); this.serverName = ''; this.serverDescription = ''; await this.loadServers(server.id); }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to create server.')); }
    finally { this.loading.set(false); }
  }
  protected async selectServer(server: Server): Promise<void> {
    this.error.set(''); this.selectedServer.set(server); this.selectedChannel.set(null); this.messages.set([]); this.channels.set([]); this.members.set([]);
    try { const [channels, members] = await Promise.all([window.desktop.channels.list(server.id), window.desktop.servers.listMembers(server.id)]); this.channels.set(channels); this.members.set(members); }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to load channels.')); }
  }
  protected async selectChannel(channel: Channel): Promise<void> { if (channel.type !== 'text') return; this.selectedChannel.set(channel); this.error.set(''); try { this.messages.set((await window.desktop.messages.list(channel.id)).messages.reverse()); } catch (error) { this.error.set(this.messageFor(error, 'Unable to load messages.')); } }
  protected async joinVoiceChannel(channel: Channel): Promise<void> {
    if (this.voiceChannel()?.id === channel.id) return;
    await this.leaveVoiceChannel(); this.loading.set(true); this.error.set('');
    try {
      const session = await window.desktop.voice.join(channel.id);
      const room = new Room();
      const toVoiceParticipant = (participant: { identity: string; name?: string; isMicrophoneEnabled: boolean }): VoiceParticipant => ({
        identity: participant.identity,
        name: participant.name || participant.identity,
        muted: !participant.isMicrophoneEnabled,
      });
      const refreshParticipants = () => this.voiceParticipants.set([
        toVoiceParticipant(room.localParticipant),
        ...Array.from(room.remoteParticipants.values()).map(toVoiceParticipant),
      ]);

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const audio = track.attach();
          document.body.appendChild(audio);
          this.voiceAudioElements.push(audio);
        }
      });
      room.on(RoomEvent.ParticipantConnected, () => {
        refreshParticipants();
        if (this.voiceRoom === room) this.playVoiceSound('join');
      });
      room.on(RoomEvent.ParticipantDisconnected, () => {
        refreshParticipants();
        if (this.voiceRoom === room) this.playVoiceSound('leave');
      });
      room.on(RoomEvent.TrackMuted, refreshParticipants);
      room.on(RoomEvent.TrackUnmuted, refreshParticipants);
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => this.activeSpeakerIDs.set(speakers.map((speaker) => speaker.identity)));
      room.on(RoomEvent.Disconnected, () => {
        this.voiceRoom = undefined;
        this.voiceChannel.set(null);
        this.voiceParticipants.set([]);
        this.activeSpeakerIDs.set([]);
        this.removeVoiceAudio();
      });

      await room.connect(session.url, session.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      this.voiceRoom = room;
      this.voiceChannel.set(channel);
      refreshParticipants();
      this.playVoiceSound('join');
    }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to join voice channel.')); }
    finally { this.loading.set(false); }
  }
  protected async leaveVoiceChannel(): Promise<void> { const room=this.voiceRoom; this.voiceRoom=undefined; this.voiceChannel.set(null); this.voiceParticipants.set([]); this.activeSpeakerIDs.set([]); this.microphoneMuted.set(false); this.removeVoiceAudio(); if (room) { this.playVoiceSound('leave'); await room.disconnect(); } }
  protected async toggleMicrophone(): Promise<void> { if (!this.voiceRoom) return; const muted = !this.microphoneMuted(); await this.voiceRoom.localParticipant.setMicrophoneEnabled(!muted); this.microphoneMuted.set(muted); this.playVoiceSound(muted ? 'mute' : 'unmute'); }
  protected isSpeaking(participant: VoiceParticipant): boolean { return this.activeSpeakerIDs().includes(participant.identity); }
  private removeVoiceAudio(): void { for (const audio of this.voiceAudioElements) audio.remove(); this.voiceAudioElements = []; }
  private playVoiceSound(event: 'join' | 'leave' | 'mute' | 'unmute'): void {
    const context = this.voiceAudioContext ??= new AudioContext();
    const notes = event === 'join' ? [523, 659] : event === 'leave' ? [440, 330] : event === 'mute' ? [330] : [523];
    const startedAt = context.currentTime;

    if (context.state === 'suspended') void context.resume();
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const offset = index * 0.09;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startedAt + offset);
      gain.gain.setValueAtTime(0.0001, startedAt + offset);
      gain.gain.exponentialRampToValueAtTime(0.08, startedAt + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + offset + 0.12);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(startedAt + offset);
      oscillator.stop(startedAt + offset + 0.13);
    });
  }
  protected async sendMessage(): Promise<void> { const channel = this.selectedChannel(); if (!channel) return; this.loading.set(true); try { await window.desktop.messages.create(channel.id, this.messageContent); this.messageContent = ''; await this.selectChannel(channel); } catch (error) { this.error.set(this.messageFor(error, 'Unable to send message.')); } finally { this.loading.set(false); } }
  protected async createInvite(): Promise<void> { const server=this.selectedServer(); if(!server)return; try { this.createdInvite=(await window.desktop.invites.createAndCopy(server.id)).code; } catch(error){this.error.set(this.messageFor(error,'Unable to create invite.'));} }
  protected async joinInvite(): Promise<void> { try { const joined=await window.desktop.invites.join(this.inviteCode); this.inviteCode=''; await this.loadServers(joined.server_id); } catch(error){this.error.set(this.messageFor(error,'Unable to join invite.'));} }
  protected async createChannel(): Promise<void> {
    const server = this.selectedServer(); if (!server) return;
    this.loading.set(true); this.error.set(''); const name = this.channelName;
    try { await window.desktop.channels.create(server.id, name, this.channelType); this.channelName = ''; this.channelType = 'text'; this.channels.set(await window.desktop.channels.list(server.id)); }
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
    if (next) await this.selectServer(next); else { this.selectedServer.set(null); this.channels.set([]); this.members.set([]); }
  }
  private async refreshBackendStatus(): Promise<void> { try { const health = await window.desktop.backend.getHealth(); this.status.set(health.status === 'alive' ? 'available' : 'unavailable'); } catch { this.status.set('unavailable'); } }
  private messageFor(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback; }
}

type VoiceParticipant = { identity: string; name: string; muted: boolean };
type ServerMember = { id: number; username: string; role: 'owner' | 'member'; online: boolean };
