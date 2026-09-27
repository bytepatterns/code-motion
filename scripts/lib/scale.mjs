/**
 * Pitch mapping for data sonification.
 *
 * The bar values are ranked (smallest = 0) and each rank is given a degree of a
 * MAJOR PENTATONIC scale. Pentatonic is the whole trick: it has no semitone and
 * no tritone, so ANY two ranks played together or in sequence are consonant.
 * A bubble sort fires a long, fast, essentially random sequence of these notes —
 * on a diatonic scale that would be chaotic, on a pentatonic it is a melody.
 *
 * 8 ranks span exactly one octave plus a major third, which keeps the lowest
 * note fat on a phone speaker and the highest note short of shrill.
 */

/** Semitone offsets from the root for ranks 0..7. */
export const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16];

export const noteHz = (rootHz, semitones) => rootHz * Math.pow(2, semitones / 12);

/** rank -> Hz on the pentatonic ladder rooted at `rootHz`. */
export const rankHz = (rootHz, rank, steps = PENTATONIC) =>
  noteHz(rootHz, steps[Math.max(0, Math.min(steps.length - 1, rank))]);

/**
 * Deterministic micro-detune (cents) per rank. Real mallet instruments are
 * never exactly in tune with themselves; ±5 cents stops a repeated rank from
 * sounding like a copy-pasted sample without ever reading as "out of tune".
 */
export const humanizeCents = (rank, salt = 0) => (((rank * 37 + salt * 13) % 11) - 5) * 0.9;

/** Deterministic micro-gain per rank, same reasoning as the detune (±6 %). */
export const humanizeGain = (rank, salt = 0) => 1 + ((((rank * 23 + salt * 7) % 9) - 4) / 4) * 0.06;

/** Common note roots. */
export const C3 = 130.813;
export const C4 = 261.626;
export const C5 = 523.251;
export const A1 = 55.0;
export const G2 = 97.999;
