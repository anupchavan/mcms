import { HugeiconsIcon } from '@hugeicons/react';

interface IconProps {
  icon: any;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  [key: string]: unknown;
}

export default function Icon({ icon, size = 24, className, style, ...rest }: IconProps) {
  if (icon == null || !Array.isArray(icon)) {
    return null;
  }
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      color={style?.color ?? 'currentColor'}
      className={className}
      {...rest}
    />
  );
}
