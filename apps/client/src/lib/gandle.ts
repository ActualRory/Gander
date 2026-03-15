import { GANDLE_WORDS } from './gandleWords.ts'

export const WORD_LENGTH = 6
export const MAX_GUESSES = 6

// Filter to only valid 6-letter words (guards against typos in the word list)
const ANSWER_WORDS = GANDLE_WORDS.filter(w => w.length === WORD_LENGTH && /^[a-z]+$/.test(w))

/** Returns today's puzzle date as "YYYY-MM-DD" (UTC) */
export function todayDate(): string {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Returns milliseconds until the next UTC midnight */
export function msUntilNextUTCMidnight(): number {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return next.getTime() - now.getTime()
}

/** Returns the answer word for a given date string "YYYY-MM-DD" */
export function getDailyWord(date: string): string {
  // Deterministic index from date — days since a fixed epoch
  const epoch = new Date('2024-01-01').getTime()
  const ms = new Date(date).getTime()
  const dayIndex = Math.floor((ms - epoch) / 86_400_000)
  return ANSWER_WORDS[((dayIndex % ANSWER_WORDS.length) + ANSWER_WORDS.length) % ANSWER_WORDS.length]
}

export type LetterState = 'correct' | 'present' | 'absent' | 'empty' | 'active'

export interface EvaluatedRow {
  letters: { char: string; state: 'correct' | 'present' | 'absent' }[]
}

/** Evaluate a guess against the answer — returns per-letter states */
export function evaluateGuess(guess: string, answer: string): EvaluatedRow {
  const g = guess.toLowerCase().split('')
  const a = answer.toLowerCase().split('')
  const states: ('correct' | 'present' | 'absent')[] = Array(WORD_LENGTH).fill('absent')
  const answerRemaining = [...a]

  // First pass: mark correct
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (g[i] === a[i]) {
      states[i] = 'correct'
      answerRemaining[i] = ''
    }
  }

  // Second pass: mark present
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (states[i] === 'correct') continue
    const idx = answerRemaining.indexOf(g[i])
    if (idx !== -1) {
      states[i] = 'present'
      answerRemaining[idx] = ''
    }
  }

  return { letters: g.map((char, i) => ({ char, state: states[i] })) }
}

/** Returns whether a word is an acceptable guess */
export function isValidGuess(word: string): boolean {
  return word.length === WORD_LENGTH && /^[a-z]+$/.test(word.toLowerCase())
}

/** Compute keyboard letter states from evaluated rows */
export function getKeyboardStates(rows: EvaluatedRow[]): Record<string, 'correct' | 'present' | 'absent'> {
  const states: Record<string, 'correct' | 'present' | 'absent'> = {}
  for (const row of rows) {
    for (const { char, state } of row.letters) {
      const current = states[char]
      // Priority: correct > present > absent
      if (current === 'correct') continue
      if (state === 'correct') { states[char] = 'correct'; continue }
      if (current === 'present') continue
      states[char] = state
    }
  }
  return states
}

/** Format a score for display in the leaderboard */
export function formatScore(guessCount: number, solved: boolean): string {
  if (!solved) return `X/${MAX_GUESSES}`
  return `${guessCount}/${MAX_GUESSES}`
}
