export type ParticipantAudioPreference = { volume: number; muted: boolean };
export type ParticipantAudioPreferences = Record<string, ParticipantAudioPreference>;

export type ParticipantAudioPreferenceStorage = {
  load(): Promise<ParticipantAudioPreferences>;
  save(userID: string, preference: ParticipantAudioPreference | null): Promise<void>;
};

type AudioOutputElement = Pick<HTMLAudioElement, 'volume' | 'setSinkId'>;

const defaultPreference: ParticipantAudioPreference = { volume: 1, muted: false };

export class ParticipantAudioService {
  private readonly preferences = new Map<string, ParticipantAudioPreference>();
  private readonly elements = new Map<string, Set<AudioOutputElement>>();
  private readonly pendingPersistence = new Map<string, ParticipantAudioPreference | null>();
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
    for (const [userID, preference] of Object.entries(saved)) {
      this.preferences.set(userID, normalizedPreference(preference));
    }
    this.applyAll();
    this.onChange();
  }

  getPreference(userID: string): ParticipantAudioPreference {
    return { ...(this.preferences.get(userID) ?? defaultPreference) };
  }

  register(userID: string, element: AudioOutputElement): void {
    const elements = this.elements.get(userID) ?? new Set<AudioOutputElement>();
    elements.add(element);
    this.elements.set(userID, elements);
    this.apply(userID, element);
  }

  unregister(userID: string, element: AudioOutputElement): void {
    const elements = this.elements.get(userID);
    elements?.delete(element);
    if (elements?.size === 0) this.elements.delete(userID);
  }

  setOutput(volume: number, deviceID: string | null): void {
    this.outputVolume = clampedVolume(volume);
    this.outputDeviceID = deviceID || null;
    this.applyAll();
  }

  setVolume(userID: string, volume: number): void {
    const current = this.getPreference(userID);
    this.updatePreference(userID, { ...current, volume: clampedVolume(volume) });
  }

  setMuted(userID: string, muted: boolean): void {
    const current = this.getPreference(userID);
    this.updatePreference(userID, { ...current, muted });
  }

  reset(userID: string): void {
    this.preferences.delete(userID);
    this.applyUser(userID);
    this.schedulePersistence(userID, null);
    this.onChange();
  }

  async flushPersistence(): Promise<void> {
    if (this.persistenceTimer) clearTimeout(this.persistenceTimer);
    this.persistenceTimer = undefined;
    const pending = [...this.pendingPersistence.entries()];
    this.pendingPersistence.clear();
    await Promise.all(pending.map(([userID, preference]) => this.storage.save(userID, preference)));
  }

  private updatePreference(userID: string, preference: ParticipantAudioPreference): void {
    const normalized = normalizedPreference(preference);
    this.preferences.set(userID, normalized);
    this.applyUser(userID);
    this.schedulePersistence(userID, normalized);
    this.onChange();
  }

  private schedulePersistence(userID: string, preference: ParticipantAudioPreference | null): void {
    this.pendingPersistence.set(userID, preference);
    if (this.persistenceTimer) clearTimeout(this.persistenceTimer);
    this.persistenceTimer = setTimeout(() => {
      this.persistenceTimer = undefined;
      void this.flushPersistence().catch((error) => console.warn('[voice] unable to save participant volume', error));
    }, this.persistenceDelayMilliseconds);
  }

  private applyAll(): void {
    for (const userID of this.elements.keys()) this.applyUser(userID);
  }

  private applyUser(userID: string): void {
    for (const element of this.elements.get(userID) ?? []) this.apply(userID, element);
  }

  private apply(userID: string, element: AudioOutputElement): void {
    const preference = this.getPreference(userID);
    element.volume = preference.muted ? 0 : clampedVolume(this.outputVolume * preference.volume);
    if (this.outputDeviceID) void element.setSinkId(this.outputDeviceID).catch(() => undefined);
  }
}

function clampedVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
}

function normalizedPreference(preference: ParticipantAudioPreference): ParticipantAudioPreference {
  return { volume: clampedVolume(preference.volume), muted: preference.muted === true };
}
