import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.ts'
import {
  WORD_LENGTH, MAX_GUESSES,
  todayDate, getDailyWord,
  evaluateGuess, isValidGuess, getKeyboardStates, formatScore,
  type EvaluatedRow,
} from '../lib/gandle.ts'
import styles from './GandleView.module.css'

interface LeaderboardEntry {
  userId: string
  displayName: string
  avatarUrl: string | null
  solved: boolean
  guessCount: number
  guesses: string[] | null
  completedAt: string
}

interface Props {
  token: string
  currentUserId: string
}

const KEYBOARD_ROWS = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['Enter','z','x','c','v','b','n','m','⌫'],
]

export default function GandleView({ token, currentUserId }: Props) {
  const date = todayDate()
  const answer = getDailyWord(date)

  // Game state
  const [completedRows, setCompletedRows] = useState<EvaluatedRow[]>([])
  const [currentInput, setCurrentInput] = useState('')
  const [gameOver, setGameOver] = useState(false)
  const [solved, setSolved] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [loading, setLoading] = useState(true)

  // Leaderboard state
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [viewingEntry, setViewingEntry] = useState<LeaderboardEntry | null>(null)

  const progressKey = `gander:gandle-progress:${date}`

  // Load today's state from server, fall back to localStorage for in-progress guesses
  useEffect(() => {
    api.gandleToday(token).then(res => {
      if (res.played && res.result) {
        const rows = res.result.guesses.map(g => evaluateGuess(g, answer))
        setCompletedRows(rows)
        setGameOver(true)
        setSolved(res.result.solved)
        localStorage.removeItem(progressKey)
      } else {
        // Restore in-progress guesses from localStorage
        try {
          const saved = localStorage.getItem(progressKey)
          if (saved) {
            const { guesses } = JSON.parse(saved) as { guesses: string[] }
            const rows = guesses.map(g => evaluateGuess(g, answer))
            setCompletedRows(rows)
          }
        } catch { /* ignore */ }
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [token, answer])

  // Load leaderboard on mount and whenever game is completed
  useEffect(() => {
    api.gandleLeaderboard(token, date).then(setLeaderboard).catch(() => {})
  }, [token, date])

  useEffect(() => {
    if (!gameOver) return
    api.gandleLeaderboard(token, date).then(setLeaderboard).catch(() => {})
  }, [gameOver, token, date])

  const keyboardStates = getKeyboardStates(completedRows)

  const showMessage = useCallback((msg: string, duration = 1800) => {
    setMessage(msg)
    setTimeout(() => setMessage(null), duration)
  }, [])

  const submitGuess = useCallback(async () => {
    const guess = currentInput.toLowerCase()
    if (guess.length !== WORD_LENGTH) { showMessage(`need ${WORD_LENGTH} letters`); return }
    if (!isValidGuess(guess)) {
      setShake(true)
      showMessage('letters only')
      setTimeout(() => setShake(false), 500)
      return
    }

    const row = evaluateGuess(guess, answer)
    const newRows = [...completedRows, row]
    setCompletedRows(newRows)
    setCurrentInput('')

    const didSolve = guess === answer
    const isLast = newRows.length >= MAX_GUESSES
    const wordList = newRows.map(r => r.letters.map(l => l.char).join(''))

    if (didSolve || isLast) {
      setGameOver(true)
      setSolved(didSolve)
      if (didSolve) showMessage(newRows.length === 1 ? 'genius!' : newRows.length <= 3 ? 'great!' : 'got it!', 2000)
      else showMessage(answer.toUpperCase(), 4000)

      // Submit to server and clear local progress
      try {
        await api.gandleSubmit(token, date, wordList, didSolve)
        localStorage.removeItem(progressKey)
        const lb = await api.gandleLeaderboard(token, date)
        setLeaderboard(lb)
      } catch { /* ignore submission errors */ }
    } else {
      // Persist in-progress guesses
      localStorage.setItem(progressKey, JSON.stringify({ guesses: wordList }))
    }
  }, [currentInput, completedRows, answer, token, date, progressKey, showMessage])

  // Physical keyboard handler
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (gameOver) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Enter') { submitGuess(); return }
      if (e.key === 'Backspace') { setCurrentInput(p => p.slice(0, -1)); return }
      if (/^[a-zA-Z]$/.test(e.key) && currentInput.length < WORD_LENGTH) {
        setCurrentInput(p => p + e.key.toLowerCase())
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [gameOver, currentInput, submitGuess])

  function handleKey(key: string) {
    if (gameOver) return
    if (key === 'Enter') { submitGuess(); return }
    if (key === '⌫') { setCurrentInput(p => p.slice(0, -1)); return }
    if (currentInput.length < WORD_LENGTH) setCurrentInput(p => p + key)
  }

  // Build display rows: completed + active + empty
  const displayRows: Array<{ type: 'completed'; row: EvaluatedRow } | { type: 'active' } | { type: 'empty' }> = []
  for (const row of completedRows) displayRows.push({ type: 'completed', row })
  if (!gameOver && displayRows.length < MAX_GUESSES) displayRows.push({ type: 'active' })
  while (displayRows.length < MAX_GUESSES) displayRows.push({ type: 'empty' })

  if (loading) {
    return <div className={styles.root}><div className={styles.loading}>loading...</div></div>
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>GANDLE</span>
        <span className={styles.dateLabel}>{date}</span>
      </div>

      {message && <div className={styles.message}>{message}</div>}

      <div className={styles.columns}>
        {/* Left: game board */}
        <div className={styles.gameCol}>
          <div className={styles.board}>
            {displayRows.map((dr, ri) => {
              if (dr.type === 'completed') {
                return (
                  <div key={ri} className={styles.row}>
                    {dr.row.letters.map((l, ci) => (
                      <div key={ci} className={`${styles.cell} ${styles[l.state]}`}>
                        {l.char.toUpperCase()}
                      </div>
                    ))}
                  </div>
                )
              }
              if (dr.type === 'active') {
                return (
                  <div key={ri} className={`${styles.row} ${shake ? styles.shake : ''}`}>
                    {Array.from({ length: WORD_LENGTH }).map((_, ci) => {
                      const ch = currentInput[ci]
                      return (
                        <div key={ci} className={`${styles.cell} ${ch ? styles.filled : styles.empty}`}>
                          {ch?.toUpperCase() ?? ''}
                        </div>
                      )
                    })}
                  </div>
                )
              }
              return (
                <div key={ri} className={styles.row}>
                  {Array.from({ length: WORD_LENGTH }).map((_, ci) => (
                    <div key={ci} className={`${styles.cell} ${styles.empty}`} />
                  ))}
                </div>
              )
            })}
          </div>

          {!gameOver && (
            <div className={styles.keyboard}>
              {KEYBOARD_ROWS.map((row, ri) => (
                <div key={ri} className={styles.keyRow}>
                  {row.map(key => {
                    const state = keyboardStates[key]
                    const isWide = key === 'Enter' || key === '⌫'
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`${styles.key} ${isWide ? styles.keyWide : ''} ${state ? styles[`key_${state}`] : ''}`}
                        onClick={() => handleKey(key)}
                      >
                        {key}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          {gameOver && (
            <div className={styles.resultBanner}>
              {solved
                ? `solved in ${completedRows.length}/${MAX_GUESSES}!`
                : `the word was: ${answer.toUpperCase()}`}
            </div>
          )}
        </div>

        {/* Right: leaderboard */}
        <div className={styles.leaderboardCol}>
          <div className={styles.leaderboardTitle}>
            today's scores
            {!gameOver && leaderboard.length > 0 && <span className={styles.leaderboardHint}> — play to see guesses</span>}
          </div>
          {leaderboard.length === 0 && (
            <div className={styles.leaderboardEmpty}>no scores yet today</div>
          )}
          {leaderboard.map(entry => (
            <button
              key={entry.userId}
              type="button"
              className={`${styles.leaderboardEntry} ${entry.userId === currentUserId ? styles.leaderboardSelf : ''} ${entry.guesses ? styles.leaderboardClickable : ''}`}
              onClick={() => entry.guesses && setViewingEntry(viewingEntry?.userId === entry.userId ? null : entry)}
            >
              <span className={styles.lbName}>{entry.displayName}</span>
              <span className={`${styles.lbScore} ${entry.solved ? styles.lbScoreSolved : styles.lbScoreFailed}`}>
                {formatScore(entry.guessCount, entry.solved)}
              </span>
            </button>
          ))}

          {/* Guess replay for selected entry */}
          {viewingEntry && viewingEntry.guesses && (
            <div className={styles.replayPanel}>
              <div className={styles.replayTitle}>{viewingEntry.displayName}'s guesses</div>
              {viewingEntry.guesses.map((g, i) => {
                const row = evaluateGuess(g, answer)
                return (
                  <div key={i} className={styles.replayRow}>
                    {row.letters.map((l, j) => (
                      <div key={j} className={`${styles.replayCell} ${styles[l.state]}`}>
                        {l.char.toUpperCase()}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
