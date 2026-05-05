import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../../shared/components/Icon";
import { MessageAdd01Icon } from "@hugeicons/core-free-icons";

export interface TaskFeedbackModalState {
    title: string;
    subtitle: string;
    placeholder: string;
    required: boolean;
    defaultValue: string;
    resolve: (value: string | null) => void;
}

interface TaskFeedbackModalProps {
    modal: TaskFeedbackModalState | null;
    /** Parent resolves the pending Promise then clears `modal`. */
    onComplete: (value: string | null) => void;
}

/** Host feedback / verification note modal (portal). Shared by meeting Tasks list and My Tasks table. */
export function TaskFeedbackModal({ modal, onComplete }: TaskFeedbackModalProps) {
    const feedbackTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [resetSeed, setResetSeed] = useState(0);

    useEffect(() => {
        if (modal) setResetSeed((s) => s + 1);
    }, [modal]);

    const close = useCallback(
        (value: string | null) => {
            onComplete(value);
        },
        [onComplete],
    );

    if (!modal) return null;

    return createPortal(
        <div
            className="fb-modal-overlay"
            onClick={() => close(null)}
            onKeyDown={(e) => {
                if (e.key === "Escape") close(null);
            }}
            tabIndex={-1}
            role="presentation"
        >
            <div className="fb-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
                <div className="fb-modal-header">
                    <div className="fb-modal-icon-wrap">
                        <Icon icon={MessageAdd01Icon} size={18} />
                    </div>
                    <div className="fb-modal-titles">
                        <div className="fb-modal-title">{modal.title}</div>
                        <div className="fb-modal-subtitle">{modal.subtitle}</div>
                    </div>
                </div>

                <div className="fb-modal-body">
                    <textarea
                        key={resetSeed}
                        ref={feedbackTextareaRef}
                        className="fb-modal-textarea"
                        placeholder={modal.placeholder}
                        defaultValue={modal.defaultValue}
                        rows={4}
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                const val = feedbackTextareaRef.current?.value?.trim() || "";
                                if (!modal.required || val) close(val || "");
                            }
                        }}
                    />
                    {modal.required ? (
                        <div className="fb-modal-hint">* A note is required for this action</div>
                    ) : (
                        <div className="fb-modal-hint fb-modal-hint-optional">
                            Optional — leave blank to skip · Ctrl+Enter to send
                        </div>
                    )}
                </div>

                <div className="fb-modal-actions">
                    <button className="btn btn-secondary" type="button" onClick={() => close(null)}>
                        Cancel
                    </button>
                    <button
                        className="btn btn-primary"
                        type="button"
                        onClick={() => {
                            const val = feedbackTextareaRef.current?.value?.trim() || "";
                            if (modal.required && !val) {
                                feedbackTextareaRef.current?.focus();
                                feedbackTextareaRef.current?.classList.add("fb-shake");
                                setTimeout(() => feedbackTextareaRef.current?.classList.remove("fb-shake"), 500);
                                return;
                            }
                            close(val || "");
                        }}
                    >
                        <Icon icon={MessageAdd01Icon} size={14} />
                        Send Note
                    </button>
                </div>
            </div>

            <style>{`
                .fb-modal-overlay {
                    position: fixed; inset: 0; z-index: 9000;
                    background: rgba(var(--flexoki-black-rgb), 0.55);
                    backdrop-filter: blur(6px);
                    display: flex; align-items: center; justify-content: center;
                    animation: fbOverlayIn 0.2s ease;
                }
                @keyframes fbOverlayIn {
                    from { opacity: 0; }
                    to   { opacity: 1; }
                }
                .fb-modal-card {
                    width: min(480px, calc(100vw - 2rem));
                    background: var(--bg-secondary);
                    border: 1px solid var(--border);
                    border-radius: 16px;
                    box-shadow: 0 24px 64px rgba(var(--flexoki-black-rgb), 0.4), 0 0 0 1px rgba(var(--ui-shine-rgb), 0.04);
                    animation: fbCardIn 0.25s cubic-bezier(0.34,1.56,0.64,1);
                    overflow: hidden;
                }
                @keyframes fbCardIn {
                    from { opacity: 0; transform: scale(0.92) translateY(12px); }
                    to   { opacity: 1; transform: scale(1) translateY(0); }
                }
                .fb-modal-header {
                    display: flex;
                    align-items: flex-start;
                    gap: 0.875rem;
                    padding: 1.25rem 1.375rem 1rem;
                    border-bottom: 1px solid var(--border);
                }
                .fb-modal-icon-wrap {
                    width: 36px; height: 36px; flex-shrink: 0;
                    border-radius: 10px;
                    background: var(--primary-muted);
                    border: 1px solid var(--primary-border);
                    color: var(--primary);
                    display: flex; align-items: center; justify-content: center;
                }
                .fb-modal-titles { flex: 1; min-width: 0; }
                .fb-modal-title {
                    font-size: 0.9375rem;
                    font-weight: 600;
                    color: var(--text-primary);
                    letter-spacing: -0.016em;
                    line-height: 1.3;
                }
                .fb-modal-subtitle {
                    font-size: 0.75rem;
                    color: var(--text-muted);
                    margin-top: 3px;
                    line-height: 1.45;
                }
                .fb-modal-body {
                    padding: 1rem 1.375rem;
                }
                .fb-modal-textarea {
                    width: 100%;
                    min-height: 110px;
                    background: var(--bg-elevated);
                    border: 1.5px solid var(--border);
                    border-radius: 10px;
                    color: var(--text-primary);
                    font-size: 0.875rem;
                    font-family: inherit;
                    line-height: 1.6;
                    padding: 0.625rem 0.75rem;
                    resize: vertical;
                    outline: none;
                    transition: border-color 0.18s ease, box-shadow 0.18s ease;
                    box-sizing: border-box;
                }
                .fb-modal-textarea:focus {
                    border-color: var(--primary);
                    box-shadow: 0 0 0 3px var(--primary-muted);
                }
                .fb-modal-textarea.fb-shake {
                    animation: fbShake 0.4s ease;
                    border-color: var(--accent-rose);
                    box-shadow: 0 0 0 3px rgba(var(--flexoki-red-400-rgb), 0.15);
                }
                @keyframes fbShake {
                    0%,100% { transform: translateX(0); }
                    20%     { transform: translateX(-6px); }
                    60%     { transform: translateX(5px); }
                    80%     { transform: translateX(-3px); }
                }
                .fb-modal-hint {
                    font-size: 0.6875rem;
                    color: var(--accent-rose);
                    margin-top: 6px;
                    font-weight: 500;
                }
                .fb-modal-hint-optional {
                    color: var(--text-muted);
                    font-weight: 400;
                }
                .fb-modal-actions {
                    display: flex;
                    gap: 0.5rem;
                    justify-content: flex-end;
                    padding: 0.875rem 1.375rem;
                    border-top: 1px solid var(--border);
                    background: var(--bg-elevated);
                }
            `}</style>
        </div>,
        document.body,
    );
}
