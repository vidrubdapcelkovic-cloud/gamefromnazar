const DAY_NIGHT_CONFIG = Object.freeze({
  dayDurationMs: 600000,
  minutesPerDay: 24 * 60,
  startDayNumber: 1,
  startHour: 8,
  dayStartHour: 6,
  nightStartHour: 20,
  dawnStartHour: 6,
  dawnEndHour: 8,
  duskStartHour: 18,
  duskEndHour: 20,
  maximumNightAlpha: 0.45
});

class DayNightSystem {
  constructor(initialState) {
    const normalized = DayNightSystem.normalizeState(initialState);
    this.dayNumber = normalized.dayNumber;
    this.timeOfDayMs = normalized.timeOfDayMs;
  }

  static getStartTimeOfDayMs() {
    return DAY_NIGHT_CONFIG.dayDurationMs * DAY_NIGHT_CONFIG.startHour / 24;
  }

  static normalizeState(state) {
    let dayNumber = state && Number.isInteger(state.dayNumber) && state.dayNumber >= 1
      ? state.dayNumber
      : DAY_NIGHT_CONFIG.startDayNumber;
    let timeOfDayMs = state && Number.isFinite(state.timeOfDayMs) && state.timeOfDayMs >= 0
      ? state.timeOfDayMs
      : DayNightSystem.getStartTimeOfDayMs();
    const elapsedDays = Math.floor(timeOfDayMs / DAY_NIGHT_CONFIG.dayDurationMs);
    dayNumber += elapsedDays;
    timeOfDayMs %= DAY_NIGHT_CONFIG.dayDurationMs;
    return { dayNumber, timeOfDayMs };
  }

  update(delta) {
    if (!Number.isFinite(delta) || delta <= 0) return false;
    const total = this.timeOfDayMs + delta;
    const elapsedDays = Math.floor(total / DAY_NIGHT_CONFIG.dayDurationMs);
    this.timeOfDayMs = total % DAY_NIGHT_CONFIG.dayDurationMs;
    if (elapsedDays > 0) this.dayNumber += elapsedDays;
    return true;
  }

  getMinuteOfDay() {
    return Math.floor(
      this.timeOfDayMs / DAY_NIGHT_CONFIG.dayDurationMs * DAY_NIGHT_CONFIG.minutesPerDay
    ) % DAY_NIGHT_CONFIG.minutesPerDay;
  }

  getHours() { return Math.floor(this.getMinuteOfDay() / 60); }
  getMinutes() { return this.getMinuteOfDay() % 60; }

  getPhase() {
    const hour = this.getMinuteOfDay() / 60;
    return hour >= DAY_NIGHT_CONFIG.dayStartHour && hour < DAY_NIGHT_CONFIG.nightStartHour
      ? 'DAY'
      : 'NIGHT';
  }

  getOverlayAlpha() {
    const hour = this.timeOfDayMs / DAY_NIGHT_CONFIG.dayDurationMs * 24;
    const maximum = DAY_NIGHT_CONFIG.maximumNightAlpha;
    if (hour < DAY_NIGHT_CONFIG.dawnStartHour) return maximum;
    if (hour < DAY_NIGHT_CONFIG.dawnEndHour) {
      return maximum * (DAY_NIGHT_CONFIG.dawnEndHour - hour)
        / (DAY_NIGHT_CONFIG.dawnEndHour - DAY_NIGHT_CONFIG.dawnStartHour);
    }
    if (hour < DAY_NIGHT_CONFIG.duskStartHour) return 0;
    if (hour < DAY_NIGHT_CONFIG.duskEndHour) {
      return maximum * (hour - DAY_NIGHT_CONFIG.duskStartHour)
        / (DAY_NIGHT_CONFIG.duskEndHour - DAY_NIGHT_CONFIG.duskStartHour);
    }
    return maximum;
  }

  formatHud() {
    const phaseLabel = this.getPhase() === 'DAY' ? 'День' : 'Ночь';
    const hours = String(this.getHours()).padStart(2, '0');
    const minutes = String(this.getMinutes()).padStart(2, '0');
    return `${phaseLabel} ${this.dayNumber} — ${hours}:${minutes}`;
  }

  getHudStateKey() {
    return `${this.dayNumber}:${this.getPhase()}:${this.getMinuteOfDay()}`;
  }

  exportState() { return { dayNumber: this.dayNumber, timeOfDayMs: this.timeOfDayMs }; }

  importState(state) {
    const normalized = DayNightSystem.normalizeState(state);
    this.dayNumber = normalized.dayNumber;
    this.timeOfDayMs = normalized.timeOfDayMs;
    return true;
  }
}
