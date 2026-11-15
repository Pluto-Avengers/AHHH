/* Layered wave edge that sits on top of a coloured band or the footer */
export default function Wave() {
  return (
    <svg className="wave" viewBox="0 0 1440 90" preserveAspectRatio="none" aria-hidden="true">
      <path className="wave-back" d="M0 38 C200 4 420 70 700 36 S1180 2 1440 30 V90 H0 Z" />
      <path d="M0 58 C260 20 500 92 760 56 S1220 26 1440 60 V90 H0 Z" />
    </svg>
  )
}
