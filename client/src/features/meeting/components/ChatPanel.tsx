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
  /** Same as main "Join Meeting" — used from the chat gate. */
  onRequestJoinMeeting?: () => void | Promise<void>;
}

const LinkifyContent = ({ text, isSelf }: { text: string; isSelf?: boolean }) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  const linkColor = isSelf ? "rgba(var(--flexoki-paper-rgb), 0.92)" : "var(--primary)";
  return (
    <span className="chat-linkify-break">
      {parts.map((part, i) => {
        if (part.match(urlRegex)) {
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color: linkColor, textDecoration: 'underline', overflowWrap: 'anywhere' }}>
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
    <div className="chat-pinned-banner chat-pinned-banner-inner">
      <div className="chat-pinned-body">
        <div className="chat-pinned-content">
          <div className="chat-pinned-meta">
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
              className="chat-pinned-expand-btn"
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
            className="chat-pinned-unpin-btn"
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
    <div className="chat-presence-row">
      <div className="chat-presence-pill">
        <div className="chat-presence-avatar">
          {avatarSrc ? (
            <img src={avatarSrc} alt="" className="chat-presence-avatar-img" />
          ) : (
            (isSelfRibbon ? 'Y' : (msg.senderName || '?').charAt(0).toUpperCase())
          )}
        </div>
        <span className="chat-presence-text">
          {isSelfRibbon ? (
            <span className="chat-presence-name">{selfLine}</span>
          ) : (
            <>
              <span className="chat-presence-name">{msg.senderName}</span>
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
  return (
    <button
      type="button"
      aria-label={isPinned ? 'Unpin message' : 'Pin message'}
      title={isPinned ? 'Unpin' : 'Pin'}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="chat-inline-pin-btn"
      style={{
        color: isPinned ? 'var(--primary)' : 'var(--text-muted)',
        transform: isPinned ? 'rotate(-45deg)' : undefined,
        visibility: show ? 'visible' : 'hidden',
        pointerEvents: show ? 'auto' : 'none',
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
    <div className="agenda-panel panel chat-panel-root chat-panel-root-inner">
      <div className="section-header">
        <span className="section-title">Chat</span>
        {onClose && (
            <button onClick={onClose} className="btn-icon chat-close-btn">
                <span className="chat-close-x">&times;</span>
            </button>
        )}
      </div>

      {!chatSessionActive ? (
        <div className="chat-gate-wrap">
          <p className="chat-gate-text">
            <button
              type="button"
              className="chat-gate-join-link chat-gate-join-link-btn"
              onClick={() => onRequestJoinMeeting?.()}
            >
              Join the meeting
            </button>
            {' '}to view and send messages.
          </p>
        </div>
      ) : (
        <>
      <div className="chat-messages-outer">
        {pinnedMessage && (
          <PinnedChatBanner message={pinnedMessage} isHost={isHost} onUnpin={onUnpinMessage} />
        )}
        <div className="chat-scroll-wrap">
        <div
          ref={messagesScrollRef}
          className="chat-messages-container"
          onScroll={updateScrollMetrics}
        >
        {messages.length === 0 ? (
          <div className="chat-empty-msg">
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
                  flexDirection: isSelf ? 'row-reverse' : 'row',
                  marginTop: index === 0 ? 0 : (sameRun ? 3 : 12),
                }}
                onMouseEnter={() => setHoverMsgId(msg.id)}
                onMouseLeave={() => setHoverMsgId(null)}
              >
                {!isSelf && (
                  <div className="chat-peer-col">
                    {showHead && (
                      <span className="chat-peer-name-label">
                        {msg.senderName}
                      </span>
                    )}
                    <div className="chat-peer-bubble-row">
                      {showHead ? (
                        <div className="chat-peer-avatar-div">
                          {peerAvatarSrc ? (
                            <img src={peerAvatarSrc} alt="" className="chat-peer-avatar-img" />
                          ) : (
                            msg.senderName.charAt(0).toUpperCase()
                          )}
                        </div>
                      ) : (
                        <div className="chat-peer-spacer" aria-hidden />
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
                      <span className="chat-peer-time">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                )}

                {isSelf && (
                <div className="chat-self-col">
                  <div className="chat-self-bubble-row">
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
                    <span className="chat-self-time">
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
            className="chat-jump-btn"
          >
            <Icon icon={ArrowDown02Icon} size={18} />
          </button>
        )}
        </div>
      </div>

      <div className="chat-input-container chat-input-bar">
        <div className="chat-input-inner">
          <input
            type="text"
            placeholder="Type a message or paste a link..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="chat-text-input"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            className="chat-send-btn-base"
            style={{
              background: canSend
                ? 'var(--primary)'
                : 'color-mix(in srgb, var(--text-muted) 22%, var(--bg-elevated))',
              color: canSend ? "var(--flexoki-paper)" : "var(--text-muted)",
              cursor: canSend ? 'pointer' : 'not-allowed',
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
