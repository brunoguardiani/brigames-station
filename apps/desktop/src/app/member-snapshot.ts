// Preserve WebSocket events received while an HTTP snapshot is in flight,
// including updates for members that are not in the local list yet.
export class MemberSnapshot<T extends { id: number }> {
  private pending = new Set<Map<number, Array<(member: T) => T>>>();

  patch(id: number, patch: Partial<T> | ((member: T) => T)): void {
    const apply = typeof patch === 'function' ? patch : (member: T): T => ({ ...member, ...patch });
    for (const changes of this.pending) changes.set(id, [...changes.get(id) ?? [], apply]);
  }

  async load(fetch: () => Promise<T[]>): Promise<T[]> {
    const changes = new Map<number, Array<(member: T) => T>>();
    this.pending.add(changes);
    try {
      const members = await fetch();
      return members.map((member) => (changes.get(member.id) ?? []).reduce((current, apply) => apply(current), member));
    } finally {
      this.pending.delete(changes);
    }
  }
}
