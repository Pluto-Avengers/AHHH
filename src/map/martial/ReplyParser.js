// Reads the plain-text layout of Martial's replies (see backend/martial/prompts.py) into display blocks.

/** Splits a reply into blocks: title, field, heading, steps, text, and gaps from blank lines. */
export class ReplyParser {
  static FIELD = /^([A-Z][A-Z ]{2,}):\s*(.*)$/
  static HEADING = /^[A-Z][A-Z0-9 ()'&/-]{3,}$/
  static STEP = /^(\d+)\.\s+(.*)$/

  #blocks = []

  /** @param {boolean} typing the reply is still typing out, so its last line may be cut mid-word */
  parse(text, typing = false) {
    this.#blocks = []
    const lines = text.split('\n')
    lines.forEach((raw, k) => this.#addLine(raw.trim(), typing && k === lines.length - 1))
    return this.#blocks
  }

  #addLine(line, partial) {
    const { FIELD, HEADING, STEP } = ReplyParser
    const blocks = this.#blocks
    if (!line) {
      if (blocks.length && blocks.at(-1).type !== 'gap') blocks.push({ type: 'gap' })
      return
    }
    const step = line.match(STEP)
    if (step) {
      const last = blocks.at(-1)
      if (last?.type === 'steps') last.items.push(step[2])
      else blocks.push({ type: 'steps', start: Number(step[1]), items: [step[2]] })
      return
    }
    if (FIELD.test(line)) {
      // "MISSION: X | DESTINATION: Y" holds two fields on one line
      for (const part of line.split(/\s+\|\s+/)) {
        const f = part.match(FIELD)
        blocks.push(f ? { type: 'field', label: f[1], value: f[2] } : { type: 'text', text: part })
      }
      return
    }
    // A cut-off last line is shown plainly until it is complete.
    if (!partial && HEADING.test(line)) {
      blocks.push({ type: blocks.length === 0 ? 'title' : 'heading', text: line })
      return
    }
    blocks.push({ type: 'text', text: line })
  }
}
