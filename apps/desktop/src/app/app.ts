import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, OnInit, Renderer2, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LocalAudioTrack, Room, RoomEvent, Track } from 'livekit-client';
import type { AudioCaptureOptions } from 'livekit-client';
import { deriveCallMiniPreviewModel, type CallMediaDescriptor } from './call-mini-preview-state';
import { ParticipantAudioService, type ParticipantAudioPreference } from './participant-audio.service';
import { MicProcessor, createMicWorkletNode, decibelsToLinearGain } from './rnnoise/mic-processor';

type BackendState = 'checking' | 'available' | 'unavailable';
type User = { id: number; username: string; email: string; role: string; avatar_id: string | null };

@Component({
  selector: 'app-root', changeDetection: ChangeDetectionStrategy.OnPush, imports: [FormsModule], templateUrl: './app.html', styleUrl: './app.css',
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly renderer = inject(Renderer2);
  private readonly dismissedUpdateVersion = signal<string | null>(null);
  private readonly peerMediaRevision = signal(0);
  private readonly messageList = viewChild<ElementRef<HTMLElement>>('messageList');

  constructor() {
    effect(() => {
      this.messages();
      const element = this.messageList()?.nativeElement;
      if (element) requestAnimationFrame(() => { element.scrollTop = element.scrollHeight; });
    });
    effect(() => {
      this.miniCallPreview();
      this.peerMediaRevision();
      this.schedulePeerMediaLayout();
    });
  }
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
  protected readonly updaterStatus = signal<DesktopUpdaterStatus | null>(null);
  protected readonly updaterNoticeVisible = computed(() => {
    const status = this.updaterStatus();
    if (!status || !['update-available', 'download-progress', 'update-downloaded'].includes(status.state)) return false;
    return !('version' in status && status.version === this.dismissedUpdateVersion());
  });
  protected readonly loading = signal(false);
  protected readonly installingUpdate = signal(false);
  protected readonly leaveConfirmationOpen = signal(false);
  protected readonly voiceChannel = signal<Channel | null>(null);
  protected readonly voiceParticipants = signal<VoiceParticipant[]>([]);
  protected readonly activeSpeakerIDs = signal<string[]>([]);
  protected readonly microphoneMuted = signal(false);
  protected readonly screenSharePickerOpen = signal(false);
  protected readonly screenShareSources = signal<ScreenShareSource[]>([]);
  protected readonly screenShareCategory = signal<ScreenShareSourceCategory>('window');
  protected readonly visibleScreenShareSources = computed(() => this.screenShareSources().filter((source) => source.category === this.screenShareCategory()));
  protected readonly screenSharing = signal(false);
  protected readonly cameraEnabled = signal(false);
  protected readonly screenPreviewEnabled = signal(false);
  protected readonly cameraPreviewEnabled = signal(true);
  protected readonly settingsOpen = signal(false);
  protected readonly avatarSaving = signal(false);
  protected readonly selectedAvatarID = signal<string | null>(null);
  protected readonly availableAvatars = Array.from({ length: 15 }, (_, index) => `icon_${String(index + 1).padStart(2, '0')}`);
  protected readonly hardwareAcceleration = signal(true);
  protected readonly hardwareAccelerationRestartRequired = signal(false);
  protected readonly appVersion = signal('');
  protected readonly noiseFilterEnabled = signal(true);
  protected readonly inputVolumeDb = signal(0);
  protected readonly inputDeviceId = signal<string | null>(null);
  protected readonly outputDeviceId = signal<string | null>(null);
  protected readonly outputVolume = signal(1);
  protected readonly participantAudioMenuUserID = signal<number | null>(null);
  protected readonly participantAudioRevision = signal(0);
  protected readonly inputDevices = signal<MediaDeviceInfo[]>([]);
  protected readonly outputDevices = signal<MediaDeviceInfo[]>([]);
  protected readonly micLevel = signal(0);
  protected readonly micTestActive = signal(false);
  private micProcessor?: MicProcessor;
  private micTest?: { stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode; worklet: AudioWorkletNode };
  protected readonly cameraEffect = signal<CameraEffectID>('none');
  protected readonly voiceMediaActive = signal(false);
  protected readonly voiceMediaVisible = signal(false);
  protected readonly voiceReconnecting = signal(false);
  protected readonly availablePeerMedia = signal<PeerMediaAvailability[]>([]);
  protected readonly featuredPeerMediaID = signal<string | null>(null);
  protected readonly miniCallPreview = computed(() => {
    this.peerMediaRevision();
    const media: CallMediaDescriptor[] = this.peerMediaElements.map((item) => ({
      id: item.id,
      kind: item.kind,
      participantIdentity: item.participantIdentity,
    }));
    return deriveCallMiniPreviewModel({
      connected: this.voiceChannel() !== null,
      viewingActiveCall: this.voiceMediaVisible(),
      reconnecting: this.voiceReconnecting(),
      media,
      featuredMediaID: this.featuredPeerMediaID(),
      activeSpeakerIDs: this.activeSpeakerIDs(),
    });
  });
  protected readonly miniCallParticipants = computed(() => this.voiceParticipants().slice(0, 3));
  protected readonly miniCallActiveParticipant = computed(() => {
    const participants = this.voiceParticipants();
    return participants.find((participant) => this.activeSpeakerIDs().includes(participant.identity)) ?? participants[0] ?? null;
  });
  protected readonly miniCallActiveParticipantName = computed(() => this.miniCallActiveParticipant()?.name ?? 'Chamada de voz');
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
  private removeRealtimeProfileListener?: () => void;
  private removeWebRTCSignalListener?: () => void;
  private removeUpdaterStatusListener?: () => void;
  private updaterStatusRevision = 0;
  private voiceRoom?: Room;
  private readonly participantAudio = new ParticipantAudioService({
    load: async () => {
      const settings = await window.desktop.settings.get();
      this.outputDeviceId.set(settings.outputDeviceId);
      this.outputVolume.set(settings.outputVolume);
      this.participantAudio.setOutput(settings.outputVolume, settings.outputDeviceId);
      return settings.participantAudioPreferences;
    },
    save: (userID, preference) => window.desktop.settings.setParticipantAudio(userID, preference),
  }, () => this.participantAudioRevision.update((revision) => revision + 1));
  private voiceAudioElements = new Map<string, ParticipantAudioElement>();
  private peerMediaElements: PeerMediaElement[] = [];
  private peerMediaAudioElements = new Map<string, ParticipantAudioElement>();
  private voiceAudioContext?: AudioContext;
  private peerMediaConfiguration?: RTCConfiguration;
  private localPeerMedia = new Map<PeerMediaKind, MediaStream>();
  private peerConnections = new Map<string, PeerMediaConnection>();
  private pendingPeerCandidates = new Map<string, PendingPeerCandidates>();
  private cameraEffectPipeline?: CameraEffectPipeline;
  private desiredPeerMedia = new Set<string>();
  private peerMediaRetryCounts = new Map<string, number>();
  private pendingPeerMediaRemovals = new Map<number, ReturnType<typeof setTimeout>>();

  ngOnInit(): void {
    void this.refreshBackendStatus();
    void this.restoreSession();
    void this.participantAudio.restore().catch((error) => console.warn('[voice] unable to restore participant volumes', error));
    this.removeUpdaterStatusListener = window.desktop.updater.onStatusChange((status) => {
      this.updaterStatusRevision += 1;
      this.applyUpdaterStatus(status);
    });
    const updaterStatusRevision = this.updaterStatusRevision;
    void window.desktop.updater.getStatus()
      .then((status) => {
        if (this.updaterStatusRevision === updaterStatusRevision) this.applyUpdaterStatus(status);
      })
      .catch((error) => console.warn('[updater] could not read updater status', this.messageFor(error, 'Unknown updater error.')));
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
      if (voiceChannel?.server_id === presence.server_id && presence.user_id !== this.currentUserID()) {
        if (presence.channel_id === voiceChannel.id) this.cancelPeerMediaRemoval(presence.user_id);
        else if (presence.channel_id === null) this.schedulePeerMediaRemoval(presence.user_id, voiceChannel.id);
        else this.removePeerMediaForUser(presence.user_id, voiceChannel.id);
      }
      if (this.selectedServer()?.id !== presence.server_id) return;
      this.members.update((members) => members.map((member) => member.id === presence.user_id ? { ...member, voice_channel_id: presence.channel_id } : member));
    });
    this.removeRealtimeProfileListener = window.desktop.realtime.onProfileUpdated((profile) => {
      this.applyAvatarUpdate(profile.user_id, profile.avatar_id);
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
    this.removeRealtimeProfileListener?.();
    this.removeWebRTCSignalListener?.();
    this.removeUpdaterStatusListener?.();
    void this.participantAudio.flushPersistence();
    void this.leaveVoiceChannel();
  }

  protected deferDownloadedUpdate(version: string): void {
    this.dismissedUpdateVersion.set(version);
  }

  protected async restartAndInstallUpdate(): Promise<void> {
    if (this.installingUpdate()) return;
    this.installingUpdate.set(true);
    try {
      const installationStarted = await window.desktop.updater.installUpdate();
      if (!installationStarted) this.error.set('A atualização ainda não está pronta para ser instalada.');
    } catch (error) {
      this.error.set(this.messageFor(error, 'Não foi possível iniciar a instalação da atualização.'));
    } finally {
      this.installingUpdate.set(false);
    }
  }

  private applyUpdaterStatus(status: DesktopUpdaterStatus): void {
    if ('version' in status && this.dismissedUpdateVersion() !== null && this.dismissedUpdateVersion() !== status.version) {
      this.dismissedUpdateVersion.set(null);
    }
    this.updaterStatus.set(status);
  }
  @HostListener('document:click', ['$event'])
  protected closePopoversWhenClickingOutside(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const containingDetails = target.closest<HTMLDetailsElement>('details.create-server, details.join-server, details.actions');
    document.querySelectorAll<HTMLDetailsElement>('details.create-server[open], details.join-server[open], details.actions[open]').forEach((details) => {
      if (details !== containingDetails) details.open = false;
    });
    if (!target.closest('.participant-audio-popover, .participant-audio-trigger')) this.participantAudioMenuUserID.set(null);
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
    if (this.voiceChannel()?.id === channel.id) { await this.returnToVoiceCall(); return; }
    await this.leaveVoiceChannel(); this.loading.set(true); this.error.set('');
    this.voiceMediaVisible.set(true);
    this.selectedChannel.set(null);
    this.messages.set([]);
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
          const audioID = publication.trackSid;
          this.removeVoiceAudioElement(audioID);
          document.body.appendChild(audio);
          this.voiceAudioElements.set(audioID, { userID: participant.identity, element: audio });
          this.participantAudio.register(participant.identity, audio);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
        if (track.kind === Track.Kind.Audio) this.removeVoiceAudioElement(publication.trackSid);
      });
      room.on(RoomEvent.ParticipantConnected, () => {
        refreshParticipants();
        if (this.voiceRoom === room) this.playVoiceSound('join');
      });
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        this.removeVoiceAudioForUser(participant.identity);
        const participantAudioMenuUserID = this.participantAudioMenuUserID();
        if (participantAudioMenuUserID !== null && String(participantAudioMenuUserID) === participant.identity) {
          this.participantAudioMenuUserID.set(null);
        }
        refreshParticipants();
        if (this.voiceRoom === room) this.playVoiceSound('leave');
      });
      room.on(RoomEvent.TrackMuted, () => {
        refreshParticipants();
      });
      room.on(RoomEvent.TrackUnmuted, () => {
        refreshParticipants();
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        this.activeSpeakerIDs.set(speakers.map((speaker) => speaker.identity));
        this.schedulePeerMediaLayout();
      });
      room.on(RoomEvent.Reconnecting, () => this.voiceReconnecting.set(true));
      room.on(RoomEvent.Reconnected, () => this.voiceReconnecting.set(false));
      room.on(RoomEvent.Disconnected, () => {
        this.voiceRoom = undefined;
        this.voiceChannel.set(null);
        this.voiceReconnecting.set(false);
        this.voiceParticipants.set([]);
        this.activeSpeakerIDs.set([]);
        this.screenSharing.set(false);
        this.cameraEnabled.set(false);
        this.removeVoiceAudio();
        this.closePeerMedia();
        void window.desktop.voice.setPresence(null).catch(() => undefined);
      });

      await room.connect(session.url, session.token);
      await this.enableMicrophone(room);
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
    this.voiceReconnecting.set(false);
    this.microphoneMuted.set(false);
    this.screenSharing.set(false);
    this.cameraEnabled.set(false);
    this.screenSharePickerOpen.set(false);
    this.participantAudioMenuUserID.set(null);
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
  protected async returnToVoiceCall(): Promise<void> {
    const channel = this.voiceChannel();
    if (!channel) return;
    const server = this.servers().find((candidate) => candidate.id === channel.server_id);
    if (server && this.selectedServer()?.id !== server.id) await this.selectServer(server);
    if (this.voiceChannel()?.id !== channel.id) return;
    this.selectedChannel.set(null);
    this.messages.set([]);
    this.voiceMediaVisible.set(true);
    this.schedulePeerMediaLayout();
  }
  protected readonly callMiniPreviewPosition = signal<{ x: number; y: number } | null>(readCallMiniPreviewPlacement().position);
  protected readonly callMiniPreviewWidth = signal<number | null>(readCallMiniPreviewPlacement().width);
  private callMiniDragState?: { pointerID: number; offsetX: number; offsetY: number; width: number; height: number };
  private callMiniResizeState?: { pointerID: number; startX: number; startWidth: number };
  protected startCallMiniDrag(event: PointerEvent): void {
    if (event.target instanceof Element && event.target.closest('button')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement;
    const preview = handle.closest<HTMLElement>('.call-mini-preview');
    if (!handle || !preview) return;
    const rect = preview.getBoundingClientRect();
    this.callMiniDragState = { pointerID: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, width: rect.width, height: rect.height };
    preview.classList.add('dragging');
    try { handle.setPointerCapture(event.pointerId); } catch { /* Dragging continues through window listeners. */ }
    event.preventDefault();
  }
  protected moveCallMiniDrag(event: PointerEvent): void {
    const drag = this.callMiniDragState;
    if (!drag || event.pointerId !== drag.pointerID) return;
    const margin = 8;
    const x = Math.min(Math.max(margin, event.clientX - drag.offsetX), Math.max(margin, window.innerWidth - drag.width - margin));
    const y = Math.min(Math.max(margin, event.clientY - drag.offsetY), Math.max(margin, window.innerHeight - drag.height - margin));
    this.callMiniPreviewPosition.set({ x, y });
  }
  protected endCallMiniDrag(event: PointerEvent): void {
    const drag = this.callMiniDragState;
    if (!drag || event.pointerId !== drag.pointerID) return;
    this.callMiniDragState = undefined;
    const handle = event.currentTarget as HTMLElement;
    handle?.closest<HTMLElement>('.call-mini-preview')?.classList.remove('dragging');
    try { handle?.releasePointerCapture(event.pointerId); } catch { /* Capture already released. */ }
    writeCallMiniPreviewPlacement(this.callMiniPreviewPosition(), this.callMiniPreviewWidth());
  }
  protected startCallMiniResize(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement;
    const preview = handle.closest<HTMLElement>('.call-mini-preview');
    if (!handle || !preview) return;
    const rect = preview.getBoundingClientRect();
    this.callMiniResizeState = { pointerID: event.pointerId, startX: event.clientX, startWidth: rect.width };
    preview.classList.add('resizing');
    try { handle.setPointerCapture(event.pointerId); } catch { /* Resizing continues through window listeners. */ }
    event.preventDefault();
    event.stopPropagation();
  }
  protected moveCallMiniResize(event: PointerEvent): void {
    const resize = this.callMiniResizeState;
    if (!resize || event.pointerId !== resize.pointerID) return;
    const width = Math.min(Math.max(callMiniPreviewMinWidth, resize.startWidth + event.clientX - resize.startX), callMiniPreviewMaxWidthForViewport());
    this.callMiniPreviewWidth.set(width);
  }
  protected endCallMiniResize(event: PointerEvent): void {
    const resize = this.callMiniResizeState;
    if (!resize || event.pointerId !== resize.pointerID) return;
    this.callMiniResizeState = undefined;
    const handle = event.currentTarget as HTMLElement;
    handle?.closest<HTMLElement>('.call-mini-preview')?.classList.remove('resizing');
    try { handle?.releasePointerCapture(event.pointerId); } catch { /* Capture already released. */ }
    writeCallMiniPreviewPlacement(this.callMiniPreviewPosition(), this.callMiniPreviewWidth());
  }
  protected async toggleMicrophone(): Promise<void> {
    if (!this.voiceRoom) return;
    const muted = !this.microphoneMuted();
    await this.voiceRoom.localParticipant.setMicrophoneEnabled(!muted, this.microphoneCaptureOptions());
    if (!muted) await this.applyMicProcessor(this.voiceRoom);
    this.microphoneMuted.set(muted);
    this.playVoiceSound(muted ? 'mute' : 'unmute');
  }
  private microphoneCaptureOptions(): AudioCaptureOptions {
    const deviceID = this.inputDeviceId();
    return { echoCancellation: true, autoGainControl: true, noiseSuppression: !this.noiseFilterEnabled(), ...(deviceID ? { deviceId: { ideal: deviceID } } : {}) } as AudioCaptureOptions;
  }
  private async enableMicrophone(room: Room): Promise<void> {
    await room.localParticipant.setMicrophoneEnabled(true, this.microphoneCaptureOptions());
    await this.applyMicProcessor(room);
  }
  private async applyMicProcessor(room: Room): Promise<void> {
    const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
    if (!(track instanceof LocalAudioTrack) || track.getProcessor()?.name === 'mic-processor') return;
    try {
      const processor = new MicProcessor({ rnnoise: this.noiseFilterEnabled(), gainDecibels: this.inputVolumeDb() });
      processor.onLevel = (level) => this.micLevel.set(level);
      await track.setProcessor(processor);
      this.micProcessor = processor;
      console.info('[voice] mic processor attached', JSON.stringify({ rnnoise: this.noiseFilterEnabled(), gainDb: this.inputVolumeDb() }));
    } catch (error) {
      console.warn('[voice] unable to attach mic processor', error instanceof Error ? error.message : String(error));
      await track.mediaStreamTrack.applyConstraints({ echoCancellation: true, autoGainControl: true, noiseSuppression: true }).catch(() => undefined);
    }
  }
  protected async toggleNoiseFilter(enabled: boolean): Promise<void> {
    this.noiseFilterEnabled.set(enabled);
    try { await window.desktop.settings.setNoiseFilter(enabled); }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to save the setting.')); }
    const processor = this.micProcessor;
    if (processor) {
      processor.setRnnoise(enabled);
      const track = this.voiceRoom?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
      await track?.mediaStreamTrack.applyConstraints({ echoCancellation: true, autoGainControl: true, noiseSuppression: !enabled }).catch(() => undefined);
      console.info('[voice] rnnoise', enabled ? 'enabled' : 'disabled');
    }
  }
  protected async setInputVolume(decibels: number): Promise<void> {
    this.inputVolumeDb.set(decibels);
    this.micProcessor?.setGainDecibels(decibels);
    try { await window.desktop.settings.setAudio({ inputVolumeDb: decibels }); }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to save the setting.')); }
  }
  protected async selectInputDevice(deviceID: string): Promise<void> {
    this.inputDeviceId.set(deviceID || null);
    try { await window.desktop.settings.setAudio({ inputDeviceId: deviceID || null }); }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to save the setting.')); }
    const track = this.voiceRoom?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
    if (track instanceof LocalAudioTrack && deviceID) await track.setDeviceId({ ideal: deviceID }).catch(() => undefined);
  }
  protected async selectOutputDevice(deviceID: string): Promise<void> {
    this.outputDeviceId.set(deviceID || null);
    try { await window.desktop.settings.setAudio({ outputDeviceId: deviceID || null }); }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to save the setting.')); }
    this.applyOutputAudioSettings();
  }
  protected async setOutputVolume(volume: number): Promise<void> {
    this.outputVolume.set(volume);
    try { await window.desktop.settings.setAudio({ outputVolume: volume }); }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to save the setting.')); }
    this.applyOutputAudioSettings();
  }
  private applyOutputAudioSettings(): void {
    this.participantAudio.setOutput(this.outputVolume(), this.outputDeviceId());
  }
  private async refreshAudioDevices(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.inputDevices.set(devices.filter((device) => device.kind === 'audioinput'));
      this.outputDevices.set(devices.filter((device) => device.kind === 'audiooutput'));
    } catch { /* Device labels become available after the first microphone use. */ }
  }
  protected async toggleMicTest(): Promise<void> {
    if (this.micTestActive()) {
      this.stopMicTest();
      return;
    }
    try {
      const deviceID = this.inputDeviceId();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, autoGainControl: true, noiseSuppression: false, ...(deviceID ? { deviceId: { ideal: deviceID } } : {}) } });
      const context = new AudioContext();
      if (context.state === 'suspended') await context.resume().catch(() => undefined);
      const source = context.createMediaStreamSource(stream);
      const worklet = await createMicWorkletNode(context, { rnnoise: this.noiseFilterEnabled(), gain: 1 });
      worklet.parameters.get('gain')!.value = decibelsToLinearGain(this.inputVolumeDb());
      worklet.port.onmessage = (event: MessageEvent<{ level?: number }>) => {
        if (typeof event.data?.level === 'number') this.micLevel.set(event.data.level);
      };
      source.connect(worklet);
      worklet.connect(context.destination);
      this.micTest = { stream, context, source, worklet };
      this.micTestActive.set(true);
    } catch (error) {
      this.error.set(this.messageFor(error, 'Não foi possível iniciar o teste de microfone.'));
    }
  }
  private stopMicTest(): void {
    const test = this.micTest;
    if (!test) return;
    this.micTest = undefined;
    this.micTestActive.set(false);
    this.micLevel.set(0);
    test.source.disconnect();
    test.worklet.disconnect();
    test.stream.getTracks().forEach((track) => track.stop());
    void test.context.close().catch(() => undefined);
  }
  protected async toggleCamera(preserveNavigation = false): Promise<void> {
    if (!this.voiceRoom) return;
    this.loading.set(true); this.error.set('');
    try {
      const enabled = !this.cameraEnabled();
      if (enabled) await this.publishPeerMedia('camera', this.startCameraEffectPipeline(await navigator.mediaDevices.getUserMedia({ video: { width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 24 } }, audio: false })));
      else await this.stopLocalPeerMedia('camera');
      this.cameraEnabled.set(enabled);
      if (enabled && !preserveNavigation) this.voiceMediaVisible.set(true);
    } catch (error) { this.error.set(this.messageFor(error, 'Unable to change the camera state.')); }
    finally { this.loading.set(false); }
  }
  protected async openScreenSharePicker(): Promise<void> {
    if (!this.voiceRoom) return;
    this.loading.set(true); this.error.set('');
    try {
      const sources = await window.desktop.screenShare.listSources();
      const [picked] = sources;
      if (sources.length === 1 && picked) {
        await this.startScreenShare(picked);
        return;
      }
      this.screenShareSources.set(sources);
      this.screenShareCategory.set((['window', 'screen', 'application'] as const).find((category) => sources.some((source) => source.category === category)) ?? 'window');
      this.screenSharePickerOpen.set(true);
    }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to list screens for sharing.')); }
    finally { this.loading.set(false); }
  }
  protected cancelScreenSharePicker(): void { this.screenSharePickerOpen.set(false); }
  protected selectScreenShareCategory(category: ScreenShareSourceCategory): void { this.screenShareCategory.set(category); }
  protected screenShareSourceCount(category: ScreenShareSourceCategory): number { return this.screenShareSources().filter((source) => source.category === category).length; }
  protected async startScreenShare(source: ScreenShareSource): Promise<void> {
    if (!this.voiceRoom) return;
    this.loading.set(true); this.error.set('');
    try {
      console.info('[webrtc] selected display source', JSON.stringify({ kind: source.kind, name: source.name }));
      await window.desktop.screenShare.selectSource(source.id);
      const includeAudio = this.systemAudioSupported && this.shareSystemAudio;
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 30 } }, audio: includeAudio });
      stream.getVideoTracks().forEach((track) => { track.contentHint = 'motion'; });
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
      this.desiredPeerMedia.delete(peerMediaKey(media.userID, media.kind));
      this.peerMediaRetryCounts.delete(peerMediaKey(media.userID, media.kind));
      this.closePeerConnections('incoming', media.userID, media.kind);
      await this.sendPeerSignal(media.userID, 'media.unwatch', { kind: media.kind });
      return;
    }
    console.info('[webrtc] requesting remote media', { userID: media.userID, kind: media.kind, channelID: channel.id });
    this.desiredPeerMedia.add(peerMediaKey(media.userID, media.kind));
    this.peerMediaRetryCounts.delete(peerMediaKey(media.userID, media.kind));
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
    this.addPeerMediaVideo(`local:${kind}`, stream, kind, this.user()?.username ?? 'You', undefined, true);
    await this.announcePeerMedia(kind, 'media.available');
  }
  private async stopLocalPeerMedia(kind: PeerMediaKind): Promise<void> {
    const stream = this.localPeerMedia.get(kind);
    if (!stream) return;
    console.info('[webrtc] stopping local media', { kind });
    if (kind === 'camera') this.stopCameraEffectPipeline();
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
      void this.maybeRewatchPeerMedia(signal.from_user_id, kind, channel.id);
      return;
    }
    if (signal.kind === 'media.unavailable') {
      this.availablePeerMedia.update((items) => items.filter((item) => item.channelID !== signal.channel_id || item.userID !== signal.from_user_id || item.kind !== kind));
      this.desiredPeerMedia.delete(peerMediaKey(signal.from_user_id, kind));
      this.peerMediaRetryCounts.delete(peerMediaKey(signal.from_user_id, kind));
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
    for (const track of stream.getTracks()) {
      const sender = peer.connection.addTrack(track, stream);
      if (track.kind === 'video') await this.applyVideoSenderLimits(sender, kind);
    }
    await peer.connection.setLocalDescription(await peer.connection.createOffer());
    await this.sendPeerSignal(userID, 'offer', { kind, description: serializedSessionDescription(peer.connection.localDescription) }, sessionID);
  }
  private async applyVideoSenderLimits(sender: RTCRtpSender, kind: PeerMediaKind): Promise<void> {
    const parameters = sender.getParameters();
    const limits = peerMediaEncodingLimits[kind];
    parameters.degradationPreference = 'maintain-framerate';
    parameters.encodings = [{ ...(parameters.encodings[0] ?? {}), ...limits }];
    await sender.setParameters(parameters);
    console.info('[webrtc] video sender limits applied', JSON.stringify({ kind, ...limits }));
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
        const existingAudio = this.peerMediaAudioElements.get(audioID);
        if (existingAudio) {
          existingAudio.element.srcObject = stream;
          this.participantAudio.register(existingAudio.userID, existingAudio.element);
        } else {
          const audio = document.createElement('audio');
          audio.autoplay = true; audio.srcObject = stream;
          document.body.appendChild(audio);
          const userID = String(remoteUserID);
          this.peerMediaAudioElements.set(audioID, { userID, element: audio });
          this.participantAudio.register(userID, audio);
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
        if (peer.direction === 'incoming') this.peerMediaRetryCounts.delete(peerMediaKey(remoteUserID, kind));
      } else if (connection.connectionState === 'disconnected' && !peer.disconnectTimer) {
        peer.disconnectTimer = setTimeout(() => {
          peer.disconnectTimer = undefined;
          const current = this.peerConnections.get(sessionID);
          if (current === peer && ['disconnected', 'failed'].includes(connection.connectionState)) {
            this.closePeerConnection(sessionID);
            if (peer.direction === 'incoming') this.schedulePeerMediaRetry(remoteUserID, kind);
          }
        }, peerDisconnectGraceMilliseconds);
      } else if (connection.connectionState === 'failed') {
        this.closePeerConnection(sessionID);
        if (peer.direction === 'incoming') this.schedulePeerMediaRetry(remoteUserID, kind);
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
    this.cancelPeerMediaRemoval(userID);
    for (const kind of ['camera', 'screen'] as const) {
      this.desiredPeerMedia.delete(peerMediaKey(userID, kind));
      this.peerMediaRetryCounts.delete(peerMediaKey(userID, kind));
    }
    this.availablePeerMedia.update((items) => items.filter((item) => item.channelID !== channelID || item.userID !== userID));
    for (const peer of [...this.peerConnections.values()]) {
      if (peer.remoteUserID === userID) this.closePeerConnection(peer.sessionID);
    }
    this.clearQueuedPeerCandidates(userID);
  }
  private schedulePeerMediaRemoval(userID: number, channelID: number): void {
    if (this.pendingPeerMediaRemovals.has(userID)) return;
    console.info('[webrtc] peer left voice, media removal scheduled', { userID, channelID });
    this.pendingPeerMediaRemovals.set(userID, setTimeout(() => {
      this.pendingPeerMediaRemovals.delete(userID);
      const channel = this.voiceChannel();
      if (channel?.id === channelID) this.removePeerMediaForUser(userID, channelID);
    }, peerMediaRemovalGraceMilliseconds));
  }
  private cancelPeerMediaRemoval(userID: number): void {
    const timer = this.pendingPeerMediaRemovals.get(userID);
    if (timer) {
      clearTimeout(timer);
      this.pendingPeerMediaRemovals.delete(userID);
      console.info('[webrtc] peer returned, media removal cancelled', { userID });
    }
  }
  private async maybeRewatchPeerMedia(userID: number, kind: PeerMediaKind, channelID: number): Promise<void> {
    const key = peerMediaKey(userID, kind);
    if (!this.desiredPeerMedia.has(key)) return;
    if (this.findPeerConnection('incoming', userID, kind)) return;
    if (!this.availablePeerMedia().some((media) => media.channelID === channelID && media.userID === userID && media.kind === kind)) return;
    console.info('[webrtc] resuming remote media', { userID, kind, channelID });
    await this.sendPeerSignal(userID, 'media.watch', { kind });
  }
  private schedulePeerMediaRetry(userID: number, kind: PeerMediaKind): void {
    const key = peerMediaKey(userID, kind);
    if (!this.desiredPeerMedia.has(key)) return;
    const attempts = (this.peerMediaRetryCounts.get(key) ?? 0) + 1;
    if (attempts > maxPeerMediaRetryAttempts) {
      console.warn('[webrtc] remote media retry limit reached', { userID, kind, attempts });
      return;
    }
    this.peerMediaRetryCounts.set(key, attempts);
    console.info('[webrtc] remote media retry scheduled', { userID, kind, attempts });
    setTimeout(() => {
      const channel = this.voiceChannel();
      if (channel) void this.maybeRewatchPeerMedia(userID, kind, channel.id);
    }, peerMediaRetryDelayMilliseconds);
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
      this.removePeerMediaAudioElement(audioID);
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
    this.stopCameraEffectPipeline();
    for (const kind of ['camera', 'screen'] as const) {
      const stream = this.localPeerMedia.get(kind);
      stream?.getTracks().forEach((track) => track.stop());
    }
    this.localPeerMedia.clear();
    for (const peer of [...this.peerConnections.values()]) this.closePeerConnection(peer.sessionID);
    this.pendingPeerCandidates.clear();
    this.desiredPeerMedia.clear();
    this.peerMediaRetryCounts.clear();
    for (const timer of this.pendingPeerMediaRemovals.values()) clearTimeout(timer);
    this.pendingPeerMediaRemovals.clear();
    for (const item of this.peerMediaElements) item.element.remove();
    this.peerMediaElements = [];
    for (const audioID of [...this.peerMediaAudioElements.keys()]) this.removePeerMediaAudioElement(audioID);
    this.peerMediaAudioElements.clear();
    this.availablePeerMedia.set([]);
    this.featuredPeerMediaID.set(null);
    this.voiceMediaActive.set(false);
    this.peerMediaRevision.update((revision) => revision + 1);
    this.updatePeerMediaLayout();
  }
  private addPeerMediaVideo(id: string, stream: MediaStream, kind: PeerMediaKind, name: string, remoteMedia?: PeerMediaAvailability, local = false): void {
    const previewEnabled = local && this.localMediaPreviewEnabled(kind);
    const existing = this.peerMediaElements.find((item) => item.id === id);
    if (existing) {
      existing.video.srcObject = local ? (previewEnabled ? stream : null) : stream;
      existing.label.textContent = kind === 'screen' ? `${name} está compartilhando` : name;
      existing.element.classList.toggle('preview-off', local && !previewEnabled);
      return;
    }
    const element = this.renderer.createElement('article') as HTMLElement;
    element.className = `voice-media-tile ${kind === 'screen' ? 'shared-screen-video' : 'camera-video'}`;
    if (local && !previewEnabled) element.classList.add('preview-off');
    element.dataset['mediaId'] = id;
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', kind === 'screen' ? `Tela compartilhada por ${name}` : `Câmera de ${name}`);
    const video = this.renderer.createElement('video') as HTMLVideoElement;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = local && !previewEnabled ? null : stream;
    video.addEventListener('loadedmetadata', () => {
      console.info('[webrtc] media dimensions', JSON.stringify({ id, kind, videoWidth: video.videoWidth, videoHeight: video.videoHeight }));
    });
    const label = this.renderer.createElement('span') as HTMLSpanElement;
    label.textContent = kind === 'screen' ? `${name} está compartilhando` : name;
    const highlightButton = this.renderer.createElement('button') as HTMLButtonElement;
    highlightButton.type = 'button';
    highlightButton.className = 'voice-media-highlight';
    highlightButton.addEventListener('click', () => {
      if (this.miniCallPreview().visible) void this.returnToVoiceCall();
      else this.togglePeerMediaFeatured(element.dataset['mediaId'] ?? id);
    });
    element.append(video, highlightButton, label);
    let previewButton: HTMLButtonElement | undefined;
    if (local) {
      const controls = this.createLocalPreviewControls(kind);
      previewButton = controls.button;
      element.append(controls.placeholder, controls.button);
    }
    let effectButton: HTMLButtonElement | undefined;
    if (local && kind === 'camera') {
      effectButton = this.renderer.createElement('button') as HTMLButtonElement;
      effectButton.type = 'button';
      effectButton.className = 'voice-media-effect-toggle';
      effectButton.title = 'Efeito: Nenhum';
      effectButton.setAttribute('aria-label', 'Trocar efeito da câmera (atual: Nenhum)');
      effectButton.append(this.createSVGIcon(['m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72', 'm14 7 3 3', 'M5 6v4', 'M19 14v4', 'M10 2v2', 'M7 8H3', 'M21 16h-4', 'M11 3H9']));
      effectButton.addEventListener('click', (event) => {
        event.stopPropagation();
        this.cycleCameraEffect();
      });
      element.append(effectButton);
    }
    if (remoteMedia) element.append(this.createStopWatchingOverlay(remoteMedia));
    this.peerMediaElements.push({
      id, element, video, label, highlightButton, previewButton, effectButton, kind,
      participantIdentity: remoteMedia ? String(remoteMedia.userID) : this.voiceRoom?.localParticipant.identity ?? String(this.currentUserID()),
    });
    this.peerMediaRevision.update((revision) => revision + 1);
    this.voiceMediaActive.set(true);
    setTimeout(() => this.updatePeerMediaLayout(), 0);
  }
  private startCameraEffectPipeline(source: MediaStream): MediaStream {
    this.stopCameraEffectPipeline();
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = source;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return source;
    const pipeline: CameraEffectPipeline = { source, video, canvas, context, running: true };
    this.cameraEffectPipeline = pipeline;
    video.addEventListener('loadedmetadata', () => {
      if (this.cameraEffectPipeline !== pipeline) return;
      const settings = source.getVideoTracks()[0]?.getSettings();
      canvas.width = settings.width ?? (video.videoWidth || 1280);
      canvas.height = settings.height ?? (video.videoHeight || 720);
      void video.play().catch(() => undefined);
      this.scheduleCameraEffectFrame();
    });
    void video.play().catch(() => undefined);
    const stream = canvas.captureStream();
    for (const track of source.getAudioTracks()) stream.addTrack(track);
    console.info('[webrtc] camera effect pipeline started', JSON.stringify({ width: canvas.width || null, height: canvas.height || null }));
    return stream;
  }
  private scheduleCameraEffectFrame(): void {
    const pipeline = this.cameraEffectPipeline;
    if (!pipeline?.running) return;
    const video = pipeline.video as HTMLVideoElement & { requestVideoFrameCallback?: (callback: () => void) => number };
    if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(() => this.drawCameraEffectFrame());
    else requestAnimationFrame(() => this.drawCameraEffectFrame());
  }
  private drawCameraEffectFrame(): void {
    const pipeline = this.cameraEffectPipeline;
    if (!pipeline?.running) return;
    const effect = cameraEffects.find((candidate) => candidate.id === this.cameraEffect());
    pipeline.context.filter = effect?.filter ?? 'none';
    pipeline.context.drawImage(pipeline.video, 0, 0, pipeline.canvas.width, pipeline.canvas.height);
    this.scheduleCameraEffectFrame();
  }
  private stopCameraEffectPipeline(): void {
    const pipeline = this.cameraEffectPipeline;
    if (!pipeline) return;
    this.cameraEffectPipeline = undefined;
    pipeline.running = false;
    pipeline.source.getTracks().forEach((track) => track.stop());
    pipeline.video.srcObject = null;
    console.info('[webrtc] camera effect pipeline stopped');
  }
  protected cycleCameraEffect(): void {
    const index = cameraEffects.findIndex((effect) => effect.id === this.cameraEffect());
    const next = cameraEffects[(index + 1) % cameraEffects.length] ?? cameraEffects[0]!;
    this.cameraEffect.set(next.id);
    const name = this.user()?.username ?? 'You';
    const item = this.peerMediaElements.find((candidate) => candidate.id === 'local:camera');
    if (item) {
      item.label.textContent = next.id === 'none' ? name : `${name} · ${next.label}`;
      if (item.effectButton) {
        item.effectButton.title = `Efeito: ${next.label}`;
        item.effectButton.setAttribute('aria-label', `Trocar efeito da câmera (atual: ${next.label})`);
      }
    }
    console.info('[webrtc] camera effect changed', { effect: next.id });
  }
  private localMediaPreviewEnabled(kind: PeerMediaKind): boolean {
    return kind === 'camera' ? this.cameraPreviewEnabled() : this.screenPreviewEnabled();
  }
  protected toggleLocalMediaPreview(kind: PeerMediaKind): void {
    const enabled = !this.localMediaPreviewEnabled(kind);
    if (kind === 'camera') this.cameraPreviewEnabled.set(enabled);
    else this.screenPreviewEnabled.set(enabled);
    const item = this.peerMediaElements.find((candidate) => candidate.id === `local:${kind}`);
    if (!item) return;
    const stream = this.localPeerMedia.get(kind);
    item.video.srcObject = enabled ? stream ?? null : null;
    item.element.classList.toggle('preview-off', !enabled);
    this.updateLocalMediaPreviewButton(item.previewButton, kind, enabled);
  }
  private updateLocalMediaPreviewButton(button: HTMLButtonElement | undefined, kind: PeerMediaKind, enabled: boolean): void {
    if (!button) return;
    const mediaLabel = kind === 'screen' ? 'da tela' : 'da câmera';
    button.title = enabled ? `Desativar prévia ${mediaLabel}` : `Ativar prévia ${mediaLabel}`;
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(enabled));
  }
  private createLocalPreviewControls(kind: PeerMediaKind): { button: HTMLButtonElement; placeholder: HTMLElement } {
    const button = this.renderer.createElement('button') as HTMLButtonElement;
    button.type = 'button';
    button.className = 'voice-media-preview-toggle';
    const onIcon = this.createSVGIcon(['M2.07 10.93A10.45 10.45 0 0 1 12 5c7 0 10 7 10 7s-3 7-10 7a10.45 10.45 0 0 1-9.93-4.07']);
    const pupil = this.renderer.createElement('circle', 'svg') as SVGCircleElement;
    pupil.setAttribute('cx', '12');
    pupil.setAttribute('cy', '12');
    pupil.setAttribute('r', '3');
    onIcon.appendChild(pupil);
    onIcon.classList.add('preview-icon-on');
    const offIcon = this.createSVGIcon(['M3 3l18 18', 'M10.6 10.6a2 2 0 0 0 2.8 2.8', 'M9.9 4.2A10.5 10.5 0 0 1 12 4c5 0 9 4.5 10 8a12.7 12.7 0 0 1-2.1 3.8', 'M6.6 6.6C4.2 8.2 2.7 10.4 2 12c1.1 3.5 5 8 10 8 1.3 0 2.5-.3 3.6-.8']);
    offIcon.classList.add('preview-icon-off');
    button.append(onIcon, offIcon);
    this.updateLocalMediaPreviewButton(button, kind, this.localMediaPreviewEnabled(kind));
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleLocalMediaPreview(kind);
    });
    const placeholder = this.renderer.createElement('div') as HTMLElement;
    placeholder.className = 'voice-media-preview-placeholder';
    const placeholderIcon = this.createSVGIcon(['M3 4h18v14H3z', 'm8 22 4-4 4 4']);
    const placeholderText = this.renderer.createElement('span') as HTMLSpanElement;
    placeholderText.textContent = 'Prévia desativada';
    placeholder.append(placeholderIcon, placeholderText);
    return { button, placeholder };
  }
  private createSVGIcon(paths: string[]): SVGElement {
    const icon = this.renderer.createElement('svg', 'svg') as SVGElement;
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    for (const data of paths) {
      const path = this.renderer.createElement('path', 'svg') as SVGPathElement;
      path.setAttribute('d', data);
      icon.appendChild(path);
    }
    return icon;
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
    this.peerMediaRevision.update((revision) => revision + 1);
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
      const miniHost = document.getElementById('call-mini-media-host');
      const miniPreview = this.miniCallPreview();
      const miniMediaID = miniPreview.visible ? miniPreview.mediaID : null;
      const featured = this.peerMediaElements.find((item) => item.id === this.featuredPeerMediaID());
      if ((!featured && this.featuredPeerMediaID()) || this.peerMediaElements.length < 2) this.featuredPeerMediaID.set(null);
      const hasFeatured = Boolean(featured && this.peerMediaElements.length > 1);
      grid.style.setProperty('--voice-media-secondary-count', String(Math.max(1, this.peerMediaElements.length - 1)));
      for (const item of this.peerMediaElements) {
        const inMiniPreview = item.id === miniMediaID && miniHost !== null;
        const parent = inMiniPreview ? miniHost : grid;
        if (item.element.parentElement !== parent) parent.appendChild(item.element);
        const selected = !inMiniPreview && hasFeatured && item === featured;
        item.element.classList.toggle('mini-call-media', inMiniPreview);
        item.element.classList.toggle('featured', selected);
        item.highlightButton.title = inMiniPreview ? 'Voltar para a chamada' : selected ? 'Clique para remover o destaque' : 'Clique para destacar';
        item.highlightButton.setAttribute('aria-label', inMiniPreview ? 'Voltar para a chamada ativa' : selected ? 'Remover destaque desta transmissão' : 'Destacar esta transmissão');
        item.highlightButton.setAttribute('aria-pressed', String(selected));
      }
    };
    apply();
    setTimeout(apply, 0);
  }
  private schedulePeerMediaLayout(): void { setTimeout(() => this.updatePeerMediaLayout(), 0); }
  private currentUserID(): number { return this.user()?.id ?? this.members().find((member) => member.username === this.user()?.username)?.id ?? 0; }
  private applyAvatarUpdate(userID: number, avatarID: string | null): void {
    this.user.update((user) => user?.id === userID ? { ...user, avatar_id: avatarID } : user);
    this.members.update((members) => members.map((member) => member.id === userID ? { ...member, avatar_id: avatarID } : member));
    this.messages.update((messages) => messages.map((message) => message.author_id === userID ? { ...message, author_avatar_id: avatarID } : message));
  }
  protected isSpeaking(participant: VoiceParticipant): boolean { return this.activeSpeakerIDs().includes(participant.identity); }
  protected voiceMembers(channelID: number): ServerMember[] { return this.members().filter((member) => member.voice_channel_id === channelID); }
  protected isVoiceMemberSpeaking(member: ServerMember): boolean { return this.activeSpeakerIDs().includes(String(member.id)); }
  protected isVoiceMemberMuted(member: ServerMember): boolean { return this.voiceParticipants().find((participant) => participant.identity === String(member.id))?.muted ?? false; }
  protected isCurrentVoiceMember(member: ServerMember): boolean { return member.id === this.currentUserID(); }
  protected participantAudioPreference(userID: number): ParticipantAudioPreference {
    this.participantAudioRevision();
    return this.participantAudio.getPreference(String(userID));
  }
  protected toggleParticipantAudioMenu(userID: number): void {
    this.participantAudioMenuUserID.update((current) => current === userID ? null : userID);
  }
  protected setParticipantVolume(userID: number, volumePercent: number): void {
    this.participantAudio.setVolume(String(userID), volumePercent / 100);
  }
  protected toggleParticipantLocalMute(userID: number): void {
    const preference = this.participantAudio.getPreference(String(userID));
    this.participantAudio.setMuted(String(userID), !preference.muted);
  }
  protected resetParticipantVolume(userID: number): void { this.participantAudio.reset(String(userID)); }
  private removeVoiceAudioElement(audioID: string): void {
    const audio = this.voiceAudioElements.get(audioID);
    if (!audio) return;
    this.participantAudio.unregister(audio.userID, audio.element);
    audio.element.remove();
    this.voiceAudioElements.delete(audioID);
  }
  private removeVoiceAudioForUser(userID: string): void {
    for (const [audioID, audio] of this.voiceAudioElements) {
      if (audio.userID === userID) this.removeVoiceAudioElement(audioID);
    }
  }
  private removeVoiceAudio(): void { for (const audioID of [...this.voiceAudioElements.keys()]) this.removeVoiceAudioElement(audioID); }
  private removePeerMediaAudioElement(audioID: string): void {
    const audio = this.peerMediaAudioElements.get(audioID);
    if (!audio) return;
    this.participantAudio.unregister(audio.userID, audio.element);
    audio.element.remove();
    this.peerMediaAudioElements.delete(audioID);
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
  protected autoResizeComposer(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 144) + 'px';
  }
  protected relaunchApp(): void { void window.desktop.app.relaunch(); }
  protected async openSettings(): Promise<void> {
    try {
      const settings = await window.desktop.settings.get();
      this.hardwareAcceleration.set(settings.hardwareAcceleration);
      this.noiseFilterEnabled.set(settings.noiseFilter);
      this.appVersion.set(settings.appVersion);
      this.inputVolumeDb.set(settings.inputVolumeDb);
      this.inputDeviceId.set(settings.inputDeviceId);
      this.outputDeviceId.set(settings.outputDeviceId);
      this.outputVolume.set(settings.outputVolume);
      this.hardwareAccelerationRestartRequired.set(settings.hardwareAcceleration !== settings.active);
    } catch { /* Defaults remain until the user toggles the setting. */ }
    this.selectedAvatarID.set(this.user()?.avatar_id ?? null);
    void this.refreshAudioDevices();
    this.settingsOpen.set(true);
  }
  protected avatarURL(avatarID: string | null | undefined): string | null {
    return avatarID ? `assets/avatars/${avatarID}.png` : null;
  }
  protected voiceParticipantAvatarID(participant: VoiceParticipant): string | null {
    const userID = Number(participant.identity);
    if (Number.isSafeInteger(userID)) {
      const memberAvatar = this.members().find((member) => member.id === userID)?.avatar_id;
      if (memberAvatar !== undefined) return memberAvatar;
      if (this.user()?.id === userID) return this.user()?.avatar_id ?? null;
    }
    return participant.name === this.user()?.username ? this.user()?.avatar_id ?? null : null;
  }
  protected selectAvatar(avatarID: string | null): void {
    if (!this.avatarSaving()) this.selectedAvatarID.set(avatarID);
  }
  protected async saveSelectedAvatar(): Promise<void> {
    const avatarID = this.selectedAvatarID();
    if (this.avatarSaving() || this.user()?.avatar_id === avatarID) return;
    this.avatarSaving.set(true);
    try {
      const updatedUser = await window.desktop.auth.updateAvatar(avatarID);
      this.user.set(updatedUser);
      this.applyAvatarUpdate(updatedUser.id, updatedUser.avatar_id);
    } catch (error) {
      this.error.set(this.messageFor(error, 'Não foi possível salvar o avatar.'));
    } finally {
      this.avatarSaving.set(false);
    }
  }
  protected closeSettings(): void {
    this.stopMicTest();
    this.selectedAvatarID.set(this.user()?.avatar_id ?? null);
    this.settingsOpen.set(false);
  }
  protected async toggleHardwareAcceleration(event: Event): Promise<void> {
    const enabled = (event.target as HTMLInputElement).checked;
    this.hardwareAcceleration.set(enabled);
    try { this.hardwareAccelerationRestartRequired.set((await window.desktop.settings.setHardwareAcceleration(enabled)).restartRequired); }
    catch (error) { this.error.set(this.messageFor(error, 'Unable to save the setting.')); }
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
type ScreenShareSourceCategory = 'window' | 'screen' | 'application';
type ScreenShareSource = { id: string; name: string; thumbnail: string; icon?: string; kind: 'screen' | 'window'; category: ScreenShareSourceCategory };
type PeerMediaKind = 'camera' | 'screen';
type PeerDirection = 'incoming' | 'outgoing';
type PeerSignalKind = 'offer' | 'answer' | 'ice' | 'media.available' | 'media.unavailable' | 'media.query' | 'media.watch' | 'media.unwatch';
type IncomingPeerSignal = { channel_id: number; from_user_id: number; kind: PeerSignalKind; session_id?: string; payload: unknown };
type PeerMediaAvailability = { channelID: number; userID: number; name: string; kind: PeerMediaKind };
type ParticipantAudioElement = { userID: string; element: HTMLAudioElement };
type PeerMediaConnection = { sessionID: string; connection: RTCPeerConnection; direction: PeerDirection; remoteUserID: number; kind: PeerMediaKind; pendingCandidates: RTCIceCandidateInit[]; disconnectTimer?: ReturnType<typeof setTimeout> };
type PendingPeerCandidates = { remoteUserID: number; kind: PeerMediaKind; candidates: RTCIceCandidateInit[] };
type PeerMediaElement = { id: string; element: HTMLElement; video: HTMLVideoElement; label: HTMLSpanElement; highlightButton: HTMLButtonElement; previewButton?: HTMLButtonElement; effectButton?: HTMLButtonElement; kind: PeerMediaKind; participantIdentity: string };
type CameraEffectPipeline = { source: MediaStream; video: HTMLVideoElement; canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; running: boolean };
type CameraEffectID = 'none' | 'grayscale' | 'sepia' | 'invert' | 'vintage' | 'cold';

const cameraEffects: Array<{ id: CameraEffectID; label: string; filter: string }> = [
  { id: 'none', label: 'Nenhum', filter: 'none' },
  { id: 'grayscale', label: 'Preto e branco', filter: 'grayscale(1) contrast(1.05)' },
  { id: 'sepia', label: 'Sépia', filter: 'sepia(0.9)' },
  { id: 'invert', label: 'Negativo', filter: 'invert(1)' },
  { id: 'vintage', label: 'Vintage', filter: 'sepia(0.4) saturate(1.4) contrast(1.05) brightness(1.05)' },
  { id: 'cold', label: 'Frio', filter: 'saturate(1.3) hue-rotate(15deg) brightness(1.05) contrast(1.05)' },
];
type ServerMember = { id: number; username: string; role: 'owner' | 'member'; avatar_id: string | null; online: boolean; voice_channel_id: number | null };

const peerSessionIDPattern = /^[A-Za-z0-9_-]{1,64}$/;
const peerMediaEncodingLimits: Record<PeerMediaKind, { maxBitrate: number; maxFramerate: number }> = {
  screen: { maxBitrate: 2_500_000, maxFramerate: 30 },
  camera: { maxBitrate: 1_000_000, maxFramerate: 24 },
};
const maxPendingPeerSessions = 32;
const maxPendingCandidatesPerSession = 64;
const peerDisconnectGraceMilliseconds = 10_000;
const peerMediaRemovalGraceMilliseconds = 20_000;
const peerMediaRetryDelayMilliseconds = 3_000;
const maxPeerMediaRetryAttempts = 3;

function peerMediaKey(userID: number, kind: PeerMediaKind): string {
  return `${userID}:${kind}`;
}

const callMiniPreviewPositionStorageKey = 'call-mini-preview-placement';
const callMiniPreviewMinWidth = 240;
const callMiniPreviewMaxWidth = 1920;

function callMiniPreviewMaxWidthForViewport(): number {
  const maxByWidth = window.innerWidth - 16;
  const maxByHeight = Math.max(callMiniPreviewMinWidth, (window.innerHeight - 104) * 16 / 9);
  return Math.min(callMiniPreviewMaxWidth, maxByWidth, maxByHeight);
}

function readCallMiniPreviewPlacement(): { position: { x: number; y: number } | null; width: number | null } {
  try {
    const raw = localStorage.getItem(callMiniPreviewPositionStorageKey);
    if (!raw) return { position: null, width: null };
    const value = JSON.parse(raw) as { x?: unknown; y?: unknown; width?: unknown };
    const position = typeof value.x === 'number' && typeof value.y === 'number' ? { x: value.x, y: value.y } : null;
    const width = typeof value.width === 'number' && value.width >= callMiniPreviewMinWidth
      ? Math.min(value.width, callMiniPreviewMaxWidthForViewport())
      : null;
    return { position, width };
  } catch {
    return { position: null, width: null };
  }
}

function writeCallMiniPreviewPlacement(position: { x: number; y: number } | null, width: number | null): void {
  try {
    localStorage.setItem(callMiniPreviewPositionStorageKey, JSON.stringify({ ...position, ...(width !== null ? { width } : {}) }));
  } catch { /* Storage may be unavailable. */ }
}

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
