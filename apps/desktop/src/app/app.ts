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
  protected readonly screenSharePickerOpen = signal(false);
  protected readonly screenShareSources = signal<ScreenShareSource[]>([]);
  protected readonly screenSharing = signal(false);
  protected readonly cameraEnabled = signal(false);
  protected readonly voiceMediaActive = signal(false);
  protected readonly voiceMediaVisible = signal(false);
  protected readonly systemAudioSupported = navigator.userAgent.includes('Windows');
  protected shareSystemAudio = true;
  protected registrationMode = false;
  protected identity = ''; protected username = ''; protected email = ''; protected password = ''; protected passwordConfirmation = ''; protected serverName = ''; protected serverDescription = ''; protected channelName = ''; protected channelType: 'text' | 'voice' = 'text'; protected messageContent = ''; protected inviteCode = ''; protected createdInvite = '';
  private healthCheckTimer?: ReturnType<typeof setInterval>;
  private removeSessionExpiredListener?: () => void;
  private removeRealtimeConnectedListener?: () => void;
  private removeRealtimeMessageListener?: () => void;
  private removeRealtimePresenceListener?: () => void;
  private removeRealtimeVoicePresenceListener?: () => void;
  private voiceRoom?: Room;
  private voiceAudioElements: HTMLAudioElement[] = [];
  private voiceVideoElements: Array<{ track: Track; trackSid?: string; element: HTMLElement; source: Track.Source }> = [];
  private featuredVoiceVideoTrack?: Track;
  private voiceAudioContext?: AudioContext;

  ngOnInit(): void {
    void this.refreshBackendStatus();
    void this.restoreSession();
    this.healthCheckTimer = setInterval(() => void this.refreshBackendStatus(), 5_000);
    this.removeSessionExpiredListener = window.desktop.auth.onSessionExpired(() => {
      void this.leaveVoiceChannel();
      this.user.set(null);
      this.servers.set([]);
      this.channels.set([]);
      this.members.set([]);
      this.selectedServer.set(null);
      this.selectedChannel.set(null);
      this.messages.set([]);
      this.error.set('Sua sessão expirou. Entre novamente para continuar.');
    });
    this.removeRealtimeConnectedListener = window.desktop.realtime.onConnected(() => {
      const channel = this.selectedChannel();
      if (channel) void this.refreshMessages(channel);
      const server = this.selectedServer();
      if (server) void this.refreshServerMembers(server.id);
      const voiceChannel = this.voiceChannel();
      if (voiceChannel) void window.desktop.voice.setPresence(voiceChannel.id).catch(() => undefined);
    });
    this.removeRealtimeMessageListener = window.desktop.realtime.onMessageCreated((message) => {
      if (this.selectedChannel()?.id !== message.channel_id) return;
      this.messages.update((items) => items.some((item) => item.id === message.id) ? items : [...items, message]);
    });
    this.removeRealtimePresenceListener = window.desktop.realtime.onPresenceChanged((presence) => {
      this.members.update((members) => members.map((member) => member.id === presence.user_id ? { ...member, online: presence.online } : member));
    });
    this.removeRealtimeVoicePresenceListener = window.desktop.realtime.onVoicePresenceChanged((presence) => {
      if (this.selectedServer()?.id !== presence.server_id) return;
      this.members.update((members) => members.map((member) => member.id === presence.user_id ? { ...member, voice_channel_id: presence.channel_id } : member));
    });
  }
  ngOnDestroy(): void {
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    this.removeSessionExpiredListener?.();
    this.removeRealtimeConnectedListener?.();
    this.removeRealtimeMessageListener?.();
    this.removeRealtimePresenceListener?.();
    this.removeRealtimeVoicePresenceListener?.();
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
    this.error.set(''); this.voiceMediaVisible.set(false); this.selectedServer.set(server); this.selectedChannel.set(null); this.messages.set([]); this.channels.set([]); this.members.set([]);
    try { const [channels, members] = await Promise.all([window.desktop.channels.list(server.id), window.desktop.servers.listMembers(server.id)]); this.channels.set(channels); this.members.set(members); }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to load channels.')); }
  }
  protected async selectChannel(channel: Channel): Promise<void> { if (channel.type !== 'text') return; this.voiceMediaVisible.set(false); this.selectedChannel.set(channel); this.error.set(''); try { this.messages.set((await window.desktop.messages.list(channel.id)).messages.reverse()); } catch (error) { this.error.set(this.messageFor(error, 'Unable to load messages.')); } }
  protected async joinVoiceChannel(channel: Channel): Promise<void> {
    if (this.voiceChannel()?.id === channel.id) { this.voiceMediaVisible.set(true); return; }
    await this.leaveVoiceChannel(); this.loading.set(true); this.error.set('');
    this.voiceMediaVisible.set(true);
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

      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const audio = track.attach();
          document.body.appendChild(audio);
          this.voiceAudioElements.push(audio);
        } else if (track.kind === Track.Kind.Video) {
          this.addVoiceVideo(track, publication.source, participant.name || participant.identity, publication.trackSid);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, publication) => this.removeVoiceVideo(track, publication.trackSid));
      room.on(RoomEvent.TrackUnpublished, (publication) => {
        if (publication.kind === Track.Kind.Video) this.removeVoiceVideo(publication.track, publication.trackSid);
      });
      room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
        if (publication.kind === Track.Kind.Video) this.removeVoiceVideo(publication.track, publication.trackSid);
      });
      room.on(RoomEvent.ParticipantConnected, () => {
        refreshParticipants();
        if (this.voiceRoom === room) this.playVoiceSound('join');
      });
      room.on(RoomEvent.ParticipantDisconnected, () => {
        refreshParticipants();
        if (this.voiceRoom === room) this.playVoiceSound('leave');
      });
      room.on(RoomEvent.TrackMuted, (publication) => {
        refreshParticipants();
        if (publication.kind === Track.Kind.Video) this.removeVoiceVideo(publication.track, publication.trackSid);
      });
      room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
        refreshParticipants();
        if (publication.kind === Track.Kind.Video && publication.track) {
          this.addVoiceVideo(publication.track, publication.source, participant.name || participant.identity, publication.trackSid);
        }
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => this.activeSpeakerIDs.set(speakers.map((speaker) => speaker.identity)));
      room.on(RoomEvent.Disconnected, () => {
        this.voiceRoom = undefined;
        this.voiceChannel.set(null);
        this.voiceParticipants.set([]);
        this.activeSpeakerIDs.set([]);
        this.screenSharing.set(false);
        this.cameraEnabled.set(false);
        this.removeVoiceAudio();
        this.removeVoiceVideo();
        void window.desktop.voice.setPresence(null).catch(() => undefined);
      });

      await room.connect(session.url, session.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      this.voiceRoom = room;
      this.voiceChannel.set(channel);
      await window.desktop.voice.setPresence(channel.id);
      refreshParticipants();
      this.playVoiceSound('join');
    }
    catch (error) { await this.leaveVoiceChannel(); this.error.set(this.messageFor(error, 'Unable to join voice channel.')); }
    finally { this.loading.set(false); }
  }
  protected async leaveVoiceChannel(): Promise<void> { const room=this.voiceRoom; this.voiceRoom=undefined; this.voiceChannel.set(null); this.voiceParticipants.set([]); this.activeSpeakerIDs.set([]); this.microphoneMuted.set(false); this.screenSharing.set(false); this.cameraEnabled.set(false); this.screenSharePickerOpen.set(false); this.voiceMediaVisible.set(false); this.removeVoiceAudio(); this.removeVoiceVideo(); if (room) { this.playVoiceSound('leave'); await room.disconnect(); } try { await window.desktop.voice.setPresence(null); } catch { /* The WebSocket disconnect cleanup remains the fallback. */ } }
  protected async toggleMicrophone(): Promise<void> { if (!this.voiceRoom) return; const muted = !this.microphoneMuted(); await this.voiceRoom.localParticipant.setMicrophoneEnabled(!muted); this.microphoneMuted.set(muted); this.playVoiceSound(muted ? 'mute' : 'unmute'); }
  protected async toggleCamera(): Promise<void> {
    const room = this.voiceRoom;
    if (!room) return;
    this.loading.set(true); this.error.set('');
    try {
      const enabled = !this.cameraEnabled();
      const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
      const publication = await room.localParticipant.setCameraEnabled(enabled);
      if (enabled && publication?.track) this.addVoiceVideo(publication.track, Track.Source.Camera, this.user()?.username ?? 'Você', publication.trackSid);
      if (!enabled && track) this.removeVoiceVideo(track);
      this.cameraEnabled.set(enabled);
      if (enabled) this.voiceMediaVisible.set(true);
    } catch (error) { this.error.set(this.messageFor(error, 'Unable to change the camera state.')); }
    finally { this.loading.set(false); }
  }
  protected async openScreenSharePicker(): Promise<void> {
    if (!this.voiceRoom) return;
    this.loading.set(true); this.error.set('');
    try { this.screenShareSources.set(await window.desktop.screenShare.listSources()); this.screenSharePickerOpen.set(true); }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to list screens for sharing.')); }
    finally { this.loading.set(false); }
  }
  protected cancelScreenSharePicker(): void { this.screenSharePickerOpen.set(false); }
  protected async startScreenShare(source: ScreenShareSource): Promise<void> {
    const room = this.voiceRoom;
    if (!room) return;
    this.loading.set(true); this.error.set('');
    try {
      await window.desktop.screenShare.selectSource(source.id);
      const includeAudio = this.systemAudioSupported && this.shareSystemAudio;
      const publication = await room.localParticipant.setScreenShareEnabled(true, { audio: includeAudio, systemAudio: includeAudio ? 'include' : 'exclude', contentHint: 'detail' });
      if (publication?.track) this.addVoiceVideo(publication.track, Track.Source.ScreenShare, this.user()?.username ?? 'Você', publication.trackSid);
      this.screenSharing.set(true);
      this.voiceMediaVisible.set(true);
      this.screenSharePickerOpen.set(false);
    } catch (error) { this.error.set(this.messageFor(error, 'Unable to start screen sharing.')); }
    finally { this.loading.set(false); }
  }
  protected async stopScreenShare(): Promise<void> {
    if (!this.voiceRoom) return;
    this.loading.set(true); this.error.set('');
    try {
      const track = this.voiceRoom.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
      await this.voiceRoom.localParticipant.setScreenShareEnabled(false);
      if (track) this.removeVoiceVideo(track);
      this.screenSharing.set(false);
    }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to stop screen sharing.')); }
    finally { this.loading.set(false); }
  }
  protected isSpeaking(participant: VoiceParticipant): boolean { return this.activeSpeakerIDs().includes(participant.identity); }
  protected voiceMembers(channelID: number): ServerMember[] { return this.members().filter((member) => member.voice_channel_id === channelID); }
  protected isVoiceMemberSpeaking(member: ServerMember): boolean { return this.activeSpeakerIDs().includes(String(member.id)); }
  protected isVoiceMemberMuted(member: ServerMember): boolean { return this.voiceParticipants().find((participant) => participant.identity === String(member.id))?.muted ?? false; }
  private removeVoiceAudio(): void { for (const audio of this.voiceAudioElements) audio.remove(); this.voiceAudioElements = []; }
  private addVoiceVideo(track: Track, source: Track.Source, name: string, trackSid = track.sid): void {
    if (this.voiceVideoElements.some((item) => item.track === track || (trackSid && item.trackSid === trackSid))) return;
    const element = document.createElement('article');
    element.className = 'voice-media-tile ' + (source === Track.Source.ScreenShare ? 'shared-screen-video' : 'camera-video');
    element.tabIndex = 0;
    element.title = 'Clique para destacar';
    const video = track.attach() as HTMLVideoElement;
    video.autoplay = true;
    video.playsInline = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectPosition = 'center';
    video.style.objectFit = source === Track.Source.ScreenShare ? 'contain' : 'cover';
    const label = document.createElement('span');
    label.textContent = source === Track.Source.ScreenShare ? `${name} está compartilhando` : name;
    element.append(video, label);
    this.voiceVideoElements.push({ track, trackSid, element, source });
    element.addEventListener('click', () => this.featureVoiceVideo(track));
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.featureVoiceVideo(track);
    });
    this.voiceMediaActive.set(true);
    const append = () => {
      document.getElementById('voice-media-grid')?.appendChild(element);
      this.updateVoiceMediaLayout();
    };
    setTimeout(append, 0);
    if (!this.featuredVoiceVideoTrack || source === Track.Source.ScreenShare) this.featureVoiceVideo(track);
  }
  private featureVoiceVideo(track: Track): void {
    this.featuredVoiceVideoTrack = this.featuredVoiceVideoTrack === track ? undefined : track;
    this.updateVoiceMediaLayout();
  }
  private updateVoiceMediaLayout(): void {
    const apply = () => {
      const grid = document.getElementById('voice-media-grid');
      if (!grid) return;
      for (const item of this.voiceVideoElements) {
        if (item.element.parentElement !== grid) grid.appendChild(item.element);
      }
      const featuredItem = this.voiceVideoElements.find((item) => item.track === this.featuredVoiceVideoTrack);
      if (this.featuredVoiceVideoTrack && !featuredItem) this.featuredVoiceVideoTrack = undefined;
      const secondaryItems = this.voiceVideoElements.filter((item) => item !== featuredItem);
      const hasFeatured = Boolean(featuredItem && secondaryItems.length > 0);
      grid.classList.toggle('has-featured', hasFeatured);
      grid.style.display = hasFeatured ? 'block' : 'grid';
      grid.style.position = 'relative';

      for (const item of this.voiceVideoElements) {
        const featured = item === featuredItem;
        item.element.classList.toggle('featured', featured);
        item.element.title = featured ? 'Clique para remover o destaque' : 'Clique para destacar';

        if (!hasFeatured) {
          item.element.style.removeProperty('position');
          item.element.style.removeProperty('width');
          item.element.style.removeProperty('height');
          item.element.style.removeProperty('top');
          item.element.style.removeProperty('bottom');
          item.element.style.removeProperty('left');
          item.element.style.removeProperty('right');
          item.element.style.removeProperty('order');
          continue;
        }

        item.element.style.position = 'absolute';
        item.element.style.width = 'auto';
        item.element.style.height = 'auto';
        item.element.style.top = '0';
        item.element.style.bottom = '0';
        item.element.style.left = '0';
        item.element.style.right = featured && hasFeatured ? 'calc(clamp(9rem, 16vw, 14rem) + .8rem)' : '0';
      }

      if (!hasFeatured) return;

      secondaryItems.forEach((item, index) => {
        const count = secondaryItems.length;
        item.element.style.top = `calc(${index} * 100% / ${count})`;
        item.element.style.bottom = 'auto';
        item.element.style.left = 'auto';
        item.element.style.right = '0';
        item.element.style.width = 'clamp(9rem, 16vw, 14rem)';
        item.element.style.height = `calc(100% / ${count} - .4rem)`;
      });
    };
    apply();
    setTimeout(apply, 0);
  }
  private removeVoiceVideo(track?: Track, trackSid = track?.sid): void {
    const hasTarget = Boolean(track || trackSid);
    const matching = hasTarget
      ? this.voiceVideoElements.filter((item) => item.track === track || Boolean(trackSid && item.trackSid === trackSid))
      : this.voiceVideoElements;
    for (const item of matching) {
      item.track.detach().forEach((element) => element.remove());
      item.element.remove();
    }
    this.voiceVideoElements = hasTarget ? this.voiceVideoElements.filter((item) => !matching.includes(item)) : [];
    if (matching.some((item) => item.track === this.featuredVoiceVideoTrack) || !hasTarget) {
      this.featuredVoiceVideoTrack = undefined;
    }
    const mediaActive = this.voiceVideoElements.length > 0;
    this.voiceMediaActive.set(mediaActive);
    if (!mediaActive) this.voiceMediaVisible.set(false);
    this.updateVoiceMediaLayout();
  }
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
  protected handleMessageComposerKeydown(event: KeyboardEvent, form: HTMLFormElement): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (!this.loading() && this.messageContent.trim()) form.requestSubmit();
  }
  protected async sendMessage(): Promise<void> { const channel = this.selectedChannel(); const content = this.messageContent.trim(); if (!channel || !content || this.loading()) return; this.loading.set(true); try { await window.desktop.messages.create(channel.id, content); this.messageContent = ''; await this.selectChannel(channel); } catch (error) { this.error.set(this.messageFor(error, 'Unable to send message.')); } finally { this.loading.set(false); } }
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
  private async refreshMessages(channel: Channel): Promise<void> {
    try {
      const page = await window.desktop.messages.list(channel.id);
      if (this.selectedChannel()?.id === channel.id) this.messages.set(page.messages.reverse());
    } catch { /* The next explicit channel selection will retry. */ }
  }
  private async refreshServerMembers(serverID: number): Promise<void> {
    try {
      const members = await window.desktop.servers.listMembers(serverID);
      if (this.selectedServer()?.id === serverID) this.members.set(members);
    } catch { /* The next explicit server selection will retry. */ }
  }
  private async refreshBackendStatus(): Promise<void> { try { const health = await window.desktop.backend.getHealth(); this.status.set(health.status === 'alive' ? 'available' : 'unavailable'); } catch { this.status.set('unavailable'); } }
  private messageFor(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback; }
}

type VoiceParticipant = { identity: string; name: string; muted: boolean };
type ScreenShareSource = { id: string; name: string; thumbnail: string };
type ServerMember = { id: number; username: string; role: 'owner' | 'member'; online: boolean; voice_channel_id: number | null };
