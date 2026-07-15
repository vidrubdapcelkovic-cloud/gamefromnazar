const SAVE_SLOT_KEYS = Object.freeze({
  1: 'gamefromnazar-save-slot-1-v1',
  2: 'gamefromnazar-save-slot-2-v1'
});
const LEGACY_SAVE_KEY = 'gamefromnazar-save-v1';
const SAVE_SLOT_MIGRATION_KEY = 'gamefromnazar-save-migration-slots-v1';

class SaveSlotManager {
  constructor(storage) {
    if (storage !== undefined) this.storage = storage;
    else {
      try { this.storage = globalThis.localStorage; }
      catch { this.storage = null; }
    }
  }

  isValidSlotId(slotId) {
    return slotId === 1 || slotId === 2;
  }

  getSlotKey(slotId) {
    return this.isValidSlotId(slotId) ? SAVE_SLOT_KEYS[slotId] : null;
  }

  read(slotId) {
    const key = this.getSlotKey(slotId);
    if (key === null) return { success: false, reason: 'invalidSlot' };
    if (!this.storage) return { success: false, reason: 'storageError' };
    try {
      const raw = this.storage.getItem(key);
      if (raw === null) return { success: false, reason: 'empty' };
      try { return { success: true, value: JSON.parse(raw), raw }; }
      catch { return { success: false, reason: 'invalidJson' }; }
    } catch { return { success: false, reason: 'storageError' }; }
  }

  write(slotId, value) {
    const key = this.getSlotKey(slotId);
    if (key === null) return { success: false, reason: 'invalidSlot' };
    if (!this.storage) return { success: false, reason: 'storageError' };
    try {
      this.storage.setItem(key, JSON.stringify(value));
      return { success: true };
    } catch { return { success: false, reason: 'storageError' }; }
  }

  delete(slotId) {
    const key = this.getSlotKey(slotId);
    if (key === null) return { success: false, reason: 'invalidSlot' };
    if (!this.storage) return { success: false, reason: 'storageError' };
    try {
      this.storage.removeItem(key);
      return this.storage.getItem(key) === null
        ? { success: true }
        : { success: false, reason: 'storageError' };
    } catch { return { success: false, reason: 'storageError' }; }
  }

  has(slotId) {
    const result = this.read(slotId);
    if (result.success) return { success: true, exists: true };
    if (result.reason === 'empty') return { success: true, exists: false };
    return result;
  }

  inspectSlot(slotId) {
    if (!this.isValidSlotId(slotId)) return { status: 'INVALID', reason: 'invalidSlot' };
    const readResult = this.read(slotId);
    if (!readResult.success) {
      if (readResult.reason === 'empty') return { status: 'EMPTY' };
      if (readResult.reason === 'invalidJson') return { status: 'CORRUPT' };
      return { status: 'ERROR', reason: readResult.reason };
    }
    const normalized = SaveSystem.normalizeState(readResult.value);
    if (normalized === null) return { status: 'CORRUPT' };
    const dayNight = new DayNightSystem(normalized.dayNight);
    return {
      status: 'VALID',
      state: normalized,
      summary: dayNight.formatHud()
    };
  }

  migrateLegacySave() {
    if (!this.storage) return { success: false, reason: 'storageError' };
    try {
      if (this.storage.getItem(SAVE_SLOT_MIGRATION_KEY) !== null) {
        return { success: true, migrated: false, reason: 'alreadyAttempted' };
      }

      let migrated = false;
      const slotOneIsEmpty = this.storage.getItem(SAVE_SLOT_KEYS[1]) === null;
      const legacyRaw = this.storage.getItem(LEGACY_SAVE_KEY);
      if (slotOneIsEmpty && legacyRaw !== null) {
        try {
          const parsed = JSON.parse(legacyRaw);
          if (SaveSystem.normalizeState(parsed) !== null) {
            this.storage.setItem(SAVE_SLOT_KEYS[1], legacyRaw);
            migrated = true;
          }
        } catch {}
      }

      this.storage.setItem(SAVE_SLOT_MIGRATION_KEY, '1');
      return { success: true, migrated };
    } catch { return { success: false, reason: 'storageError' }; }
  }
}
