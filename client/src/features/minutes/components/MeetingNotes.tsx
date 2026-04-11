import { useState, useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Placeholder from '@tiptap/extension-placeholder';
import { common, createLowlight } from 'lowlight';
import Icon from '../../../shared/components/Icon';
import {
    ArrowDown01Icon, ArrowUp01Icon,
    TextBoldIcon, TextItalicIcon, TextStrikethroughIcon, TextUnderlineIcon,
    SourceCodeIcon, LeftToRightBlockQuoteIcon,
    LeftToRightListBulletIcon, LeftToRightListNumberIcon, TaskDone01Icon,
    Cancel01Icon,
} from '@hugeicons/core-free-icons';
import { useAuth } from '../../../stores/AuthContext';

const _raw = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
const API_BASE = _raw.endsWith('/api') ? _raw : `${_raw.replace(/\/?$/, '')}/api`;
interface MeetingNotesProps {
    meetingId?: string;
}

const lowlight = createLowlight(common);
const AUTOSAVE_DELAY = 1500;

export default function MeetingNotes({ meetingId }: MeetingNotesProps) {
    const { user } = useAuth();
    const [collapsed, setCollapsed] = useState(false);
    const [headingOpen, setHeadingOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const headingRef = useRef<HTMLDivElement | null>(null);
    const loadedRef = useRef(false);

    const fetchWithAuth = useCallback(async (url: string, options: RequestInit = {}) => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string> || {}) };
        if (user?.token) headers.Authorization = `Bearer ${user.token}`;
        return fetch(url, { ...options, headers });
    }, [user?.token]);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                codeBlock: false,
            }),
            Underline,
            TaskList,
            TaskItem.configure({ nested: true }),
            CodeBlockLowlight.configure({ lowlight }),
            Placeholder.configure({ placeholder: 'Start taking notes...' }),
        ],
        editorProps: {
            handleKeyDown: (view, event) => {
                const mod = event.metaKey || event.ctrlKey;

                if (mod && event.shiftKey && event.key === 's') {
                    event.preventDefault();
                    view.dispatch(view.state.tr);
                    editor.chain().focus().toggleStrike().run();
                    return true;
                }
                if (mod && event.shiftKey && event.key === 'b') {
                    event.preventDefault();
                    editor.chain().focus().toggleBlockquote().run();
                    return true;
                }
                if (mod && event.altKey && event.key === 'e') {
                    event.preventDefault();
                    editor.chain().focus().toggleCodeBlock().run();
                    return true;
                }
                if (mod && event.shiftKey && event.key === '7') {
                    event.preventDefault();
                    editor.chain().focus().toggleOrderedList().run();
                    return true;
                }
                if (mod && event.shiftKey && event.key === '8') {
                    event.preventDefault();
                    editor.chain().focus().toggleBulletList().run();
                    return true;
                }
                if (mod && event.shiftKey && event.key === '9') {
                    event.preventDefault();
                    editor.chain().focus().toggleTaskList().run();
                    return true;
                }
                return false;
            },
        },
        onUpdate: ({ editor: ed }) => {
            if (!meetingId || !loadedRef.current) return;
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(() => {
                saveNotes(ed.getJSON());
            }, AUTOSAVE_DELAY);
        },
    });

    const saveNotes = useCallback(async (content: any) => {
        if (!meetingId) return;
        setSaving(true);
        try {
            await fetchWithAuth(`${API_BASE}/notes/${meetingId}`, {
                method: 'PUT',
                body: JSON.stringify({ content }),
            });
            setLastSaved(new Date());
        } catch (err) {
            console.error('Failed to save notes:', err);
        } finally {
            setSaving(false);
        }
    }, [meetingId, fetchWithAuth]);

    useEffect(() => {
        if (!meetingId || !editor) return;
        loadedRef.current = false;
        (async () => {
            try {
                const res = await fetchWithAuth(`${API_BASE}/notes/${meetingId}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.content) {
                        editor.commands.setContent(data.content);
                    } else {
                        editor.commands.clearContent();
                    }
                }
            } catch (err) {
                console.error('Failed to load notes:', err);
            } finally {
                loadedRef.current = true;
            }
        })();
    }, [meetingId, editor, fetchWithAuth]);

    useEffect(() => {
        if (!headingOpen) return;
        const handleClick = (e: MouseEvent) => {
            if (headingRef.current && !headingRef.current.contains(e.target as Node)) {
                setHeadingOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [headingOpen]);

    useEffect(() => {
        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, []);

    if (!editor) return null;

    const ToolBtn = ({ onClick, active = false, children, title }: { onClick: () => void; active?: boolean; children: React.ReactNode; title: string }) => (
        <button
            type="button"
            className={`notes-toolbar-btn ${active ? 'active' : ''}`}
            onClick={onClick}
            title={title}
            onMouseDown={(e) => e.preventDefault()}
        >
            {children}
        </button>
    );

    const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
    const modKey = isMac ? '\u2318' : 'Ctrl';
    const optKey = isMac ? '\u2325' : 'Alt';
    const shiftKey = isMac ? '\u21E7' : 'Shift';

    return (
        <div className="meeting-notes-section">
            <div
                className="section-header collapsible-header"
                onClick={() => setCollapsed(c => !c)}
            >
                <div className="section-title-container">
                    <span className="section-title">Meeting Notes</span>
                    {saving && <span className="notes-save-indicator">Saving...</span>}
                    {!saving && lastSaved && (
                        <span className="notes-save-indicator">Saved</span>
                    )}
                </div>
                <Icon icon={collapsed ? ArrowDown01Icon : ArrowUp01Icon} size={14} />
            </div>

            {!collapsed && (
                <div className="notes-editor-wrapper">
                    <EditorContent editor={editor} className="notes-editor-content" />

                    <div className="notes-toolbar">
                        <div className="notes-toolbar-group" ref={headingRef}>
                            <ToolBtn
                                onClick={() => setHeadingOpen(h => !h)}
                                active={editor.isActive('heading')}
                                title="Headings"
                            >
                                <span className="notes-heading-trigger">H<Icon icon={ArrowDown01Icon} size={10} /></span>
                            </ToolBtn>
                            {headingOpen && (
                                <div className="notes-heading-dropdown">
                                    {[1, 2, 3].map(level => (
                                        <button
                                            key={level}
                                            type="button"
                                            className={`notes-heading-option ${editor.isActive('heading', { level }) ? 'active' : ''}`}
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => {
                                                editor.chain().focus().toggleHeading({ level }).run();
                                                setHeadingOpen(false);
                                            }}
                                        >
                                            <span>Heading {level}</span>
                                            <span className="notes-heading-shortcut">
                                                <kbd>{optKey}</kbd><kbd>{modKey}</kbd><kbd>{level}</kbd>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <ToolBtn
                            onClick={() => editor.chain().focus().toggleBold().run()}
                            active={editor.isActive('bold')}
                            title={`Bold (${modKey}+B)`}
                        >
                            <Icon icon={TextBoldIcon} size={15} />
                        </ToolBtn>
                        <ToolBtn
                            onClick={() => editor.chain().focus().toggleItalic().run()}
                            active={editor.isActive('italic')}
                            title={`Italic (${modKey}+I)`}
                        >
                            <Icon icon={TextItalicIcon} size={15} />
                        </ToolBtn>
                        <ToolBtn
                            onClick={() => editor.chain().focus().toggleStrike().run()}
                            active={editor.isActive('strike')}
                            title={`Strikethrough (${shiftKey}+${modKey}+S)`}
                        >
                            <Icon icon={TextStrikethroughIcon} size={15} />
                        </ToolBtn>
                        <ToolBtn
                            onClick={() => editor.chain().focus().toggleUnderline().run()}
                            active={editor.isActive('underline')}
                            title={`Underline (${modKey}+U)`}
                        >
                            <Icon icon={TextUnderlineIcon} size={15} />
                        </ToolBtn>
                        <ToolBtn
                            onClick={() => editor.chain().focus().toggleCode().run()}
                            active={editor.isActive('code')}
                            title={`Inline code (${modKey}+E)`}
                        >
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, fontFamily: 'monospace' }}>&lt;&gt;</span>
                        </ToolBtn>
                        <ToolBtn
                            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                            active={editor.isActive('codeBlock')}
                            title={`Code block (${optKey}+${modKey}+E)`}
                        >
                            <Icon icon={SourceCodeIcon} size={15} />
                        </ToolBtn>
                        <ToolBtn
                            onClick={() => editor.chain().focus().toggleBlockquote().run()}
                            active={editor.isActive('blockquote')}
                            title={`Blockquote (${shiftKey}+${modKey}+B)`}
                        >
                            <Icon icon={LeftToRightBlockQuoteIcon} size={15} />
                        </ToolBtn>
                        <ToolBtn
                            onClick={() => editor.chain().focus().toggleOrderedList().run()}
                            active={editor.isActive('orderedList')}
                            title={`Ordered list (${modKey}+${shiftKey}+7)`}
                        >
                            <Icon icon={LeftToRightListNumberIcon} size={15} />
                        </ToolBtn>
                        <ToolBtn
                            onClick={() => editor.chain().focus().toggleBulletList().run()}
                            active={editor.isActive('bulletList')}
                            title={`Bullet list (${modKey}+${shiftKey}+8)`}
                        >
                            <Icon icon={LeftToRightListBulletIcon} size={15} />
                        </ToolBtn>
                        <ToolBtn
                            onClick={() => editor.chain().focus().toggleTaskList().run()}
                            active={editor.isActive('taskList')}
                            title={`Task list (${modKey}+${shiftKey}+9)`}
                        >
                            <Icon icon={TaskDone01Icon} size={15} />
                        </ToolBtn>

                        <div style={{ flex: 1 }} />
                        <ToolBtn
                            onClick={() => {
                                editor.commands.clearContent();
                                saveNotes(editor.getJSON());
                            }}
                            title="Clear notes"
                        >
                            <Icon icon={Cancel01Icon} size={14} />
                        </ToolBtn>
                    </div>
                </div>
            )}
        </div>
    );
}
