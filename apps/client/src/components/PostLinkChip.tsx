import { createPortal } from 'react-dom'
import { useRef, useState } from 'react'
import { api } from '../lib/api.ts'
import styles from './LinkPreviews.module.css'

interface MsgPreview {
  content: string
  authorName: string
}

interface Props {
  postNumber: number
  token: string
  onJumpToPost: (n: number) => void
}

export default function PostLinkChip({ postNumber, token, onJumpToPost }: Props) {
  const [tooltip, setTooltip] = useState<{ rect: DOMRect; preview: MsgPreview | null } | null>(null)
  const hoverRef = useRef(false)
  const fetchedRef = useRef(false)

  async function handleMouseEnter(e: React.MouseEvent) {
    hoverRef.current = true
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTooltip({ rect, preview: null })
    if (fetchedRef.current) return
    fetchedRef.current = true
    try {
      const post = await api.getMessageByPostNumber(token, postNumber)
      if (!post || !hoverRef.current) return
      const msgs = await api.getMessages(token, post.channelId, {
        after: new Date(new Date(post.createdAt).getTime() - 1).toISOString(),
      })
      if (!hoverRef.current) return
      const msg = (msgs as { id: string; content: string; author?: { displayName: string } }[]).find(m => m.id === post.id)
      if (msg) {
        const preview: MsgPreview = {
          content: msg.content,
          authorName: msg.author?.displayName ?? '?',
        }
        setTooltip(prev => prev ? { ...prev, preview } : null)
      }
    } catch {
      fetchedRef.current = false
    }
  }

  return (
    <>
      <button
        type="button"
        className={styles.postLinkChip}
        onClick={() => onJumpToPost(postNumber)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => { hoverRef.current = false; setTooltip(null) }}
      >
        #{postNumber}
      </button>
      {tooltip && createPortal(
        <div
          className={styles.postTooltip}
          style={{
            left: tooltip.rect.left,
            top: tooltip.rect.top - 8,
            transform: 'translateY(-100%)',
          }}
        >
          {tooltip.preview ? (
            <>
              <div className={styles.postTooltipAuthor}>{tooltip.preview.authorName} · #{postNumber}</div>
              <div className={styles.postTooltipContent}>
                {tooltip.preview.content.slice(0, 300)}
                {tooltip.preview.content.length > 300 ? '…' : ''}
              </div>
            </>
          ) : (
            <div className={styles.postTooltipAuthor}>#{postNumber}</div>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
