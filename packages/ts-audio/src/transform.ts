/**
 * The inverse modified discrete cosine transform, which more than one codec
 * needs: AAC and Vorbis both end a frame with it, over the same phase
 * convention, so it lives here rather than in either of them.
 */

interface ImdctPlan {
  cos: Float64Array
  sin: Float64Array
  fftCos: Float64Array
  fftSin: Float64Array
  reversed: Uint16Array
}

const plans = new Map<number, ImdctPlan>()

function imdctPlan(length: number): ImdctPlan {
  let plan = plans.get(length)
  if (plan)
    return plan
  const quarter = length / 4
  const cos = new Float64Array(quarter)
  const sin = new Float64Array(quarter)
  for (let k = 0; k < quarter; k++) {
    const angle = (2 * Math.PI * (k + 1 / 8)) / length
    cos[k] = Math.cos(angle)
    sin[k] = Math.sin(angle)
  }
  const fftCos = new Float64Array(quarter / 2)
  const fftSin = new Float64Array(quarter / 2)
  for (let k = 0; k < quarter / 2; k++) {
    fftCos[k] = Math.cos((2 * Math.PI * k) / quarter)
    fftSin[k] = Math.sin((2 * Math.PI * k) / quarter)
  }
  const bits = Math.log2(quarter)
  const reversed = new Uint16Array(quarter)
  for (let i = 0; i < quarter; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    reversed[i] = r
  }
  plan = { cos, sin, fftCos, fftSin, reversed }
  plans.set(length, plan)
  return plan
}

/**
 * The inverse MDCT of N/2 coefficients to N samples,
 * x[n] = 2/N · Σ X[k] cos(2π/N · (n + n0) · (k + 1/2)), n0 = (N/2 + 1)/2,
 * through a complex FFT of N/4 points.
 */
export function imdct(input: Float32Array): Float32Array {
  const half = input.length
  const length = half * 2
  const quarter = half / 2
  const eighth = quarter / 2
  const plan = imdctPlan(length)
  const re = new Float64Array(quarter)
  const im = new Float64Array(quarter)
  for (let k = 0; k < quarter; k++) {
    const a = input[2 * k]
    const b = input[half - 1 - 2 * k]
    const c = plan.cos[k]
    const s = plan.sin[k]
    im[k] = a * c + b * s
    re[k] = b * c - a * s
  }
  inverseFft(re, im, plan)
  const scale = 2 / length
  for (let k = 0; k < quarter; k++) {
    const x = re[k]
    const y = im[k]
    const c = plan.cos[k]
    const s = plan.sin[k]
    im[k] = (y * c + x * s) * scale
    re[k] = (x * c - y * s) * scale
  }
  const out = new Float32Array(length)
  for (let k = 0; k < eighth; k += 2) {
    out[2 * k] = im[eighth + k]
    out[2 + 2 * k] = im[eighth + 1 + k]
    out[1 + 2 * k] = -re[eighth - 1 - k]
    out[3 + 2 * k] = -re[eighth - 2 - k]
    out[quarter + 2 * k] = re[k]
    out[quarter + 2 + 2 * k] = re[1 + k]
    out[quarter + 1 + 2 * k] = -im[quarter - 1 - k]
    out[quarter + 3 + 2 * k] = -im[quarter - 2 - k]
    out[half + 2 * k] = re[eighth + k]
    out[half + 2 + 2 * k] = re[eighth + 1 + k]
    out[half + 1 + 2 * k] = -im[eighth - 1 - k]
    out[half + 3 + 2 * k] = -im[eighth - 2 - k]
    out[half + quarter + 2 * k] = -im[k]
    out[half + quarter + 2 + 2 * k] = -im[1 + k]
    out[half + quarter + 1 + 2 * k] = re[quarter - 1 - k]
    out[half + quarter + 3 + 2 * k] = re[quarter - 2 - k]
  }
  return out
}

/** An unscaled complex FFT with a positive exponent, in place, radix 2. */
function inverseFft(re: Float64Array, im: Float64Array, plan: ImdctPlan): void {
  const size = re.length
  for (let i = 0; i < size; i++) {
    const j = plan.reversed[i]
    if (j > i) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  for (let span = 2; span <= size; span *= 2) {
    const half = span / 2
    const step = size / span
    for (let start = 0; start < size; start += span) {
      for (let k = 0; k < half; k++) {
        const c = plan.fftCos[k * step]
        const s = plan.fftSin[k * step]
        const a = start + k
        const b = a + half
        const tr = re[b] * c - im[b] * s
        const ti = re[b] * s + im[b] * c
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
}
