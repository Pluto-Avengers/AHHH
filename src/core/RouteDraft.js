/**
 * A route being planned: a start, a destination and any stops between them, each a [row, col]
 * grid point. Immutable (every change returns a new draft), so it can live in React state.
 */
export default class RouteDraft {
  static ROLES = ['start', 'stop', 'end']

  /** @param {{ start?: number[], stops?: number[][], end?: number[], history?: object[] }} parts */
  constructor({ start = null, stops = [], end = null, history = [] } = {}) {
    this.start = start
    this.stops = stops
    this.end = end
    this.history = history // what each placement replaced, for undo
    Object.freeze(this)
  }

  /** Puts a point in a role: 'start' or 'end' replace the current one, 'stop' adds one more. */
  place(role, point) {
    const entry = { role, previous: role === 'stop' ? null : this[role] }
    const next = { start: this.start, stops: this.stops, end: this.end, history: [...this.history, entry] }
    if (role === 'stop') next.stops = [...this.stops, point]
    else next[role] = point
    return new RouteDraft(next)
  }

  /** Takes back the last placement (a replaced start or destination comes back). */
  undo() {
    const last = this.history.at(-1)
    if (!last) return this
    const next = { start: this.start, stops: this.stops, end: this.end, history: this.history.slice(0, -1) }
    if (last.role === 'stop') next.stops = this.stops.slice(0, -1)
    else next[last.role] = last.previous
    return new RouteDraft(next)
  }

  /** The role a new point should take by default: the start, then the destination, then stops. */
  get suggestedRole() {
    if (!this.start) return 'start'
    if (!this.end) return 'end'
    return 'stop'
  }

  /** Points in walking order: start, stops, destination (whichever are set). */
  get points() {
    return [this.start, ...this.stops, this.end].filter(Boolean)
  }

  /** A short label for each of `points`. */
  get labels() {
    return [this.start && 'Start', ...this.stops.map((_, k) => `${k + 1}`), this.end && 'End'].filter(Boolean)
  }

  /** Display names for the planned route's stops, in the same order as `points`. */
  get stopNames() {
    return [this.start && 'Start', ...this.stops.map((_, k) => `Stop ${k + 1}`), this.end && 'Destination'].filter(
      Boolean,
    )
  }

  get ready() {
    return Boolean(this.start && this.end)
  }

  get isEmpty() {
    return this.history.length === 0
  }
}
