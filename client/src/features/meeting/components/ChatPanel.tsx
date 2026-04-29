import { FC, useState, useRef, useEffect } from 'react';
import Icon from '../../../shared/components/Icon';
import { ArrowRight01Icon, Message01Icon } from '@hugeicons/core-free-icons';

export interface ChatMessage {
  id: string;
  meetingId: string;
  senderId: string;
  senderName: string;
  senderImage?: string | null;
  text: string;
  timestamp: number;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  currentUserId: string;
  onSendMessage: (text: string) => void;
  isHost?: boolean;
  onClose?: () => void;
}

// Helper to make URLs clickable
const LinkifyContent = ({ text }: { text: string }) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return (
    <span style={{ wordBreak: 'break-word' }}>
      {parts.map((part, i) => {
        if (part.match(urlRegex)) {
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>
              {part}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
};

const ChatPanel: FC<ChatPanelProps> = ({ messages = [], currentUserId, onSendMessage, isHost = false, onClose }) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
        <span className="section-title">
          <Icon icon={Message01Icon} size={16} style={{ marginRight: '0.4rem' }} /> Meeting Chat
        </span>
        {onClose && (
            <button onClick={onClose} className="btn-icon" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>&times;</span>
            </button>
        )}
      </div>

      <div className="chat-messages-container" style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 'auto 0' }}>
            No messages yet. Say hello!
          </div>
        ) : (
          messages.map((msg) => {
            const isSelf = msg.senderId === currentUserId;
            return (
              <div
                key={msg.id}
                className={`chat-message-row ${isSelf ? 'self' : 'peer'}`}
                style={{
                  display: 'flex',
                  flexDirection: isSelf ? 'row-reverse' : 'row',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                }}
              >
                {!isSelf && (
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '50%', background: 'var(--primary)',
                    color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.75rem', fontWeight: 600, flexShrink: 0
                  }}>
                    {msg.senderImage ? <img src={`/api${msg.senderImage}`} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : msg.senderName.charAt(0).toUpperCase()}
                  </div>
                )}
                
                <div style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: isSelf ? 'flex-end' : 'flex-start',
                  maxWidth: '85%'
                }}>
                  {!isSelf && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.125rem', marginLeft: '0.25rem' }}>{msg.senderName}</span>}
                  <div style={{
                    padding: '0.5rem 0.75rem',
                    background: isSelf ? 'var(--primary)' : 'var(--bg-elevated)',
                    color: isSelf ? '#fff' : 'var(--text-primary)',
                    borderRadius: '12px',
                    borderTopLeftRadius: !isSelf ? '4px' : '12px',
                    borderTopRightRadius: isSelf ? '4px' : '12px',
                    fontSize: '0.875rem',
                    lineHeight: 1.4,
                  }}>
                    <LinkifyContent text={msg.text} />
                  </div>
                  <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginRight: isSelf ? '0.25rem' : '0', marginLeft: isSelf ? '0' : '0.25rem' }}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container" style={{ flexShrink: 0, padding: '1rem', borderTop: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
        <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '24px', padding: '0.25rem 0.25rem 0.25rem 1rem', alignItems: 'center' }}>
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
            onClick={handleSend}
            disabled={!inputText.trim()}
            style={{
              width: '32px', height: '32px', borderRadius: '50%',
              background: inputText.trim() ? 'var(--primary)' : 'var(--bg-hover)',
              color: inputText.trim() ? '#fff' : 'var(--text-muted)',
              border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: inputText.trim() ? 'pointer' : 'default', transition: 'all 0.2s'
            }}
          >
            <Icon icon={ArrowRight01Icon} size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
