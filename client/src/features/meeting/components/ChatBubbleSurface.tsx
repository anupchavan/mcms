import type { FC, ReactNode } from "react";

/**
 * CSS rounded body + tail from `bubbles/tail-me.svg`. Others: same path, reflected
 * across the vertical axis (scaleX(-1)) for bottom-left.
 */

const TAIL_VB_W = 19;
const TAIL_VB_H = 16;

/** Path from bubbles/tail-me.svg */
const TAIL_ME_PATH =
  "M18.3597 14.7395C9.25742 16.3944 2.32729 11.6364 0 9.05055L0.258587 1.29294C2.75826 1.81011 8.17136 2.27557 9.82631 0C9.56773 9.30914 16.5496 13.9637 18.3597 14.7395Z";

const BORDER_RADIUS = "0.758rem";

const TailSvg: FC<{ fill: string; forOthers: boolean }> = ({ fill, forOthers }) => (
  <svg
    aria-hidden
    width={TAIL_VB_W}
    height={TAIL_VB_H}
    viewBox={`0 0 ${TAIL_VB_W} ${TAIL_VB_H}`}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{
      position: "absolute",
      zIndex: 0,
      pointerEvents: "none",
      // Bottom edge: rounded corner’s straight segment ends `1.125rem` from the outer corner — tuck tail there.
      bottom: -1,
      // Align with bottom edge where the corner curve begins (~1.125rem inset from outer corner).
      ...(forOthers
        ? {
            left: "-7.5px",
            right: "auto",
            transform: "scaleX(-1)",
            transformOrigin: "center bottom",
          }
        : {
            right: "-7.5px",
            left: "auto",
            transform: undefined,
            transformOrigin: "center bottom",
          }),
    }}
  >
    <path d={TAIL_ME_PATH} fill={fill} />
  </svg>
);

export interface ChatBubbleSurfaceProps {
  variant: "me" | "others";
  /** When false, omit the tail (middle of a consecutive run from the same sender). Default true. */
  showTail?: boolean;
  children: ReactNode;
}

export const ChatBubbleSurface: FC<ChatBubbleSurfaceProps> = ({ variant, showTail = true, children }) => {
  const isMe = variant === "me";
  const bg = isMe ? "var(--me-chat-bg)" : "var(--bg-elevated)";

  return (
    <div
      className={isMe ? "chat-bubble-surface chat-bubble-surface--me" : "chat-bubble-surface chat-bubble-surface--others"}
      style={{
        position: "relative",
        display: "inline-block",
        width: "max-content",
        maxWidth: "100%",
        verticalAlign: "top",
        paddingBottom: showTail ? 8 : 0,
      }}
    >
      <div
        className="chat-bubble-surface__body"
        style={{
          position: "relative",
          zIndex: 1,
          boxSizing: "border-box",
          minHeight: 36,
          overflow: "visible",
          borderRadius: BORDER_RADIUS,
          background: bg,
          padding: isMe ? "0.5rem 0.65rem 0.5rem 0.65rem" : "0.5rem 0.65rem 0.5rem 0.65rem",
          fontSize: "0.875rem",
          lineHeight: 1.4,
          color: isMe ? "#fff" : "var(--text-primary)",
        }}
      >
        {showTail && <TailSvg fill={bg} forOthers={!isMe} />}
        <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
      </div>
    </div>
  );
};
