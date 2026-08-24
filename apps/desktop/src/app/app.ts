import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, OnInit, Renderer2, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Room, RoomEvent, Track } from 'livekit-client';

type BackendState = 'checking' | 'available' | 'unavailable';
type User = { username: string; email: string; role: string };

@Component({
  selector: 'app-root', changeDetection: ChangeDetectionStrategy.OnPush, imports: [FormsModule], templateUrl: './app.html', styleUrl: './app.css',
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly renderer = inject(Renderer2);
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
  protected readonly availablePeerMedia = signal<PeerMediaAvailability[]>([]);
  protected readonly featuredPeerMediaID = signal<string | null>(null);
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
  private removeWebRTCSignalListener?: () => void;
  private voiceRoom?: Room;
  private voiceAudioElements: HTMLAudioElement[] = [];
  private peerMediaElements: PeerMediaElement[] = [];
  private peerMediaAudioElements = new Map<string, HTMLAudioElement>();
  private voiceAudioContext?: AudioContext;
  private peerMediaConfiguration?: RTCConfiguration;
  private localPeerMedia = new Map<PeerMediaKind, MediaStream>();
  private peerConnections = new Map<string, PeerMediaConnection>();
  private pendingPeerCandidates = new Map<string, PendingPeerCandidates>();

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
      if (voiceChannel) void this.restorePeerMediaAfterRealtimeReconnect(voiceChannel);
    });
    this.removeRealtimeMessageListener = window.desktop.realtime.onMessageCreated((message) => {
      if (this.selectedChannel()?.id !== message.channel_id) return;
      this.messages.update((items) => items.some((item) => item.id === message.id) ? items : [...items, message]);
    });
    this.removeRealtimePresenceListener = window.desktop.realtime.onPresenceChanged((presence) => {
      this.members.update((members) => members.map((member) => member.id === presence.user_id ? { ...member, online: presence.online } : member));
    });
    this.removeRealtimeVoicePresenceListener = window.desktop.realtime.onVoicePresenceChanged((presence) => {
      const voiceChannel = this.voiceChannel();
      if (voiceChannel?.server_id === presence.server_id && presence.user_id !== this.currentUserID() && presence.channel_id !== voiceChannel.id) {
        this.removePeerMediaForUser(presence.user_id, voiceChannel.id);
      }
      if (this.selectedServer()?.id !== presence.server_id) return;
      this.members.update((members) => members.map((member) => member.id === presence.user_id ? { ...member, voice_channel_id: presence.channel_id } : member));
    });
    this.removeWebRTCSignalListener = window.desktop.realtime.onWebRTCSignal((signal) => {
      void this.handlePeerMediaSignal(signal).catch((error) => console.error('[webrtc] incoming signal failed', error instanceof Error ? error.message : String(error)));
    });
  }
  ngOnDestroy(): void {
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    this.removeSessionExpiredListener?.();
    this.removeRealtimeConnectedListener?.();
    this.removeRealtimeMessageListener?.();
    this.removeRealtimePresenceListener?.();
    this.removeRealtimeVoicePresenceListener?.();
    this.removeWebRTCSignalListener?.();
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
      room.on(RoomEvent.TrackMuted, () => {
        refreshParticipants();
      });
      room.on(RoomEvent.TrackUnmuted, () => {
        refreshParticipants();
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
        this.closePeerMedia();
        void window.desktop.voice.setPresence(null).catch(() => undefined);
      });

      await room.connect(session.url, session.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      this.voiceRoom = room;
      this.voiceChannel.set(channel);
      await window.desktop.voice.setPresence(channel.id);
      refreshParticipants();
      await this.queryPeerMedia(channel);
      this.playVoiceSound('join');
    }
    catch (error) { await this.leaveVoiceChannel(); this.error.set(this.messageFor(error, 'Unable to join voice channel.')); }
    finally { this.loading.set(false); }
  }
  protected async leaveVoiceChannel(): Promise<void> {
    const room = this.voiceRoom;
    const channel = this.voiceChannel();
    if (channel) {
      const publishedKinds = (['camera', 'screen'] as const).filter((kind) => this.localPeerMedia.has(kind));
      await Promise.all(publishedKinds.map((kind) => this.announcePeerMedia(kind, 'media.unavailable'))).catch((error) => {
        console.warn('[webrtc] unable to announce media before leaving', error instanceof Error ? error.message : String(error));
      });
    }
    this.voiceRoom = undefined;
    this.voiceChannel.set(null);
    this.voiceParticipants.set([]);
    this.activeSpeakerIDs.set([]);
    this.microphoneMuted.set(false);
    this.screenSharing.set(false);
    this.cameraEnabled.set(false);
    this.screenSharePickerOpen.set(false);
    this.voiceMediaVisible.set(false);
    this.removeVoiceAudio();
    this.closePeerMedia();
    try {
      if (room) {
        this.playVoiceSound('leave');
        await room.disconnect();
      }
    } finally {
      try { await window.desktop.voice.setPresence(null); } catch { /* The WebSocket disconnect cleanup remains the fallback. */ }
    }
  }
  protected async toggleMicrophone(): Promise<void> { if (!this.voiceRoom) return; const muted = !this.microphoneMuted(); await this.voiceRoom.localParticipant.setMicrophoneEnabled(!muted); this.microphoneMuted.set(muted); this.playVoiceSound(muted ? 'mute' : 'unmute'); }
  protected async toggleCamera(): Promise<void> {
    if (!this.voiceRoom) return;
    this.loading.set(true); this.error.set('');
    try {
      const enabled = !this.cameraEnabled();
      if (enabled) await this.publishPeerMedia('camera', await navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
      else await this.stopLocalPeerMedia('camera');
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
    if (!this.voiceRoom) return;
    this.loading.set(true); this.error.set('');
    try {
      console.info('[webrtc] selected display source', JSON.stringify({ kind: source.kind, name: source.name }));
      await window.desktop.screenShare.selectSource(source.id);
      const includeAudio = this.systemAudioSupported && this.shareSystemAudio;
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: includeAudio });
      stream.getVideoTracks().forEach((track) => { track.contentHint = 'detail'; });
      await this.publishPeerMedia('screen', stream);
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
      await this.stopLocalPeerMedia('screen');
      this.screenSharing.set(false);
    }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to stop screen sharing.')); }
    finally { this.loading.set(false); }
  }
  protected peerMediaForCurrentChannel(): PeerMediaAvailability[] {
    const channel = this.voiceChannel();
    return channel ? this.availablePeerMedia().filter((media) => media.channelID === channel.id) : [];
  }
  protected screenShareForMember(userID: number, channelID: number): PeerMediaAvailability | undefined {
    return this.availablePeerMedia().find((media) => media.channelID === channelID && media.userID === userID && media.kind === 'screen');
  }
  protected cameraForMember(userID: number, channelID: number): PeerMediaAvailability | undefined {
    return this.availablePeerMedia().find((media) => media.channelID === channelID && media.userID === userID && media.kind === 'camera');
  }
  protected isWatchingPeerMedia(media: PeerMediaAvailability): boolean {
    return this.findPeerConnection('incoming', media.userID, media.kind) !== undefined;
  }
  protected async watchPeerMedia(media: PeerMediaAvailability): Promise<void> {
    const channel = this.voiceChannel();
    if (!channel || media.channelID !== channel.id) return;
    if (this.isWatchingPeerMedia(media)) {
      console.info('[webrtc] stopping remote media', { userID: media.userID, kind: media.kind, channelID: channel.id });
      this.closePeerConnections('incoming', media.userID, media.kind);
      await this.sendPeerSignal(media.userID, 'media.unwatch', { kind: media.kind });
      return;
    }
    console.info('[webrtc] requesting remote media', { userID: media.userID, kind: media.kind, channelID: channel.id });
    await this.sendPeerSignal(media.userID, 'media.watch', { kind: media.kind });
  }
  private async publishPeerMedia(kind: PeerMediaKind, stream: MediaStream): Promise<void> {
    console.info('[webrtc] publishing local media', { kind, videoTracks: stream.getVideoTracks().length, audioTracks: stream.getAudioTracks().length });
    await this.stopLocalPeerMedia(kind);
    this.localPeerMedia.set(kind, stream);
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (this.localPeerMedia.get(kind) === stream) void this.stopLocalPeerMedia(kind);
      }, { once: true });
    });
    this.addPeerMediaVideo(`local:${kind}`, stream, kind, this.user()?.username ?? 'You');
    await this.announcePeerMedia(kind, 'media.available');
  }
  private async stopLocalPeerMedia(kind: PeerMediaKind): Promise<void> {
    const stream = this.localPeerMedia.get(kind);
    if (!stream) return;
    console.info('[webrtc] stopping local media', { kind });
    this.localPeerMedia.delete(kind);
    stream.getTracks().forEach((track) => track.stop());
    if (kind === 'camera') this.cameraEnabled.set(false);
    if (kind === 'screen') this.screenSharing.set(false);
    this.removePeerMediaVideo(`local:${kind}`);
    for (const connection of [...this.peerConnections.values()]) {
      if (connection.direction === 'outgoing' && connection.kind === kind) this.closePeerConnection(connection.sessionID);
    }
    await this.announcePeerMedia(kind, 'media.unavailable');
  }
  private async queryPeerMedia(channel: Channel): Promise<void> {
    console.info('[webrtc] querying media availability', { channelID: channel.id });
    await Promise.all(this.voiceMembers(channel.id)
      .filter((member) => member.id !== this.currentUserID())
      .map((member) => this.sendPeerSignal(member.id, 'media.query', {})));
  }
  private async announcePeerMedia(kind: PeerMediaKind, signalKind: 'media.available' | 'media.unavailable', recipientID?: number): Promise<void> {
    const channel = this.voiceChannel();
    if (!channel) return;
    const recipients = recipientID ? [recipientID] : this.voiceMembers(channel.id)
      .map((member) => member.id).filter((id) => id !== this.currentUserID());
    await Promise.all(recipients.map((id) => this.sendPeerSignal(id, signalKind, { kind })));
  }
  private async sendPeerSignal(toUserID: number, kind: PeerSignalKind, payload: unknown, sessionID?: string): Promise<void> {
    const channel = this.voiceChannel();
    if (!channel) return;
    console.info('[webrtc] renderer sends signal', { channelID: channel.id, toUserID, kind, sessionID });
    await window.desktop.realtime.sendWebRTCSignal({ channel_id: channel.id, to_user_id: toUserID, kind, session_id: sessionID, payload });
  }
  private async handlePeerMediaSignal(signal: IncomingPeerSignal): Promise<void> {
    const channel = this.voiceChannel();
    if (!channel || signal.channel_id !== channel.id || signal.from_user_id === this.currentUserID()) return;
    if (signal.kind === 'media.query') {
      console.info('[webrtc] responding to media availability query', JSON.stringify({ fromUserID: signal.from_user_id, channelID: signal.channel_id }));
      if (this.localPeerMedia.has('camera')) await this.announcePeerMedia('camera', 'media.available', signal.from_user_id);
      if (this.localPeerMedia.has('screen')) await this.announcePeerMedia('screen', 'media.available', signal.from_user_id);
      return;
    }
    const kind = peerMediaKind(signal.payload);
    if (!kind) {
      console.warn('[webrtc] ignored signal without a valid media kind', JSON.stringify({ channelID: signal.channel_id, fromUserID: signal.from_user_id, kind: signal.kind, payloadType: typeof signal.payload, payloadKeys: payloadKeys(signal.payload) }));
      return;
    }
    console.info('[webrtc] renderer received signal', JSON.stringify({ channelID: signal.channel_id, fromUserID: signal.from_user_id, kind: signal.kind, mediaKind: kind }));
    if (signal.kind === 'media.available') {
      const name = this.members().find((member) => member.id === signal.from_user_id)?.username ?? `User ${signal.from_user_id}`;
      this.availablePeerMedia.update((items) => items.some((item) => item.channelID === signal.channel_id && item.userID === signal.from_user_id && item.kind === kind)
        ? items : [...items, { channelID: channel.id, userID: signal.from_user_id, name, kind }]);
      console.info('[webrtc] remote media is available', { fromUserID: signal.from_user_id, kind });
      return;
    }
    if (signal.kind === 'media.unavailable') {
      this.availablePeerMedia.update((items) => items.filter((item) => item.channelID !== signal.channel_id || item.userID !== signal.from_user_id || item.kind !== kind));
      this.closePeerConnections('incoming', signal.from_user_id, kind);
      return;
    }
    if (signal.kind === 'media.unwatch') { this.closePeerConnections('outgoing', signal.from_user_id, kind); return; }
    if (signal.kind === 'media.watch') { await this.startPeerMediaOffer(signal.from_user_id, kind); return; }
    const sessionID = validPeerSessionID(signal.session_id);
    if (!sessionID) {
      console.warn('[webrtc] ignored negotiation signal without a valid session ID', JSON.stringify({ fromUserID: signal.from_user_id, kind, signalKind: signal.kind }));
      return;
    }
    if (signal.kind === 'offer') {
      const description = peerSessionDescription(signal.payload);
      if (!description) {
        console.warn('[webrtc] ignored offer with invalid session description', JSON.stringify({ fromUserID: signal.from_user_id, kind, payloadKeys: payloadKeys(signal.payload) }));
        return;
      }
      const stale = this.findPeerConnection('incoming', signal.from_user_id, kind);
      if (stale && stale.sessionID !== sessionID) this.closePeerConnection(stale.sessionID);
      console.info('[webrtc] applying remote offer', JSON.stringify({ fromUserID: signal.from_user_id, kind, sessionID }));
      const connection = await this.getPeerConnection(sessionID, 'incoming', signal.from_user_id, kind);
      await connection.connection.setRemoteDescription(description);
      console.info('[webrtc] remote offer applied', JSON.stringify({ fromUserID: signal.from_user_id, kind, sessionID }));
      await this.flushPeerCandidates(connection);
      const answer = await connection.connection.createAnswer();
      await connection.connection.setLocalDescription(answer);
      console.info('[webrtc] local answer created', JSON.stringify({ toUserID: signal.from_user_id, kind, sessionID }));
      await this.sendPeerSignal(signal.from_user_id, 'answer', { kind, description: serializedSessionDescription(connection.connection.localDescription) }, sessionID);
      return;
    }
    if (signal.kind === 'answer') {
      const description = peerSessionDescription(signal.payload);
      const connection = this.peerConnections.get(sessionID);
      if (!description) {
        console.warn('[webrtc] ignored answer with invalid session description', JSON.stringify({ fromUserID: signal.from_user_id, kind, payloadKeys: payloadKeys(signal.payload) }));
        return;
      }
      if (connection?.direction === 'outgoing' && connection.remoteUserID === signal.from_user_id && connection.kind === kind) {
        await connection.connection.setRemoteDescription(description);
        await this.flushPeerCandidates(connection);
      } else {
        console.warn('[webrtc] ignored answer for an unknown peer session', JSON.stringify({ fromUserID: signal.from_user_id, kind, sessionID }));
      }
      return;
    }
    if (signal.kind === 'ice') {
      const candidate = peerIceCandidate(signal.payload);
      if (!candidate) return;
      const connection = this.peerConnections.get(sessionID);
      if (!connection) {
        this.queuePeerCandidate(sessionID, signal.from_user_id, kind, candidate);
      } else if (connection.remoteUserID !== signal.from_user_id || connection.kind !== kind) {
        console.warn('[webrtc] ignored ICE candidate with mismatched peer session metadata', JSON.stringify({ fromUserID: signal.from_user_id, kind, sessionID }));
      } else if (!connection.connection.remoteDescription) {
        if (connection.pendingCandidates.length < maxPendingCandidatesPerSession) connection.pendingCandidates.push(candidate);
      } else {
        await connection.connection.addIceCandidate(candidate).catch(() => undefined);
      }
    }
  }
  private async startPeerMediaOffer(userID: number, kind: PeerMediaKind): Promise<void> {
    const stream = this.localPeerMedia.get(kind);
    if (!stream) {
      console.warn('[webrtc] media requested but it is not published locally', JSON.stringify({ userID, kind }));
      return;
    }
    const stale = this.findPeerConnection('outgoing', userID, kind);
    if (stale) {
      console.warn('[webrtc] replacing stale outgoing peer connection', JSON.stringify({ userID, kind }));
      this.closePeerConnection(stale.sessionID);
    }
    const sessionID = crypto.randomUUID();
    console.info('[webrtc] creating offer', { userID, kind, sessionID });
    const peer = await this.getPeerConnection(sessionID, 'outgoing', userID, kind);
    stream.getTracks().forEach((track) => peer.connection.addTrack(track, stream));
    await peer.connection.setLocalDescription(await peer.connection.createOffer());
    await this.sendPeerSignal(userID, 'offer', { kind, description: serializedSessionDescription(peer.connection.localDescription) }, sessionID);
  }
  private async getPeerConnection(sessionID: string, direction: PeerDirection, remoteUserID: number, kind: PeerMediaKind): Promise<PeerMediaConnection> {
    const existing = this.peerConnections.get(sessionID);
    if (existing) {
      if (existing.direction !== direction || existing.remoteUserID !== remoteUserID || existing.kind !== kind) throw new Error('WebRTC session metadata mismatch.');
      return existing;
    }
    console.info('[webrtc] loading peer connection configuration', JSON.stringify({ sessionID, direction, remoteUserID, kind }));
    const configuration = this.peerMediaConfiguration ??= await window.desktop.voice.getWebRTCConfiguration();
    console.info('[webrtc] peer connection configuration loaded', JSON.stringify({ sessionID, direction, remoteUserID, kind, iceServerCount: configuration.iceServers?.length ?? 0 }));
    const conflicting = this.findPeerConnection(direction, remoteUserID, kind);
    if (conflicting && conflicting.sessionID !== sessionID) this.closePeerConnection(conflicting.sessionID);
    const connection = new RTCPeerConnection(configuration);
    const queued = this.pendingPeerCandidates.get(sessionID);
    const pendingCandidates = queued?.remoteUserID === remoteUserID && queued.kind === kind ? queued.candidates : [];
    this.pendingPeerCandidates.delete(sessionID);
    const peer: PeerMediaConnection = { sessionID, connection, direction, remoteUserID, kind, pendingCandidates };
    this.peerConnections.set(sessionID, peer);
    console.info('[webrtc] peer connection created', { sessionID, direction, remoteUserID, kind });
    connection.onicecandidate = (event) => {
      if (event.candidate) void this.sendPeerSignal(remoteUserID, 'ice', { kind, candidate: event.candidate.toJSON() }, sessionID);
    };
    connection.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      if (event.track.kind === 'audio') {
        console.info('[webrtc] remote audio track received', { remoteUserID, kind });
        const audioID = `remote:${remoteUserID}:${kind}:audio`;
        if (!this.peerMediaAudioElements.has(audioID)) {
          const audio = document.createElement('audio');
          audio.autoplay = true; audio.srcObject = stream;
          document.body.appendChild(audio);
          this.peerMediaAudioElements.set(audioID, audio);
        }
        return;
      }
      if (event.track.kind !== 'video') return;
      console.info('[webrtc] remote video track received', { remoteUserID, kind });
      const name = this.members().find((member) => member.id === remoteUserID)?.username ?? `User ${remoteUserID}`;
      const mediaID = `remote:${remoteUserID}:${kind}`;
      const channel = this.voiceChannel();
      const media = channel ? { channelID: channel.id, userID: remoteUserID, name, kind } : undefined;
      this.addPeerMediaVideo(mediaID, stream, kind, name, media);
      event.track.addEventListener('ended', () => {
        const current = this.peerMediaElements.find((item) => item.id === mediaID)?.video.srcObject;
        if (current instanceof MediaStream && current.getTracks().includes(event.track)) this.removePeerMediaVideo(mediaID);
      }, { once: true });
    };
    connection.onconnectionstatechange = () => {
      console.info('[webrtc] peer connection state', { sessionID, direction, remoteUserID, kind, state: connection.connectionState });
      if (connection.connectionState === 'connected') {
        if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
        peer.disconnectTimer = undefined;
      } else if (connection.connectionState === 'disconnected' && !peer.disconnectTimer) {
        peer.disconnectTimer = setTimeout(() => {
          peer.disconnectTimer = undefined;
          const current = this.peerConnections.get(sessionID);
          if (current === peer && ['disconnected', 'failed'].includes(connection.connectionState)) this.closePeerConnection(sessionID);
        }, peerDisconnectGraceMilliseconds);
      } else if (connection.connectionState === 'failed') {
        this.closePeerConnection(sessionID);
      } else if (connection.connectionState === 'closed') {
        this.closePeerConnection(sessionID, false);
      }
    };
    return peer;
  }
  private async flushPeerCandidates(peer: PeerMediaConnection): Promise<void> {
    const candidates = peer.pendingCandidates.splice(0);
    for (const candidate of candidates) await peer.connection.addIceCandidate(candidate).catch(() => undefined);
  }
  private async restorePeerMediaAfterRealtimeReconnect(channel: Channel): Promise<void> {
    try {
      await window.desktop.voice.setPresence(channel.id);
      if (this.voiceChannel()?.id !== channel.id) return;
      const server = this.selectedServer();
      if (server?.id === channel.server_id) {
        await this.refreshServerMembers(server.id);
        this.reconcilePeerMediaMembers(channel.id);
      }
      if (this.voiceChannel()?.id !== channel.id) return;
      await Promise.all((['camera', 'screen'] as const)
        .filter((kind) => this.localPeerMedia.has(kind))
        .map((kind) => this.announcePeerMedia(kind, 'media.available')));
      await this.queryPeerMedia(channel);
    } catch (error) {
      console.warn('[webrtc] unable to restore peer media after realtime reconnect', error instanceof Error ? error.message : String(error));
    }
  }
  private removePeerMediaForUser(userID: number, channelID: number): void {
    this.availablePeerMedia.update((items) => items.filter((item) => item.channelID !== channelID || item.userID !== userID));
    for (const peer of [...this.peerConnections.values()]) {
      if (peer.remoteUserID === userID) this.closePeerConnection(peer.sessionID);
    }
    this.clearQueuedPeerCandidates(userID);
  }
  private reconcilePeerMediaMembers(channelID: number): void {
    const activeUserIDs = new Set(this.voiceMembers(channelID).map((member) => member.id));
    const knownRemoteUserIDs = new Set([
      ...this.availablePeerMedia().filter((media) => media.channelID === channelID).map((media) => media.userID),
      ...[...this.peerConnections.values()].map((peer) => peer.remoteUserID),
    ]);
    for (const userID of knownRemoteUserIDs) {
      if (!activeUserIDs.has(userID)) this.removePeerMediaForUser(userID, channelID);
    }
  }
  private closePeerConnection(sessionID: string, close = true): void {
    const peer = this.peerConnections.get(sessionID);
    if (!peer) return;
    this.peerConnections.delete(sessionID);
    this.pendingPeerCandidates.delete(sessionID);
    if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
    if (close) peer.connection.close();
    if (peer.direction === 'incoming' && !this.findPeerConnection('incoming', peer.remoteUserID, peer.kind)) {
      this.removePeerMediaVideo(`remote:${peer.remoteUserID}:${peer.kind}`);
      const audioID = `remote:${peer.remoteUserID}:${peer.kind}:audio`;
      this.peerMediaAudioElements.get(audioID)?.remove();
      this.peerMediaAudioElements.delete(audioID);
    }
  }
  private closePeerConnections(direction: PeerDirection, remoteUserID: number, kind: PeerMediaKind): void {
    for (const peer of [...this.peerConnections.values()]) {
      if (peer.direction === direction && peer.remoteUserID === remoteUserID && peer.kind === kind) this.closePeerConnection(peer.sessionID);
    }
  }
  private findPeerConnection(direction: PeerDirection, remoteUserID: number, kind: PeerMediaKind): PeerMediaConnection | undefined {
    return [...this.peerConnections.values()].find((peer) => peer.direction === direction && peer.remoteUserID === remoteUserID && peer.kind === kind);
  }
  private queuePeerCandidate(sessionID: string, remoteUserID: number, kind: PeerMediaKind, candidate: RTCIceCandidateInit): void {
    const existing = this.pendingPeerCandidates.get(sessionID);
    if (existing) {
      if (existing.remoteUserID !== remoteUserID || existing.kind !== kind || existing.candidates.length >= maxPendingCandidatesPerSession) return;
      existing.candidates.push(candidate);
      return;
    }
    if (this.pendingPeerCandidates.size >= maxPendingPeerSessions) {
      const oldestSessionID = this.pendingPeerCandidates.keys().next().value as string | undefined;
      if (oldestSessionID) this.pendingPeerCandidates.delete(oldestSessionID);
    }
    this.pendingPeerCandidates.set(sessionID, { remoteUserID, kind, candidates: [candidate] });
  }
  private clearQueuedPeerCandidates(remoteUserID: number, kind?: PeerMediaKind): void {
    for (const [sessionID, queued] of this.pendingPeerCandidates) {
      if (queued.remoteUserID === remoteUserID && (!kind || queued.kind === kind)) this.pendingPeerCandidates.delete(sessionID);
    }
  }
  private closePeerMedia(): void {
    for (const kind of ['camera', 'screen'] as const) {
      const stream = this.localPeerMedia.get(kind);
      stream?.getTracks().forEach((track) => track.stop());
    }
    this.localPeerMedia.clear();
    for (const peer of [...this.peerConnections.values()]) this.closePeerConnection(peer.sessionID);
    this.pendingPeerCandidates.clear();
    for (const item of this.peerMediaElements) item.element.remove();
    this.peerMediaElements = [];
    for (const audio of this.peerMediaAudioElements.values()) audio.remove();
    this.peerMediaAudioElements.clear();
    this.availablePeerMedia.set([]);
    this.featuredPeerMediaID.set(null);
    this.voiceMediaActive.set(false);
    this.updatePeerMediaLayout();
  }
  private addPeerMediaVideo(id: string, stream: MediaStream, kind: PeerMediaKind, name: string, remoteMedia?: PeerMediaAvailability): void {
    const existing = this.peerMediaElements.find((item) => item.id === id);
    if (existing) {
      existing.video.srcObject = stream;
      existing.label.textContent = kind === 'screen' ? `${name} está compartilhando` : name;
      return;
    }
    const element = this.renderer.createElement('article') as HTMLElement;
    element.className = `voice-media-tile ${kind === 'screen' ? 'shared-screen-video' : 'camera-video'}`;
    element.dataset['mediaId'] = id;
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', kind === 'screen' ? `Tela compartilhada por ${name}` : `Câmera de ${name}`);
    const video = this.renderer.createElement('video') as HTMLVideoElement;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    video.addEventListener('loadedmetadata', () => {
      console.info('[webrtc] media dimensions', JSON.stringify({ id, kind, videoWidth: video.videoWidth, videoHeight: video.videoHeight }));
    });
    const label = this.renderer.createElement('span') as HTMLSpanElement;
    label.textContent = kind === 'screen' ? `${name} está compartilhando` : name;
    const highlightButton = this.renderer.createElement('button') as HTMLButtonElement;
    highlightButton.type = 'button';
    highlightButton.className = 'voice-media-highlight';
    highlightButton.addEventListener('click', () => this.togglePeerMediaFeatured(element.dataset['mediaId'] ?? id));
    element.append(video, highlightButton, label);
    if (remoteMedia) element.append(this.createStopWatchingOverlay(remoteMedia));
    this.peerMediaElements.push({ id, element, video, label, highlightButton });
    this.voiceMediaActive.set(true); this.voiceMediaVisible.set(true);
    setTimeout(() => this.updatePeerMediaLayout(), 0);
  }
  private createStopWatchingOverlay(media: PeerMediaAvailability): HTMLElement {
    const controls = this.renderer.createElement('div') as HTMLElement;
    controls.className = 'voice-media-controls';
    const button = this.renderer.createElement('button') as HTMLButtonElement;
    button.type = 'button';
    button.className = 'voice-media-stop';
    const mediaLabel = `${media.kind === 'screen' ? 'tela' : 'câmera'} de ${media.name}`;
    button.setAttribute('aria-label', `Parar de assistir ${mediaLabel}`);
    button.title = `Parar de assistir ${mediaLabel}`;
    const icon = this.renderer.createElement('svg', 'svg') as SVGElement;
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    for (const data of ['M3 3l18 18', 'M10.6 10.6a2 2 0 0 0 2.8 2.8', 'M9.9 4.2A10.5 10.5 0 0 1 12 4c5 0 9 4.5 10 8a12.7 12.7 0 0 1-2.1 3.8', 'M6.6 6.6C4.2 8.2 2.7 10.4 2 12c1.1 3.5 5 8 10 8 1.3 0 2.5-.3 3.6-.8']) {
      const path = this.renderer.createElement('path', 'svg') as SVGPathElement;
      path.setAttribute('d', data);
      icon.appendChild(path);
    }
    const text = this.renderer.createElement('span') as HTMLSpanElement;
    text.className = 'voice-media-stop-label';
    text.textContent = 'Parar de assistir';
    button.append(icon, text);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.watchPeerMedia(media);
    });
    controls.appendChild(button);
    return controls;
  }
  private removePeerMediaVideo(id: string): void {
    const item = this.peerMediaElements.find((candidate) => candidate.id === id);
    item?.element.remove();
    this.peerMediaElements = this.peerMediaElements.filter((candidate) => candidate.id !== id);
    if (this.featuredPeerMediaID() === id || this.peerMediaElements.length < 2) this.featuredPeerMediaID.set(null);
    this.voiceMediaActive.set(this.peerMediaElements.length > 0);
    this.updatePeerMediaLayout();
  }
  private togglePeerMediaFeatured(id: string): void {
    if (this.peerMediaElements.length < 2 || !this.peerMediaElements.some((item) => item.id === id)) {
      this.featuredPeerMediaID.set(null);
    } else {
      this.featuredPeerMediaID.update((current) => current === id ? null : id);
    }
    console.info('[webrtc] media highlight changed', JSON.stringify({ clickedMediaID: id, featuredMediaID: this.featuredPeerMediaID() }));
    this.updatePeerMediaLayout();
  }
  private updatePeerMediaLayout(): void {
    const apply = () => {
      const layout = document.getElementById('voice-media-layout');
      const grid = document.getElementById('voice-media-grid');
      if (!layout || !grid) return;
      const featured = this.peerMediaElements.find((item) => item.id === this.featuredPeerMediaID());
      if ((!featured && this.featuredPeerMediaID()) || this.peerMediaElements.length < 2) this.featuredPeerMediaID.set(null);
      const hasFeatured = Boolean(featured && this.peerMediaElements.length > 1);
      grid.style.setProperty('--voice-media-secondary-count', String(Math.max(1, this.peerMediaElements.length - 1)));
      for (const item of this.peerMediaElements) {
        if (item.element.parentElement !== grid) grid.appendChild(item.element);
        const selected = hasFeatured && item === featured;
        item.element.classList.toggle('featured', selected);
        item.highlightButton.title = selected ? 'Clique para remover o destaque' : 'Clique para destacar';
        item.highlightButton.setAttribute('aria-label', selected ? 'Remover destaque desta transmissão' : 'Destacar esta transmissão');
        item.highlightButton.setAttribute('aria-pressed', String(selected));
      }
    };
    apply();
    setTimeout(apply, 0);
  }
  private currentUserID(): number { return this.members().find((member) => member.username === this.user()?.username)?.id ?? 0; }
  protected isSpeaking(participant: VoiceParticipant): boolean { return this.activeSpeakerIDs().includes(participant.identity); }
  protected voiceMembers(channelID: number): ServerMember[] { return this.members().filter((member) => member.voice_channel_id === channelID); }
  protected isVoiceMemberSpeaking(member: ServerMember): boolean { return this.activeSpeakerIDs().includes(String(member.id)); }
  protected isVoiceMemberMuted(member: ServerMember): boolean { return this.voiceParticipants().find((participant) => participant.identity === String(member.id))?.muted ?? false; }
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
type ScreenShareSource = { id: string; name: string; thumbnail: string; kind: 'screen' | 'window' };
type PeerMediaKind = 'camera' | 'screen';
type PeerDirection = 'incoming' | 'outgoing';
type PeerSignalKind = 'offer' | 'answer' | 'ice' | 'media.available' | 'media.unavailable' | 'media.query' | 'media.watch' | 'media.unwatch';
type IncomingPeerSignal = { channel_id: number; from_user_id: number; kind: PeerSignalKind; session_id?: string; payload: unknown };
type PeerMediaAvailability = { channelID: number; userID: number; name: string; kind: PeerMediaKind };
type PeerMediaConnection = { sessionID: string; connection: RTCPeerConnection; direction: PeerDirection; remoteUserID: number; kind: PeerMediaKind; pendingCandidates: RTCIceCandidateInit[]; disconnectTimer?: ReturnType<typeof setTimeout> };
type PendingPeerCandidates = { remoteUserID: number; kind: PeerMediaKind; candidates: RTCIceCandidateInit[] };
type PeerMediaElement = { id: string; element: HTMLElement; video: HTMLVideoElement; label: HTMLSpanElement; highlightButton: HTMLButtonElement };
type ServerMember = { id: number; username: string; role: 'owner' | 'member'; online: boolean; voice_channel_id: number | null };

const peerSessionIDPattern = /^[A-Za-z0-9_-]{1,64}$/;
const maxPendingPeerSessions = 32;
const maxPendingCandidatesPerSession = 64;
const peerDisconnectGraceMilliseconds = 10_000;

function validPeerSessionID(sessionID: unknown): string | undefined {
  return typeof sessionID === 'string' && peerSessionIDPattern.test(sessionID) ? sessionID : undefined;
}

function peerMediaKind(payload: unknown): PeerMediaKind | undefined {
  const value = parsedSignalPayload(payload);
  if (!value || typeof value !== 'object') return undefined;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'camera' || kind === 'screen' ? kind : undefined;
}
function peerSessionDescription(payload: unknown): RTCSessionDescriptionInit | undefined {
  const value = parsedSignalPayload(payload);
  if (!value || typeof value !== 'object') return undefined;
  const description = (value as { description?: RTCSessionDescriptionInit }).description;
  return description && typeof description.type === 'string' && typeof description.sdp === 'string' ? description : undefined;
}
function peerIceCandidate(payload: unknown): RTCIceCandidateInit | undefined {
  const value = parsedSignalPayload(payload);
  if (!value || typeof value !== 'object') return undefined;
  const candidate = (value as { candidate?: RTCIceCandidateInit }).candidate;
  return candidate && typeof candidate.candidate === 'string' ? candidate : undefined;
}
function serializedSessionDescription(description: RTCSessionDescription | null): RTCSessionDescriptionInit {
  if (!description?.type || !description.sdp) throw new Error('WebRTC did not produce a local session description.');
  return { type: description.type, sdp: description.sdp };
}
function parsedSignalPayload(payload: unknown): unknown {
  if (typeof payload !== 'string') return payload;
  try { return JSON.parse(payload) as unknown; } catch { return undefined; }
}
function payloadKeys(payload: unknown): string[] {
  const value = parsedSignalPayload(payload);
  return value && typeof value === 'object' ? Object.keys(value) : [];
}
