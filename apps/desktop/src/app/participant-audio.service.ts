export type ParticipantAudioPreference = { volume: number; muted: boolean };
export type ParticipantAudioPreferences = Record<string, ParticipantAudioPreference>;
export type ParticipantAudioSource = 'microphone' | 'screen-share';
export type ParticipantAudioPreferencesBySource = Record<ParticipantAudioSource, ParticipantAudioPreferences>;

export type ParticipantAudioPreferenceStorage = {
  load(): Promise<ParticipantAudioPreferencesBySource>;
  save(userID: string, source: ParticipantAudioSource, preference: ParticipantAudioPreference | null): Promise<void>;
};

type AudioOutputElement = Pick<HTMLAudioElement, 'volume' | 'setSinkId'>;

const defaultPreference: ParticipantAudioPreference = { volume: 1, muted: false };

export class ParticipantAudioService {
  private readonly preferences = new Map<string, ParticipantAudioPreference>();
  private readonly elements = new Map<string, Set<AudioOutputElement>>();
  private readonly pendingPersistence = new Map<string, { userID: string; source: ParticipantAudioSource; preference: ParticipantAudioPreference | null }>();
  private persistenceTimer?: ReturnType<typeof setTimeout>;
  private outputVolume = 1;
  private outputDeviceID: string | null = null;

  constructor(
    private readonly storage: ParticipantAudioPreferenceStorage,
    private readonly onChange: () => void = () => undefined,
    private readonly persistenceDelayMilliseconds = 200,
  ) {}

  async restore(): Promise<void> {
    const saved = await this.storage.load();
    this.preferences.clear();
    for (const source of audioSources) {
      for (const [userID, preference] of Object.entries(saved[source])) {
        this.preferences.set(audioKey(userID, source), normalizedPreference(preference));
      }
    }
    this.applyAll();
    this.onChange();
  }

  getPreference(userID: string, source: ParticipantAudioSource = 'microphone'): ParticipantAudioPreference {
    return { ...(this.preferences.get(audioKey(userID, source)) ?? defaultPreference) };
  }

  register(userID: string, source: ParticipantAudioSource, element: AudioOutputElement): void {
    const key = audioKey(userID, source);
    const elements = this.elements.get(key) ?? new Set<AudioOutputElement>();
    elements.add(element);
    this.elements.set(key, elements);
    this.apply(userID, source, element);
  }

  unregister(userID: string, source: ParticipantAudioSource, element: AudioOutputElement): void {
    const key = audioKey(userID, source);
    const elements = this.elements.get(key);
    elements?.delete(element);
    if (elements?.size === 0) this.elements.delete(key);
  }

  setOutput(volume: number, deviceID: string | null): void {
    this.outputVolume = clampedVolume(volume);
    this.outputDeviceID = deviceID || null;
    this.applyAll();
  }

  setVolume(userID: string, source: ParticipantAudioSource, volume: number): void {
    const current = this.getPreference(userID, source);
    this.updatePreference(userID, source, { ...current, volume: clampedVolume(volume) });
  }

  setMuted(userID: string, source: ParticipantAudioSource, muted: boolean): void {
    const current = this.getPreference(userID, source);
    this.updatePreference(userID, source, { ...current, muted });
  }

  reset(userID: string, source: ParticipantAudioSource): void {
    this.preferences.delete(audioKey(userID, source));
    this.applyUser(userID, source);
    this.schedulePersistence(userID, source, null);
    this.onChange();
  }

  async flushPersistence(): Promise<void> {
    if (this.persistenceTimer) clearTimeout(this.persistenceTimer);
    this.persistenceTimer = undefined;
    const pending = [...this.pendingPersistence.values()];
    this.pendingPersistence.clear();
    await Promise.all(pending.map(({ userID, source, preference }) => this.storage.save(userID, source, preference)));
  }

  private updatePreference(userID: string, source: ParticipantAudioSource, preference: ParticipantAudioPreference): void {
    const normalized = normalizedPreference(preference);
    this.preferences.set(audioKey(userID, source), normalized);
    this.applyUser(userID, source);
    this.schedulePersistence(userID, source, normalized);
    this.onChange();
  }

  private schedulePersistence(userID: string, source: ParticipantAudioSource, preference: ParticipantAudioPreference | null): void {
    this.pendingPersistence.set(audioKey(userID, source), { userID, source, preference });
    if (this.persistenceTimer) clearTimeout(this.persistenceTimer);
    this.persistenceTimer = setTimeout(() => {
      this.persistenceTimer = undefined;
      void this.flushPersistence().catch((error) => console.warn('[voice] unable to save participant volume', error));
    }, this.persistenceDelayMilliseconds);
  }

  private applyAll(): void {
    for (const key of this.elements.keys()) {
      const parsed = parseAudioKey(key);
      if (parsed) this.applyUser(parsed.userID, parsed.source);
    }
  }

  private applyUser(userID: string, source: ParticipantAudioSource): void {
    for (const element of this.elements.get(audioKey(userID, source)) ?? []) this.apply(userID, source, element);
  }

  private apply(userID: string, source: ParticipantAudioSource, element: AudioOutputElement): void {
    const preference = this.getPreference(userID, source);
    element.volume = preference.muted ? 0 : clampedVolume(this.outputVolume * preference.volume);
    if (this.outputDeviceID) void element.setSinkId(this.outputDeviceID).catch(() => undefined);
  }
}

const audioSources: ParticipantAudioSource[] = ['microphone', 'screen-share'];

function audioKey(userID: string, source: ParticipantAudioSource): string { return `${source}:${userID}`; }

function parseAudioKey(key: string): { userID: string; source: ParticipantAudioSource } | null {
  for (const source of audioSources) {
    const prefix = `${source}:`;
    if (key.startsWith(prefix)) return { source, userID: key.slice(prefix.length) };
  }
  return null;
}

function clampedVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
}

function normalizedPreference(preference: ParticipantAudioPreference): ParticipantAudioPreference {
  return { volume: clampedVolume(preference.volume), muted: preference.muted === true };
}
