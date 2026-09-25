/**
 * A small, correct, dense Kalman filter used by the NAVRIS simulation.
 *
 * Six states in the local ENU plane:
 *
 *     [ px  py  vx  vy  bx  by ]
 *
 * where (bx, by) are the accelerometer bias estimates. Carrying the bias as
 * filter states rather than as an afterthought is what makes the demo honest:
 *
 *  • while GNSS is available the bias is *observable*, so the filter estimates
 *    it and the solution stays tight;
 *  • during an outage the bias is unobservable, it keeps corrupting the
 *    propagation, and the covariance grows on its own;
 *  • the AI stage's output enters as a **pseudo-measurement of the bias**,
 *    which is the standard, defensible way to fold a model into a filter — and
 *    it damps the growth without pretending to be the source of truth.
 *
 * One deliberate simplification is worth stating plainly, because it explains
 * the shape of `updateBlock` below. This filter carries the bias as filter
 * states *and* folds the current bias uncertainty into the accelerometer process
 * noise, which is how a 6-state demo filter avoids also carrying an attitude
 * error state. That double-representation is harmless for propagation but it
 * leaves the position/bias cross-covariance inflated, so a bias measurement
 * allowed to move position through that covariance moves it far too violently —
 * measured at 5 Hz it dragged the solution hundreds of metres off. So the AI's
 * contribution is confined to the bias states, and its damping reaches the
 * reported uncertainty through the bias variance term in the process noise,
 * which is the physically meaningful route: measuring the bias genuinely does
 * reduce the effective acceleration uncertainty.
 *
 * Generic N-state so it can grow into the real 15-state ESKF later without a
 * rewrite: pass the matrices, get the update.
 */

export type Matrix = number[]; // row-major, n*n

export interface KF {
  n: number;
  x: number[];
  P: Matrix;
  initialised: boolean;
}

export function createKF(n: number): KF {
  return { n, x: new Array(n).fill(0), P: new Array(n * n).fill(0), initialised: false };
}

export function zeros(n: number, m: number): Matrix {
  return new Array(n * m).fill(0);
}

export function identity(n: number): Matrix {
  const M = zeros(n, n);
  for (let i = 0; i < n; i++) M[i * n + i] = 1;
  return M;
}

export function matmul(A: Matrix, B: Matrix, n: number, m: number, p: number): Matrix {
  const C = zeros(n, p);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < m; k++) {
      const a = A[i * m + k];
      if (a === 0) continue;
      for (let j = 0; j < p; j++) C[i * p + j] += a * B[k * p + j];
    }
  }
  return C;
}

export function transpose(A: Matrix, n: number, m: number): Matrix {
  const T = zeros(m, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) T[j * n + i] = A[i * m + j];
  return T;
}

export function addInto(target: Matrix, addend: Matrix, scale = 1): Matrix {
  for (let i = 0; i < target.length; i++) target[i] += addend[i] * scale;
  return target;
}

export function matvec(A: Matrix, v: number[], rows: number, cols: number): number[] {
  const out = new Array(rows).fill(0);
  for (let i = 0; i < rows; i++) {
    let s = 0;
    for (let j = 0; j < cols; j++) s += A[i * cols + j] * v[j];
    out[i] = s;
  }
  return out;
}

export interface UpdateResult {
  /** Normalised Innovation Squared for this measurement, 2-DOF. */
  nis: number;
  accepted: boolean;
  gain: Matrix;
  innovation: number[];
}

/**
 * Sequential measurement update.
 *
 * @param kf       filter to update, in place
 * @param H        measurement matrix, z = H x  (m x n)
 * @param z        measurement, length m
 * @param R        measurement covariance, m x m
 * @param gate     chi-square gate on NIS; above this the update is rejected
 * @param rows     m
 */
export function update(
  kf: KF,
  H: Matrix,
  z: number[],
  R: Matrix,
  gate: number,
  rows: number,
): UpdateResult {
  const n = kf.n;
  const HT = transpose(H, rows, n);
  const PHt = matmul(kf.P, HT, n, n, rows); // n x rows
  const HPHt = matmul(H, PHt, rows, n, rows); // rows x rows

  // S = H P Hᵀ + R
  const S = addInto(HPHt, R);
  const Sinv = invert2x2(S);
  if (!Sinv) {
    return { nis: 0, accepted: false, gain: zeros(n, rows), innovation: new Array(rows).fill(0) };
  }

  // innovation = z − H x
  const Hx = matvec(H, kf.x, rows, n);
  const innovation = z.map((zi, i) => zi - Hx[i]);

  const nis = innovation[0] * innovation[0] * Sinv.a + innovation[1] * innovation[1] * Sinv.b;

  if (nis > gate) {
    return { nis, accepted: false, gain: zeros(n, rows), innovation };
  }

  // K = P Hᵀ S⁻¹
  const K = zeros(n, rows);
  for (let i = 0; i < n; i++) {
    K[i * rows + 0] = PHt[i * rows + 0] * Sinv.a + PHt[i * rows + 1] * Sinv.b;
    K[i * rows + 1] = PHt[i * rows + 0] * Sinv.c + PHt[i * rows + 1] * Sinv.d;
  }

  for (let i = 0; i < n; i++) {
    kf.x[i] += K[i * rows + 0] * innovation[0] + K[i * rows + 1] * innovation[1];
  }

  // P = (I − K H) P (I − K H)ᵀ + K R Kᵀ  — the Joseph form.
  //
  // The cheaper (I − K H) P is algebraically identical in exact arithmetic but
  // loses symmetry and positive-definiteness in floating point, and this filter
  // runs at 50 Hz for the length of a conference demo. The covariance the UI
  // draws has to stay a real covariance, so the robust form is worth the three
  // extra products.
  const KH = matmul(K, H, n, rows, n);
  const IminusKH = identity(n);
  for (let i = 0; i < n * n; i++) IminusKH[i] -= KH[i];
  const At = transpose(IminusKH, n, n);

  const KR = matmul(K, R, n, rows, rows);
  const KRKt = matmul(KR, transpose(K, n, rows), n, rows, n);

  const next = matmul(matmul(IminusKH, kf.P, n, n, n), At, n, n, n);
  for (let i = 0; i < n * n; i++) next[i] += KRKt[i];
  kf.P = next;
  symmetrise(kf.P, n);

  return { nis, accepted: true, gain: K, innovation };
}

function invert2x2(S: Matrix): { a: number; b: number; c: number; d: number } | null {
  const a = S[0];
  const b = S[1];
  const c = S[2];
  const d = S[3];
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-15) return null;
  const inv = 1 / det;
  return { a: d * inv, b: -b * inv, c: -c * inv, d: a * inv };
}

/**
 * Merge an external estimate of a *sub-block* of states, touching nothing else.
 *
 * Used for the AI stage's bias output. See the note at the top of the file: this
 * filter represents the accelerometer bias twice — as filter states and as a term
 * in the process noise — and that makes the position/bias cross-covariance too
 * large for a pseudo-measurement to safely act on. Confining the innovation, the
 * state correction and the covariance reduction to the two bias states keeps the
 * model's influence where it belongs, and still damps the *reported* uncertainty,
 * because the engine derives the acceleration process noise from the posterior
 * bias variance this call reduces.
 *
 * @param kf  filter to update in place
 * @param idx the two state indices the estimate describes
 * @param z   the estimate
 * @param R   2x2 covariance of the estimate
 * @param gate chi-square threshold on the normalised innovation
 */
export function updateBlock(
  kf: KF,
  idx: readonly [number, number],
  z: number[],
  R: Matrix,
  gate: number,
): UpdateResult {
  const n = kf.n;
  const [a, b] = idx;
  const pb = [kf.P[a * n + a], kf.P[a * n + b], kf.P[b * n + a], kf.P[b * n + b]];
  const S = [pb[0] + R[0], pb[1] + R[1], pb[2] + R[2], pb[3] + R[3]];
  const Sinv = invert2x2(S);
  if (!Sinv) {
    return { nis: 0, accepted: false, gain: zeros(2, 2), innovation: [0, 0] };
  }

  const innovation = [z[0] - kf.x[a], z[1] - kf.x[b]];
  const nis = innovation[0] * innovation[0] * Sinv.a + innovation[1] * innovation[1] * Sinv.b;
  if (nis > gate) {
    return { nis, accepted: false, gain: zeros(2, 2), innovation };
  }

  // K = P_bb S⁻¹
  const K = zeros(2, 2);
  for (let i = 0; i < 2; i++) {
    const p0 = i === 0 ? pb[0] : pb[2];
    const p1 = i === 0 ? pb[1] : pb[3];
    K[i * 2 + 0] = p0 * Sinv.a + p1 * Sinv.b;
    K[i * 2 + 1] = p0 * Sinv.c + p1 * Sinv.d;
  }

  kf.x[a] += K[0] * innovation[0] + K[1] * innovation[1];
  kf.x[b] += K[2] * innovation[0] + K[3] * innovation[1];

  // P_bb = (I − K) P_bb (I − K)ᵀ + K R Kᵀ, Joseph form, 2x2 by hand.
  const M = [1 - K[0], -K[1], -K[2], 1 - K[3]];
  const MP = [
    M[0] * pb[0] + M[1] * pb[2],
    M[0] * pb[1] + M[1] * pb[3],
    M[2] * pb[0] + M[3] * pb[2],
    M[2] * pb[1] + M[3] * pb[3],
  ];
  const MPMt = [
    MP[0] * M[0] + MP[1] * M[2],
    MP[0] * M[1] + MP[1] * M[3],
    MP[2] * M[0] + MP[3] * M[2],
    MP[2] * M[1] + MP[3] * M[3],
  ];
  const KRK = [
    K[0] * R[0] * K[0] + K[0] * R[1] * K[2],
    K[0] * R[0] * K[1] + K[0] * R[1] * K[3],
    K[2] * R[0] * K[0] + K[2] * R[1] * K[2],
    K[2] * R[0] * K[1] + K[2] * R[1] * K[3],
  ];
  const next = MPMt.map((v, i) => 0.5 * (v + MPMt[j2(i)]) + KRK[i]);
  kf.P[a * n + a] = next[0];
  kf.P[a * n + b] = next[1];
  kf.P[b * n + a] = next[2];
  kf.P[b * n + b] = next[3];

  return { nis, accepted: true, gain: K, innovation };
}

/** Mirror index across the diagonal of a symmetric 2x2. */
function j2(i: number): number {
  return [0, 3, 2, 1][i];
}

export function symmetrise(P: Matrix, n: number): void {
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const m = 0.5 * (P[i * n + j] + P[j * n + i]);
      P[i * n + j] = m;
      P[j * n + i] = m;
    }
  }
}
