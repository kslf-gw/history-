import { useState } from 'react';
import { BookOpen, Compass, Landmark } from 'lucide-react';
import type { RecordCategory } from '../types/history';

interface ArchivalImageProps {
  src?: string | null;
  alt: string;
  category?: RecordCategory;
  className?: string;
}

export function ArchivalImage({ src, alt, category = 'concept', className = '' }: ArchivalImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    const Icon =
      category === 'polity' || category === 'route' || category === 'site'
        ? Compass
        : category === 'literature' || category === 'archive'
          ? BookOpen
          : Landmark;
    return (
      <div
        className={`flex flex-col items-center justify-center bg-[#F3EFE7] dark:bg-[#22201D] text-[#78716C] dark:text-[#9A9388] border border-[#E5DFD3] dark:border-[#2C2925] ${className}`}
        role="img"
        aria-label={alt}
      >
        <Icon className="w-5 h-5 stroke-[1.5] mb-1 text-[#9A3412]/70 dark:text-[#EA8C55]/80" />
        <span className="text-[10px] font-medium tracking-wide uppercase px-2 text-center line-clamp-1">
          {category}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
      className={`object-cover bg-[#F3EFE7] dark:bg-[#22201D] ${className}`}
    />
  );
}
