import { FC, useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import Icon from '../../../shared/components/Icon';
import { ArrowUp02Icon, ArrowDown02Icon, PinIcon } from '@hugeicons/core-free-icons';
import { ChatBubbleSurface } from './ChatBubbleSurface';
import { avatarUrlFromPath } from '../../../shared/avatarUrl';

export interface ChatMessage {
  id: string;
  meetingId: string;
  senderId: string;
  senderName: string;
  senderImage?: string | null;
  text: string;
  timestamp: number;
  /** Join/leave ribbon; also persisted in meeting chat history when the server stores presence. */
  system?: 'join' | 'leave';
  /** True when this row is the current user's own join/leave line. */
  presenceIsSelf?: boolean;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  currentUserId: string;
  onSendMessage: (text: string) => void;
  isHost?: boolean;
  onClose?: () => void;
  pinnedMessage?: ChatMessage | null;
  onPinMessage?: (messageId: string) => void;
  onUnpinMessage?: () => void;
  /** When false, user must join the call before viewing or sending chat (online/hybrid). */
  chatSessionActive?: boolean;
  /** Same as main “Join Meeting” — used from the chat gate. */
  onRequestJoinMeeting?: () => void | Promise<void>;
}

const LinkifyContent = ({ text, isSelf }: { text: string; isSelf?: boolean }) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  const linkColor = isSelf ? 'rgba(255,255,255,0.92)' : 'var(--primary)';
  return (
    <span style={{ wordBreak: 'break-word' }}>
      {parts.map((part, i) => {
        if (part.match(urlRegex)) {
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color: linkColor, textDecoration: 'underline' }}>
              {part}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
};

function isRosterSystem(m: ChatMessage) {
  return m.system === 'join' || m.system === 'leave';
}

/** First message in a consecutive run from the same sender (for avatar + name). */
function isFirstFromSender(messages: ChatMessage[], index: number): boolean {
  if (index <= 0) return true;
  const prev = messages[index - 1];
  const cur = messages[index];
  if (isRosterSystem(prev) || isRosterSystem(cur)) return true;
  return prev.senderId !== cur.senderId;
}

/** Last message in a consecutive run from the same sender (tail + end-of-group time rules). */
function isLastFromSender(messages: ChatMessage[], index: number): boolean {
  const next = messages[index + 1];
  if (!next) return true;
  const cur = messages[index];
  if (isRosterSystem(next) || isRosterSystem(cur)) return true;
  return next.senderId !== cur.senderId;
}

const PinnedChatBanner: FC<{
  message: ChatMessage;
  isHost: boolean;
  onUnpin?: () => void;
}> = ({ message, isHost, onUnpin }) => {
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const [needsMore, setNeedsMore] = useState(false);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (expanded) {
      setNeedsMore(false);
      return;
    }
    setNeedsMore(el.scrollHeight > el.clientHeight + 1);
  }, [message.text, expanded]);

  return (
    <div
      className="chat-pinned-banner"
      style={{
        flexShrink: 0,
        zIndex: 6,
        padding: '0.75rem 1rem',
        background: 'color-mix(in srgb, var(--bg-elevated) 82%, transparent)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        boxShadow: '0 12px 78px color-mix(in srgb, var(--text-primary) 14%, transparent)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: 4 }}>
            Pinned by host · {message.senderName}
          </div>

          <p
            ref={bodyRef}
            style={{
              margin: 0,
              fontSize: '0.8125rem',
              color: 'var(--text-primary)',
              lineHeight: 1.45,
              ...(expanded
                ? {}
                : {
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical' as const,
                    overflow: 'hidden',
                  }),
            }}
          >
            <LinkifyContent text={message.text} isSelf={false} />
          </p>

          {needsMore || expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              style={{
                marginTop: 6,
                padding: 0,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--primary)',
              }}
            >
              {expanded ? 'Less' : 'More'}
            </button>
          ) : null}
        </div>
        {isHost && onUnpin && (
          <button
            type="button"
            onClick={onUnpin}
            aria-label="Unpin message"
            title="Unpin"
            style={{
              flexShrink: 0,
            //   marginTop: -2,
              padding: 4,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--primary)',
			  fontSize: 'var(--font-size-label)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 0,
            }}
          >
            Unpin
          </button>
        )}
      </div>
    </div>
  );
};

function PresenceRow({ msg }: { msg: ChatMessage }) {
  const avatarSrc = avatarUrlFromPath(msg.senderImage);
  const verb = msg.system === 'join' ? 'joined' : 'left';
  const isSelfRibbon = msg.presenceIsSelf === true;
  const selfLine = `You ${verb} the meeting`;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        marginTop: 10,
        marginBottom: 2,
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          maxWidth: '95%',
          padding: '6px 12px',
          borderRadius: 999,
          fontSize: '0.72rem',
          color: 'var(--text-muted)',
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            overflow: 'hidden',
            flexShrink: 0,
            background: 'var(--primary)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.55rem',
            fontWeight: 700,
          }}
        >
          {avatarSrc ? (
            <img src={avatarSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            (isSelfRibbon ? 'Y' : (msg.senderName || '?').charAt(0).toUpperCase())
          )}
        </div>
        <span style={{ textAlign: 'center', lineHeight: 1.35 }}>
          {isSelfRibbon ? (
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{selfLine}</span>
          ) : (
            <>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{msg.senderName}</span>
              {` ${verb} the meeting`}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

const HostInlinePin: FC<{
  isPinned: boolean;
  show: boolean;
  onClick: () => void;
}> = ({ isPinned, show, onClick }) => {
  if (!show) return null;
  return (
    <button
      type="button"
      aria-label={isPinned ? 'Unpin message' : 'Pin message'}
      title={isPinned ? 'Unpin' : 'Pin'}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        flexShrink: 0,
        alignSelf: 'center',
        padding: 2,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        color: isPinned ? 'var(--primary)' : 'var(--text-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 0,
        transform: isPinned ? 'rotate(-45deg)' : undefined,
      }}
    >
      <Icon icon={PinIcon} size={13} style={{ color: 'inherit' }} />
    </button>
  );
};

const SCROLL_JUMP_THRESHOLD_PX = 140;
const STICK_TO_BOTTOM_WITHIN_PX = 96;

const ChatPanel: FC<ChatPanelProps> = ({
  messages = [],
  currentUserId,
  onSendMessage,
  isHost = false,
  onClose,
  pinnedMessage = null,
  onPinMessage,
  onUnpinMessage,
  chatSessionActive = true,
  onRequestJoinMeeting,
}) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const canSend = Boolean(inputText.trim());
  const [hoverMsgId, setHoverMsgId] = useState<string | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const updateScrollMetrics = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el || !chatSessionActive) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distFromBottom < STICK_TO_BOTTOM_WITHIN_PX;
    setShowJumpToBottom(distFromBottom > SCROLL_JUMP_THRESHOLD_PX);
  }, [chatSessionActive]);

  const jumpScrollToBottom = useCallback(() => {
    stickToBottomRef.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowJumpToBottom(false);
  }, []);

  useEffect(() => {
    if (!chatSessionActive) return;
    stickToBottomRef.current = true;
    const id = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      updateScrollMetrics();
    });
    return () => cancelAnimationFrame(id);
  }, [chatSessionActive, updateScrollMetrics]);

  useEffect(() => {
    if (!chatSessionActive) return;
    if (stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    updateScrollMetrics();
  }, [messages, chatSessionActive, updateScrollMetrics]);

  const handleSend = () => {
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="agenda-panel panel chat-panel-root" style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: 'inherit' }}>
      <div className="section-header" style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="section-title">Chat</span>
        {onClose && (
            <button onClick={onClose} className="btn-icon" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>&times;</span>
            </button>
        )}
      </div>

      {!chatSessionActive ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
            textAlign: 'center',
          }}
        >
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6, maxWidth: 280 }}>
            <button
              type="button"
              className="chat-gate-join-link"
              onClick={() => onRequestJoinMeeting?.()}
              style={{
                display: 'inline',
                padding: 0,
                margin: 0,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                font: 'inherit',
                fontWeight: 700,
                color: 'var(--primary)',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              Join the meeting
            </button>
            {' '}to view and send messages.
          </p>
        </div>
      ) : (
        <>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {pinnedMessage && (
          <PinnedChatBanner message={pinnedMessage} isHost={isHost} onUnpin={onUnpinMessage} />
        )}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div
          ref={messagesScrollRef}
          className="chat-messages-container"
          onScroll={updateScrollMetrics}
          style={{
            position: 'relative',
            height: '100%',
            overflowY: 'auto',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
            zIndex: 1,
          }}
        >
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 'auto 0' }}>
            No messages yet. Say hello!
          </div>
        ) : (
          messages.map((msg, index) => {
            if (isRosterSystem(msg)) {
              return <PresenceRow key={msg.id} msg={msg} />;
            }

            const isSelf = msg.senderId === currentUserId;
            const showHead = isFirstFromSender(messages, index);
            const showTail = isLastFromSender(messages, index);
            const showTime = showTail;
            const prev = index > 0 ? messages[index - 1] : null;
            const sameRun = prev != null && !isRosterSystem(prev) && !isRosterSystem(msg) && prev.senderId === msg.senderId;
            const peerAvatarSrc = avatarUrlFromPath(msg.senderImage);
            const isPinned = pinnedMessage?.id === msg.id;
            const showPin = isHost && Boolean(onPinMessage);
            const pinVisible = showPin && (hoverMsgId === msg.id || isPinned);

            return (
              <div
                key={msg.id}
                className={`chat-message-row ${isSelf ? 'self' : 'peer'}`}
                style={{
                  display: 'flex',
                  flexDirection: isSelf ? 'row-reverse' : 'row',
                  alignItems: 'flex-end',
                  gap: '0.5rem',
                  marginTop: index === 0 ? 0 : (sameRun ? 3 : 12),
                }}
                onMouseEnter={() => setHoverMsgId(msg.id)}
                onMouseLeave={() => setHoverMsgId(null)}
              >
                {!isSelf && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      maxWidth: '85%',
                      minWidth: 0,
                    }}
                  >
                    {showHead && (
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.125rem', marginLeft: '0.25rem' }}>
                        {msg.senderName}
                      </span>
                    )}
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'flex-end',
                        gap: '0.35rem',
                        maxWidth: '100%',
                      }}
                    >
                      {showHead ? (
                        <div
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '50%',
                            background: 'var(--primary)',
                            color: 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            flexShrink: 0,
                          }}
                        >
                          {peerAvatarSrc ? (
                            <img src={peerAvatarSrc} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            msg.senderName.charAt(0).toUpperCase()
                          )}
                        </div>
                      ) : (
                        <div style={{ width: '28px', flexShrink: 0 }} aria-hidden />
                      )}
                      <ChatBubbleSurface variant="others" showTail={showTail}>
                        <LinkifyContent text={msg.text} isSelf={false} />
                      </ChatBubbleSurface>
                      <HostInlinePin
                        isPinned={isPinned}
                        show={pinVisible}
                        onClick={() => (isPinned ? onUnpinMessage?.() : onPinMessage?.(msg.id))}
                      />
                    </div>
                    {showTime && (
                      <span
                        style={{
                          fontSize: '0.625rem',
                          color: 'var(--text-muted)',
                          marginTop: '0.25rem',
                          marginLeft: 'calc(28px + 0.5rem)',
                        }}
                      >
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                )}

                {isSelf && (
                <div style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'flex-end',
                  maxWidth: '85%',
                }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'flex-end',
                      gap: '0.35rem',
                    }}
                  >
                    <HostInlinePin
                      isPinned={isPinned}
                      show={pinVisible}
                      onClick={() => (isPinned ? onUnpinMessage?.() : onPinMessage?.(msg.id))}
                    />
                    <ChatBubbleSurface variant="me" showTail={showTail}>
                      <LinkifyContent text={msg.text} isSelf />
                    </ChatBubbleSurface>
                  </div>
                  {showTime && (
                    <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginRight: '0.25rem' }}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
        </div>
        {showJumpToBottom && (
          <button
            type="button"
            aria-label="Scroll to latest messages"
            onClick={jumpScrollToBottom}
            style={{
              position: 'absolute',
              right: 12,
              bottom: 12,
              zIndex: 8,
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              boxShadow: '0 4px 14px color-mix(in srgb, var(--text-primary) 12%, transparent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon icon={ArrowDown02Icon} size={18} />
          </button>
        )}
        </div>
      </div>

      <div className="chat-input-container" style={{ flexShrink: 0, padding: '1rem', borderTop: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
        <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: '0.25rem 0.25rem 0.25rem 1rem', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Type a message or paste a link..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: '0.875rem',
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              flexShrink: 0,
              background: canSend
                ? 'var(--primary)'
                : 'color-mix(in srgb, var(--text-muted) 22%, var(--bg-elevated))',
              color: canSend ? '#fff' : 'var(--text-muted)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: canSend ? 'pointer' : 'not-allowed',
              transition: 'background-color 0.2s, color 0.2s',
            }}
          >
            <Icon icon={ArrowUp02Icon} size={16} />
          </button>
        </div>
      </div>
        </>
      )}
    </div>
  );
};

export default ChatPanel;
