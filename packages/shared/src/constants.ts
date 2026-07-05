// Hard cap on message content length, enforced server-side on both the WS
// send path and the REST edit path. The client shows a countdown near the
// limit and blocks sends over it.
export const MAX_MESSAGE_LENGTH = 4000

// Channel names: lowercase alphanumeric + hyphens, must start alphanumeric.
// Mirrors the client-side auto-formatting (lowercase, spaces→hyphens).
export const CHANNEL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/
