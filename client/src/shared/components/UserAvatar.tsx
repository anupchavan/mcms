import type { CSSProperties } from 'react';
import { avatarUrlFromPath } from '../avatarUrl';
import { getAvatarHue, getAvatarCssVars, getInitials } from '../utils/avatarColor';
import { useTheme } from '../../hooks/useTheme';

export interface UserAvatarProps {
  /** Display name — used for initials and for hue derivation when no userId. */
  name?: string;
  /** Path returned by the server, e.g. `/uploads/avatars/...` */
  profileImage?: string | null;
  /** Stable identifier (Mongo `_id` / `id`) for deterministic hue. Falls back to name. */
  userId?: string;
  /** Diameter in pixels. Default 36. */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Circular avatar used everywhere in the app.
 *
 * – When a profile image is uploaded: renders the image.
 * – When no image: shows 1-2 letter initials on a deterministic Flexoki-hued
 *   background, with a border ring in the accent shade of the same hue.
 *
 * Theme-aware: dark uses -400 bg / -600 accent, light uses -600 bg / -400 accent.
 */
export function UserAvatar({
  name = '',
  profileImage,
  userId,
  size = 36,
  className,
  style,
}: UserAvatarProps) {
  const isDark = useTheme() !== 'light';
  const hue = getAvatarHue(userId || name || 'user');
  const { bg, border, text } = getAvatarCssVars(hue, isDark);
  const initials = getInitials(name);
  const imageUrl = avatarUrlFromPath(profileImage);
  // Use thinner border and smaller font for compact avatars (≤ 22 px)
  const isSmall = size <= 22;
  const borderWidth = isSmall ? 1 : 2;
  const fontSize = isSmall ? 7 : Math.round(size * 0.36);
	console.log(size);
  return (
    <div
      className={`user-avatar${className ? ` ${className}` : ''}`}
      aria-label={name || 'avatar'}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: imageUrl ? 'transparent' : bg,
        border: imageUrl ? 'none' : `${borderWidth}px solid ${border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        fontSize,
        fontWeight: 700,
        color: text,
        flexShrink: 0,
        userSelect: 'none',
        ...style,
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span style={{ lineHeight: 1, pointerEvents: 'none' }}>{initials}</span>
      )}
    </div>
  );
}
