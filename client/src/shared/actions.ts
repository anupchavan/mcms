/**
 * Central registry of all configurable app actions.
 *
 * `defaultHotkey` stores an OS-agnostic representation:
 *   `mod: true`  → Cmd on macOS, Ctrl elsewhere
 *   `shift/alt`  → modifier keys
 *   `key`        → the printable character or named key (e.g. "m", "ArrowUp", "Enter")
 *
 * `scope`:
 *   'global'  – available everywhere (navigation, new meeting, theme…)
 *   'meeting' – only active on the live meeting page
 */

export interface HotkeyDef {
	key: string;
	mod?: boolean;
	shift?: boolean;
	alt?: boolean;
}

export interface ActionDef {
	id: string;
	name: string;
	group: string;
	/**
	 * Scope controls where the action is active and which other actions it can conflict with.
	 * - 'global'  – always active (navigation, theme, sidebar…)
	 * - 'meeting' – only active on the live meeting page
	 * - 'archive' – only active on the archive detail page
	 * - 'tasks'   – only active on the My Tasks page
	 * Conflicts are only flagged between actions of the SAME scope.
	 */
	scope: 'global' | 'meeting' | 'archive' | 'tasks';
	/** Short phrase users type in the command palette to trigger this action. */
	defaultAlias: string;
	defaultHotkey?: HotkeyDef;
	/** Extra words used for fuzzy matching in the palette. */
	keywords?: string[];
	/** Human-readable description shown in the palette. */
	description?: string;
}

export const ALL_ACTIONS: ActionDef[] = [
	// ── Navigation ────────────────────────────────────────────────────────────
	{
		id: 'nav.dashboard',
		name: 'Go to Dashboard',
		group: 'Navigation',
		scope: 'global',
		defaultAlias: 'home',
		defaultHotkey: { key: '1' },
		keywords: ['dashboard', 'home', 'overview'],
		description: 'Navigate to the main dashboard',
	},
	{
		id: 'nav.tasks',
		name: 'Go to Tasks',
		group: 'Navigation',
		scope: 'global',
		defaultAlias: 'tasks',
		defaultHotkey: { key: '2' },
		keywords: ['tasks', 'action items', 'todo'],
		description: 'Navigate to My Tasks',
	},
	{
		id: 'nav.meeting',
		name: 'Go to Live Meeting',
		group: 'Navigation',
		scope: 'global',
		defaultAlias: 'live',
		defaultHotkey: { key: '3' },
		keywords: ['meeting', 'live', 'room'],
		description: 'Navigate to the active meeting',
	},
	{
		id: 'nav.scheduled',
		name: 'Go to Scheduled Meetings',
		group: 'Navigation',
		scope: 'global',
		defaultAlias: 'scheduled',
		defaultHotkey: { key: '4' },
		keywords: ['scheduled', 'upcoming', 'calendar'],
		description: 'Navigate to Scheduled Meetings',
	},
	{
		id: 'nav.archives',
		name: 'Go to Archives',
		group: 'Navigation',
		scope: 'global',
		defaultAlias: 'archives',
		defaultHotkey: { key: '5' },
		keywords: ['archives', 'past', 'completed', 'history'],
		description: 'Navigate to Meeting Archives',
	},
	{
		id: 'nav.preferences',
		name: 'Go to Preferences',
		group: 'Navigation',
		scope: 'global',
		defaultAlias: 'prefs',
		defaultHotkey: { key: '6' },
		keywords: ['preferences', 'settings', 'configure', 'keyboard', 'shortcuts'],
		description: 'Navigate to Preferences',
	},
	{
		id: 'nav.settings',
		name: 'Go to Settings',
		group: 'Navigation',
		scope: 'global',
		defaultAlias: 'settings',
		defaultHotkey: { key: '7' },
		keywords: ['settings', 'profile', 'account'],
		description: 'Navigate to Account Settings',
	},

	// ── Meeting Actions ────────────────────────────────────────────────────────
	{
		id: 'meeting.new',
		name: 'New Meeting',
		group: 'Meeting Actions',
		scope: 'global',
		defaultAlias: 'new',
		defaultHotkey: { key: 'M', shift: true },
		keywords: ['new meeting', 'create', 'schedule'],
		description: 'Open the New Meeting dialog',
	},
	{
		id: 'meeting.join',
		name: 'Join Meeting',
		group: 'Meeting Actions',
		scope: 'global',
		defaultAlias: 'join',
		keywords: ['join', 'enter meeting', 'meeting'],
		description: 'Go to the live meeting page',
	},

	// ── Global ────────────────────────────────────────────────────────────────
	{
		id: 'global.theme',
		name: 'Toggle Theme',
		group: 'Global',
		scope: 'global',
		defaultAlias: 'theme',
		defaultHotkey: { key: 'd' },
		keywords: ['theme', 'dark', 'light', 'mode', 'appearance'],
		description: 'Switch between dark and light mode',
	},
	{
		id: 'global.sidebar',
		name: 'Toggle Sidebar',
		group: 'Global',
		scope: 'global',
		defaultAlias: 'sidebar',
		defaultHotkey: { key: 'b', mod: true },
		keywords: ['sidebar', 'nav', 'collapse'],
		description: 'Show or hide the sidebar',
	},
	{
		id: 'global.fullscreen',
		name: 'Toggle Fullscreen',
		group: 'Global',
		scope: 'meeting',
		defaultAlias: 'fullscreen',
		defaultHotkey: { key: 'f' },
		keywords: ['fullscreen', 'expand', 'focus'],
		description: 'Enter or exit fullscreen (in meeting)',
	},
	{
		id: 'global.notifications',
		name: 'Toggle Notifications',
		group: 'Global',
		scope: 'global',
		defaultAlias: 'notif',
		defaultHotkey: { key: 'n' },
		keywords: ['notifications', 'alerts', 'inbox'],
		description: 'Open or close the notifications panel',
	},

	// ── In-Meeting ─────────────────────────────────────────────────────────────
	{
		id: 'meeting.mic',
		name: 'Toggle Microphone',
		group: 'In-Meeting',
		scope: 'meeting',
		defaultAlias: 'mic',
		defaultHotkey: { key: 'm' },
		keywords: ['mic', 'microphone', 'mute', 'unmute', 'audio'],
		description: 'Mute or unmute your microphone',
	},
	{
		id: 'meeting.camera',
		name: 'Toggle Camera',
		group: 'In-Meeting',
		scope: 'meeting',
		defaultAlias: 'cam',
		defaultHotkey: { key: 'c' },
		keywords: ['camera', 'video', 'webcam'],
		description: 'Turn your camera on or off',
	},
	{
		id: 'meeting.recording',
		name: 'Toggle Recording',
		group: 'In-Meeting',
		scope: 'meeting',
		defaultAlias: 'rec',
		defaultHotkey: { key: 'r' },
		keywords: ['record', 'recording'],
		description: 'Start or stop meeting recording (host only)',
	},
	{
		id: 'meeting.participants',
		name: 'Show Participants',
		group: 'In-Meeting',
		scope: 'meeting',
		defaultAlias: 'people',
		defaultHotkey: { key: 'p' },
		keywords: ['participants', 'people', 'attendees'],
		description: 'Open the participants panel',
	},
	{
		id: 'meeting.agenda.add',
		name: 'Add Agenda Item',
		group: 'In-Meeting',
		scope: 'meeting',
		defaultAlias: 'agenda',
		defaultHotkey: { key: 'a' },
		keywords: ['agenda', 'add item'],
		description: 'Add a new agenda item (host only)',
	},
	{
		id: 'meeting.task.add',
		name: 'Add Task',
		group: 'In-Meeting',
		scope: 'meeting',
		defaultAlias: 'task',
		defaultHotkey: { key: 'A', shift: true },
		keywords: ['task', 'action item', 'assign'],
		description: 'Assign a new task (host only)',
	},
	{
		id: 'meeting.leave',
		name: 'Leave Meeting',
		group: 'In-Meeting',
		scope: 'meeting',
		defaultAlias: 'leave',
		defaultHotkey: { key: 'l', mod: true, shift: true },
		keywords: ['leave', 'exit', 'disconnect'],
		description: 'Leave the current meeting',
	},
	{
		id: 'meeting.end',
		name: 'End Meeting',
		group: 'In-Meeting',
		scope: 'meeting',
		defaultAlias: 'end',
		defaultHotkey: { key: 'e', mod: true, shift: true },
		keywords: ['end', 'close', 'finish'],
		description: 'End the meeting for all participants (host only)',
	},

	// ── Dock Panels ───────────────────────────────────────────────────────────
	{
		id: 'dock.toggle',
		name: 'Toggle Meeting Dock',
		group: 'Dock Panels',
		scope: 'meeting',
		defaultAlias: 'dock',
		defaultHotkey: { key: ']', mod: true },
		keywords: ['dock', 'sidebar', 'panel', 'toggle'],
		description: 'Show or hide the meeting side dock',
	},
	{
		id: 'dock.agenda',
		name: 'Open Agenda Panel',
		group: 'Dock Panels',
		scope: 'meeting',
		defaultAlias: 'ag',
		defaultHotkey: { key: 'g' },
		keywords: ['agenda', 'dock', 'panel'],
		description: 'Switch dock to the Agenda tab',
	},
	{
		id: 'dock.chat',
		name: 'Open Chat Panel',
		group: 'Dock Panels',
		scope: 'meeting',
		defaultAlias: 'chat',
		defaultHotkey: { key: 'h' },
		keywords: ['chat', 'messages', 'dock'],
		description: 'Switch dock to the Chat tab',
	},
	{
		id: 'dock.transcript',
		name: 'Open Transcript Panel',
		group: 'Dock Panels',
		scope: 'meeting',
		defaultAlias: 'transcript',
		defaultHotkey: { key: 't' },
		keywords: ['transcript', 'captions', 'speech'],
		description: 'Switch dock to the Transcript tab',
	},
	{
		id: 'dock.minutes',
		name: 'Open Minutes Panel',
		group: 'Dock Panels',
		scope: 'meeting',
		defaultAlias: 'minutes',
		defaultHotkey: { key: 'i' },
		keywords: ['minutes', 'notes', 'summary'],
		description: 'Switch dock to the Minutes tab',
	},
	{
		id: 'dock.actions',
		name: 'Open Actions Panel',
		group: 'Dock Panels',
		scope: 'meeting',
		defaultAlias: 'actions',
		keywords: ['actions', 'tasks', 'items'],
		description: 'Switch dock to the Actions tab',
	},

	// ── Archive ───────────────────────────────────────────────────────────────
	{
		id: 'archive.search.content',
		name: 'Focus Transcript Search',
		group: 'Archive',
		scope: 'archive',
		defaultAlias: 'search',
		defaultHotkey: { key: '/' },
		keywords: ['search', 'transcript', 'filter', 'find'],
		description: 'Focus the transcript content search field',
	},
	{
		id: 'archive.search.people',
		name: 'Filter by Speaker',
		group: 'Archive',
		scope: 'archive',
		defaultAlias: 'speaker',
		keywords: ['speaker', 'people', 'person', 'filter'],
		description: 'Open the speaker filter dropdown',
	},
	{
		id: 'archive.tag.add',
		name: 'Add Tag',
		group: 'Archive',
		scope: 'archive',
		defaultAlias: 'tag',
		defaultHotkey: { key: 't' },
		keywords: ['tag', 'label', 'add tag'],
		description: 'Open the Add Tag panel',
	},

	// ── My Tasks ──────────────────────────────────────────────────────────────
	{
		id: 'tasks.view.table',
		name: 'Table View',
		group: 'My Tasks',
		scope: 'tasks',
		defaultAlias: 'table',
		defaultHotkey: { key: 't' },
		keywords: ['table', 'list', 'view'],
		description: 'Switch to table/list view',
	},
	{
		id: 'tasks.view.kanban',
		name: 'Kanban View',
		group: 'My Tasks',
		scope: 'tasks',
		defaultAlias: 'kanban',
		defaultHotkey: { key: 'k' },
		keywords: ['kanban', 'board', 'view', 'cards'],
		description: 'Switch to kanban board view',
	},
];

/** All action groups in display order. */
export const ACTION_GROUPS = [
	'Navigation',
	'Meeting Actions',
	'Global',
	'In-Meeting',
	'Dock Panels',
	'Archive',
	'My Tasks',
] as const;

/** Quick lookup by id. */
export const ACTION_BY_ID: Record<string, ActionDef> = Object.fromEntries(
	ALL_ACTIONS.map(a => [a.id, a])
);
