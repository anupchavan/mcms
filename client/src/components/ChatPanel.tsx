import { FC } from 'react';
import Icon from './Icon';
import { BubbleChatIcon } from '@hugeicons/core-free-icons';

interface ChatPanelProps {
    /** Reserved for the real implementation — kept here so the placeholder's
     *  signature matches what the dock will eventually pass through. */
    meetingId?: string;
}

/**
 * Placeholder chat panel.
 *
 * The real chat implementation hasn't landed in this branch yet (see the chat
 * discussion with @kaushal). Once the actual `<ChatPanel>` arrives, replace
 * this body with the real one — the dock already wires up everything it needs.
 */
const ChatPanel: FC<ChatPanelProps> = () => {
    return (
        <div className="chat-panel panel">
            <div className="section-header">
                <span className="section-title">Chat</span>
            </div>
            <div className="chat-empty-state">
                <div className="chat-empty-icon">
                    <Icon icon={BubbleChatIcon} size={36} />
                </div>
                <p className="chat-empty-title">Chat coming soon</p>
                <p className="chat-empty-sub">
                    Your friend is wiring this up — we left the dock slot ready so it'll
                    drop in without any layout changes.
                </p>
            </div>
        </div>
    );
};

export default ChatPanel;
