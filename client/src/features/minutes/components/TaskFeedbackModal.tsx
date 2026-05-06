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
export function TaskFeedbackModal({
    modal,
    onComplete,
}: TaskFeedbackModalProps) {
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
            <div
                className="fb-modal-card"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                <div className="fb-modal-header">
                    <div className="fb-modal-icon-wrap">
                        <Icon icon={MessageAdd01Icon} size={18} />
                    </div>
                    <div className="fb-modal-titles">
                        <div className="fb-modal-title">{modal.title}</div>
                        <div className="fb-modal-subtitle">
                            {modal.subtitle}
                        </div>
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
                                const val =
                                    feedbackTextareaRef.current?.value?.trim() ||
                                    "";
                                if (!modal.required || val) close(val || "");
                            }
                        }}
                    />
                    {modal.required ? (
                        <div className="fb-modal-hint">
                            * A note is required for this action
                        </div>
                    ) : (
                        <div className="fb-modal-hint fb-modal-hint-optional">
                            Optional — leave blank to skip · Ctrl+Enter to send
                        </div>
                    )}
                </div>

                <div className="fb-modal-actions">
                    <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() => close(null)}
                    >
                        Cancel
                    </button>
                    <button
                        className="btn btn-primary"
                        type="button"
                        onClick={() => {
                            const val =
                                feedbackTextareaRef.current?.value?.trim() ||
                                "";
                            if (modal.required && !val) {
                                feedbackTextareaRef.current?.focus();
                                feedbackTextareaRef.current?.classList.add(
                                    "fb-shake",
                                );
                                setTimeout(
                                    () =>
                                        feedbackTextareaRef.current?.classList.remove(
                                            "fb-shake",
                                        ),
                                    500,
                                );
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
        </div>,
        document.body,
    );
}
