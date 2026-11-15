// Martial's bark, synthesized with the Web Audio API (no sound file needed): two short "woofs",
// each a pitch-dropping tone plus a burst of filtered noise for the rasp.

export class MartialVoice {
  #ctx = null

  /** Call from a click or key press: browsers only allow sound after the user interacts. */
  unlock() {
    try {
      this.#ctx ??= new (window.AudioContext || window.webkitAudioContext)()
      if (this.#ctx.state === 'suspended') this.#ctx.resume()
    } catch {
      this.#ctx = null // no Web Audio: Martial just stays quiet
    }
  }

  /** "Woof woof!" Does nothing if sound isn't available or hasn't been unlocked yet. */
  bark() {
    if (!this.#ctx || this.#ctx.state !== 'running') return
    const t = this.#ctx.currentTime + 0.02
    this.#woof(t, 420, 0.16)
    this.#woof(t + 0.22, 470, 0.14)
  }

  #woof(start, pitch, length) {
    const ctx = this.#ctx
    const out = ctx.createGain()
    out.gain.setValueAtTime(0.0001, start)
    out.gain.exponentialRampToValueAtTime(0.5, start + 0.012)
    out.gain.exponentialRampToValueAtTime(0.0001, start + length)
    out.connect(ctx.destination)

    // Voice: a sawtooth that drops in pitch, softened by a low-pass filter
    const voice = ctx.createOscillator()
    voice.type = 'sawtooth'
    voice.frequency.setValueAtTime(pitch, start)
    voice.frequency.exponentialRampToValueAtTime(pitch * 0.55, start + length)
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.setValueAtTime(1800, start)
    tone.frequency.exponentialRampToValueAtTime(600, start + length)
    tone.Q.value = 6
    voice.connect(tone).connect(out)
    voice.start(start)
    voice.stop(start + length + 0.02)

    // Rasp: a short burst of noise around 1 kHz
    const samples = Math.ceil(ctx.sampleRate * length)
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < samples; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / samples)
    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 1100
    band.Q.value = 1.2
    const noiseGain = ctx.createGain()
    noiseGain.gain.value = 0.35
    noise.connect(band).connect(noiseGain).connect(out)
    noise.start(start)
  }
}

/** One voice for the whole app (browsers limit how many audio contexts a page may open). */
export const martialVoice = new MartialVoice()
