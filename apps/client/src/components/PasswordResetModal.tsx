import { useState } from 'react'
import { api } from '../lib/api.ts'
import styles from './PasswordResetModal.module.css'

interface Props {
  onClose: () => void
}

type Step = 'username' | 'questions' | 'submitted'

export default function PasswordResetModal({ onClose }: Props) {
  const [step, setStep] = useState<Step>('username')
  const [username, setUsername] = useState('')
  const [userQuestions, setUserQuestions] = useState<string[]>([])
  const [msgNumber, setMsgNumber] = useState('')
  const [creator, setCreator] = useState('')
  const [answer1, setAnswer1] = useState('')
  const [answer2, setAnswer2] = useState('')
  const [answer3, setAnswer3] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function lookupUsername(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await api.getUserRecoveryQuestions(username)
      setUserQuestions(res.questions)
      setStep('questions')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'User not found')
    } finally {
      setLoading(false)
    }
  }

  async function submitAnswers(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await api.submitPasswordReset({
        username,
        newPassword,
        answers: { msgNumber, creator, answer1, answer2, answer3 },
      })
      setStep('submitted')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit reset request')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.title}>password reset</div>

        {step === 'username' && (
          <form onSubmit={lookupUsername} className={styles.form}>
            <p className={styles.desc}>Enter your username to look up your security questions.</p>
            <input
              placeholder="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              required
            />
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <button type="button" onClick={onClose}>cancel</button>
              <button type="submit" className={styles.primaryBtn} disabled={loading}>
                {loading ? 'looking up...' : 'next'}
              </button>
            </div>
          </form>
        )}

        {step === 'questions' && (
          <form onSubmit={submitAnswers} className={styles.form}>
            <p className={styles.desc}>
              Answer at least 4 of 5 questions correctly. A superadmin will review and approve your request.
            </p>

            <div className={styles.questionGroup}>
              <label className={styles.qLabel}>What is the most recent post number on the server right now?</label>
              <input placeholder="e.g. 4821" value={msgNumber} onChange={e => setMsgNumber(e.target.value)} required />
            </div>

            <div className={styles.questionGroup}>
              <label className={styles.qLabel}>Who is the creator of this program?</label>
              <input placeholder="first name" value={creator} onChange={e => setCreator(e.target.value)} required />
            </div>

            {userQuestions.map((q, i) => (
              <div key={i} className={styles.questionGroup}>
                <label className={styles.qLabel}>{q}</label>
                <input
                  placeholder="your answer"
                  value={[answer1, answer2, answer3][i]}
                  onChange={e => [setAnswer1, setAnswer2, setAnswer3][i](e.target.value)}
                  required
                />
              </div>
            ))}

            <div className={styles.questionGroup}>
              <label className={styles.qLabel}>New password</label>
              <input
                type="password"
                placeholder="new password (min 6 characters)"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <button type="button" onClick={() => { setStep('username'); setError(null) }}>back</button>
              <button type="submit" className={styles.primaryBtn} disabled={loading}>
                {loading ? 'submitting...' : 'submit request'}
              </button>
            </div>
          </form>
        )}

        {step === 'submitted' && (
          <div className={styles.form}>
            <p className={styles.desc}>
              Your request has been submitted. A superadmin will review it shortly.
              Once approved, you can log in with your new password.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.primaryBtn} onClick={onClose}>back to login</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
