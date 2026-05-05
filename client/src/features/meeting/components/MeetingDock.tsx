import { FC, useMemo, ComponentType } from 'react';
import {
    ViewAgendaIcon,
    BubbleChatIcon,
    ClosedCaptionIcon,
    Note01Icon,
    CheckListIcon,
    SidebarRight01Icon,
} from '@hugeicons/core-free-icons';
import Icon from '../../../shared/components/Icon';
import ShortcutTooltip from '../../../shared/components/ShortcutTooltip';
import AgendaPanel from '../../agenda/components/AgendaPanel';
import ChatPanel, { ChatMessage } from './ChatPanel';
import TranscriptFeed from '../../transcript/components/TranscriptFeed';
import MinutesPanel from '../../minutes/components/MinutesPanel';
import Tasks from '../../minutes/components/Tasks';

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
    { id: 'agenda',     label: 'Agenda',       icon: ViewAgendaIcon, hint: 'G' },
    { id: 'chat',       label: 'Chat',         icon: BubbleChatIcon, hint: 'H' },
    { id: 'transcript', label: 'Transcript',   icon: ClosedCaptionIcon, hint: 'T' },
    { id: 'minutes',    label: 'Minutes',      icon: Note01Icon,     hint: 'I' },
    { id: 'actions',    label: 'Tasks',        icon: CheckListIcon,  hint: 'K' },
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
    tasks: any[];
    transcripts: any[];
    participants: any[];
    addTaskTrigger: number;

    chatMessages: ChatMessage[];
    currentUserId: string;
    onSendChatMessage: (text: string) => void;
    pinnedChatMessage?: ChatMessage | null;
    onPinChatMessage?: (messageId: string) => void;
    onUnpinChatMessage?: () => void;
    /** When false (online meeting, not in call yet), chat shows a join gate. */
    chatSessionActive?: boolean;
    onRequestJoinMeeting?: () => void | Promise<void>;

    onAgendaChange: (items: any[]) => void;
    onMinutesChange?: (items: any[]) => void;
    onAddMinute?: (title: string) => void;
    onAddTaskConsumed: () => void;
    onRefreshTasks: () => void;
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
    tasks,
    transcripts,
    participants,
    addTaskTrigger,
    chatMessages,
    currentUserId,
    onSendChatMessage,
    pinnedChatMessage = null,
    onPinChatMessage,
    onUnpinChatMessage,
    chatSessionActive = true,
    onRequestJoinMeeting,
    onAgendaChange,
    onMinutesChange,
    onAddMinute,
    onAddTaskConsumed,
    onRefreshTasks,
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
                        pinnedMessage={pinnedChatMessage}
                        onPinMessage={onPinChatMessage}
                        onUnpinMessage={onUnpinChatMessage}
                        chatSessionActive={chatSessionActive}
                        onRequestJoinMeeting={onRequestJoinMeeting}
                    />
                );
            case 'transcript':
                return <TranscriptFeed transcripts={transcripts} />;
            case 'minutes':
                return (
                    <MinutesPanel
                        minutesItems={minutesItems}
                        onAddItem={onAddMinute}
                        onItemChange={onMinutesChange}
                    />
                );
            case 'actions':
                return (
                    <Tasks
                        items={tasks}
                        meetingId={meetingId}
                        meetingHostId={meetingHostId}
                        agendaItems={agendaItems}
                        fetchWithAuth={fetchWithAuth}
                        onRefresh={onRefreshTasks}
                        addTaskTrigger={addTaskTrigger}
                        onAddTriggered={onAddTaskConsumed}
                        participants={participants}
                    />
                );
            default: {
                const _exhaustive: never = activePanelId;
                return _exhaustive;
            }
        }
    }, [
        activePanelId, agendaItems, minutesItems, tasks, transcripts,
        participants, isHost, meetingId, meetingHostId, addTaskTrigger,
        chatMessages, currentUserId, onSendChatMessage,
        pinnedChatMessage, onPinChatMessage, onUnpinChatMessage,
        chatSessionActive, onRequestJoinMeeting,
        onAgendaChange, onMinutesChange, onAddMinute, onAddTaskConsumed,
        onRefreshTasks, fetchWithAuth,
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
