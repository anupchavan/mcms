import { FC, useMemo, ComponentType } from 'react';
import {
    Calendar03Icon,
    BubbleChatIcon,
    Mic01Icon,
    Note01Icon,
    Task01Icon,
    SidebarRight01Icon,
} from '@hugeicons/core-free-icons';
import Icon from '../../../shared/components/Icon';
import ShortcutTooltip from '../../../shared/components/ShortcutTooltip';
import AgendaPanel from '../../agenda/components/AgendaPanel';
import ChatPanel, { ChatMessage } from './ChatPanel';
import TranscriptFeed from '../../transcript/components/TranscriptFeed';
import MinutesPanel from '../../minutes/components/MinutesPanel';
import ActionItems from '../../minutes/components/ActionItems';

/** Identifier for each dock tab. Drives both the active-panel state and the
 *  icon-rail buttons. Exhaustive — TypeScript will flag any missed case. */
export type DockPanelId = 'agenda' | 'chat' | 'transcript' | 'minutes' | 'actions';

interface DockTab {
    id: DockPanelId;
    label: string;
    icon: ComponentType<any> | any;
    /** Single character displayed in the hover tooltip + reserved for a future
     *  keyboard shortcut wiring. Intentionally unbound to avoid clashing with
     *  the existing in-meeting shortcuts (m, c, r, a, …). */
    hint: string;
}

const TABS: DockTab[] = [
    { id: 'agenda',     label: 'Agenda',       icon: Calendar03Icon, hint: 'G' },
    { id: 'chat',       label: 'Chat',         icon: BubbleChatIcon, hint: 'H' },
    { id: 'transcript', label: 'Transcript',   icon: Mic01Icon,      hint: 'T' },
    { id: 'minutes',    label: 'Minutes',      icon: Note01Icon,     hint: 'N' },
    { id: 'actions',    label: 'Action items', icon: Task01Icon,     hint: 'K' },
];

interface MeetingDockProps {
    meetingId: string;
    meetingHostId?: string;
    isHost: boolean;

    activePanelId: DockPanelId;
    isOpen: boolean;
    onSelectPanel: (id: DockPanelId) => void;
    onToggleOpen: () => void;

    agendaItems: any[];
    minutesItems?: any[];
    actionItems: any[];
    transcripts: any[];
    participants: any[];
    addActionItemTrigger: number;

    chatMessages: ChatMessage[];
    currentUserId: string;
    onSendChatMessage: (text: string) => void;

    onAgendaChange: (items: any[]) => void;
    onMinutesChange?: (items: any[]) => void;
    onAddActionItemConsumed: () => void;
    onRefreshActionItems: () => void;
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
}

const MeetingDock: FC<MeetingDockProps> = ({
    meetingId,
    meetingHostId,
    isHost,
    activePanelId,
    isOpen,
    onSelectPanel,
    onToggleOpen,
    agendaItems,
    minutesItems = [],
    actionItems,
    transcripts,
    participants,
    addActionItemTrigger,
    chatMessages,
    currentUserId,
    onSendChatMessage,
    onAgendaChange,
    onMinutesChange,
    onAddActionItemConsumed,
    onRefreshActionItems,
    fetchWithAuth,
}) => {
    /** Render the currently active panel. Memoised so toggling other state
     *  doesn't churn heavy panels (TranscriptFeed in particular). */
    const activePanel = useMemo(() => {
        switch (activePanelId) {
            case 'agenda':
                return (
                    <AgendaPanel
                        agendaItems={agendaItems}
                        onItemChange={onAgendaChange}
                        isHost={isHost}
                    />
                );
            case 'chat':
                return (
                    <ChatPanel
                        messages={chatMessages}
                        currentUserId={currentUserId}
                        onSendMessage={onSendChatMessage}
                        isHost={isHost}
                    />
                );
            case 'transcript':
                return <TranscriptFeed transcripts={transcripts} />;
            case 'minutes':
                return (
                    <MinutesPanel
                        minutesItems={minutesItems}
                        onItemChange={onMinutesChange ?? (() => {})}
                    />
                );
            case 'actions':
                return (
                    <ActionItems
                        items={actionItems}
                        meetingId={meetingId}
                        meetingHostId={meetingHostId}
                        agendaItems={agendaItems}
                        fetchWithAuth={fetchWithAuth}
                        onRefresh={onRefreshActionItems}
                        addActionItemTrigger={addActionItemTrigger}
                        onAddTriggered={onAddActionItemConsumed}
                        participants={participants}
                    />
                );
            default: {
                const _exhaustive: never = activePanelId;
                return _exhaustive;
            }
        }
    }, [
        activePanelId, agendaItems, minutesItems, actionItems, transcripts,
        participants, isHost, meetingId, meetingHostId, addActionItemTrigger,
        chatMessages, currentUserId, onSendChatMessage,
        onAgendaChange, onMinutesChange, onAddActionItemConsumed,
        onRefreshActionItems, fetchWithAuth,
    ]);

    return (
        <div className={`meeting-dock ${isOpen ? 'open' : 'collapsed'}`}>
            {isOpen && (
                <div className="meeting-dock-content" key={activePanelId}>
                    {activePanel}
                </div>
            )}
            <div className="meeting-dock-rail" role="tablist" aria-label="Meeting panels">
                <div className="meeting-dock-rail-tabs">
                    {TABS.map(tab => {
                        const isActive = isOpen && activePanelId === tab.id;
                        return (
                            <ShortcutTooltip key={tab.id} label={tab.label.toUpperCase()} keys={[tab.hint]} position="left">
                                <button
                                    type="button"
                                    className={`meeting-dock-rail-btn ${isActive ? 'active' : ''}`}
                                    onClick={() => onSelectPanel(tab.id)}
                                    aria-pressed={isActive}
                                    role="tab"
                                    aria-label={tab.label}
                                >
                                    <Icon icon={tab.icon} size={18} />
                                </button>
                            </ShortcutTooltip>
                        );
                    })}
                </div>
                <ShortcutTooltip label={isOpen ? 'HIDE PANEL' : 'SHOW PANEL'} keys={['mod', ']']} position="left">
                    <button
                        type="button"
                        className="meeting-dock-rail-btn meeting-dock-rail-btn-toggle"
                        onClick={onToggleOpen}
                        aria-label={isOpen ? 'Hide panel' : 'Show panel'}
                        aria-pressed={!isOpen}
                    >
                        <Icon icon={SidebarRight01Icon} size={18} />
                    </button>
                </ShortcutTooltip>
            </div>
        </div>
    );
};

export default MeetingDock;
