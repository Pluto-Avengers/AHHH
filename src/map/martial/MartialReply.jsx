// Lays out one of Martial's replies so each idea gets its own space:
// the report title, labelled fields (MISSION: …), section headings (INITIAL DEPARTURE, …),
// numbered steps and plain sentences. The reply text itself is unchanged.

import { ReplyParser } from './ReplyParser.js'

const parser = new ReplyParser()
// "500 M WEST OF STOP 1" -> "500 m West Of Stop 1": units after a number stay lower case
const titleCase = (s) =>
  s
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase())
    .replace(/(\d) (M|Km)\b/g, (_, d, unit) => `${d} ${unit.toLowerCase()}`)

export default function MartialReply({ text, typing }) {
  return (
    <div className="martial-reply">
      {parser.parse(text, typing).map((b, k) => {
        switch (b.type) {
          case 'title':
            return (
              <h3 key={k} className="reply-title">
                {titleCase(b.text)}
              </h3>
            )
          case 'heading':
            return (
              <h4 key={k} className="reply-heading">
                {titleCase(b.text)}
              </h4>
            )
          case 'field':
            return (
              <div key={k} className="reply-field">
                <span className="reply-label">{titleCase(b.label)}</span>
                <span className="reply-value">{b.value}</span>
              </div>
            )
          case 'steps':
            return (
              <ol key={k} className="reply-steps" start={b.start}>
                {b.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ol>
            )
          case 'gap':
            return null
          default:
            return (
              <p key={k} className="reply-text">
                {b.text}
              </p>
            )
        }
      })}
    </div>
  )
}
