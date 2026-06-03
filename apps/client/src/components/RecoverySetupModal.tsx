import { useEffect, useState } from 'react'
import { api } from '../lib/api.ts'
import styles from './RecoverySetupModal.module.css'

interface Props {
  token: string
  onDone: () => void
  onSkip: () => void
}

export default function RecoverySetupModal({ token, onDone, onSkip }: Props) {
  const [questions, setQuestions] = useState<string[]>([])
  const [q1, setQ1] = useState('')
  const [a1, setA1] = useState('')
  const [q2, setQ2] = useState('')
  const [a2, setA2] = useState('')
  const [q3, setQ3] = useState('')
  const [a3, setA3] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.getRecoveryQuestions().then(r => setQuestions(r.questions)).catch(() => {})
  }, [])

  const chosen = new Set([q1, q2, q3].filter(Boolean))

  function availableFor(current: string) {
    return questions.filter(q => q === current || !chosen.has(q))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!q1 || !a1 || !q2 || !a2 || !q3 || !a3) {
      setError('All questions and answers are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.setupRecovery(token, { question1: q1, answer1: a1, question2: q2, answer2: a2, question3: q3, answer3: a3 })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.title}>set up account recovery</div>
        <p className={styles.desc}>
          Choose 3 security questions. These let you request a password reset if you get locked out.
          Answers are case-insensitive and stored securely.
        </p>
        <form onSubmit={submit} className={styles.form}>
          {([
            [q1, setQ1, a1, setA1],
            [q2, setQ2, a2, setA2],
            [q3, setQ3, a3, setA3],
          ] as const).map(([q, setQ, a, setA], i) => (
            <div key={i} className={styles.questionBlock}>
              <select
                value={q}
                onChange={e => { (setQ as (v: string) => void)(e.target.value) }}
                className={styles.select}
                required
              >
                <option value="">— select question {i + 1} —</option>
                {availableFor(q as string).map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <input
                placeholder="your answer"
                value={a as string}
                onChange={e => (setA as (v: string) => void)(e.target.value)}
                className={styles.answerInput}
                required
              />
            </div>
          ))}
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button type="button" className={styles.skipBtn} onClick={onSkip}>skip for now</button>
            <button type="submit" className={styles.saveBtn} disabled={saving}>
              {saving ? 'saving...' : 'save questions'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
