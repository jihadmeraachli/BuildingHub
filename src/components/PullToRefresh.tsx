import { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { isNativeApp } from '@/lib/biolock';

/**
 * Pull-to-refresh for the native iOS app (#69): drag down from the top of the
 * scroll container to reload. Web/PWA browsers keep their own refresh — this
 * activates only inside the Capacitor shell. Pure touch handling, no plugin;
 * the indicator is driven by direct style writes (no re-render per move).
 */
const THRESHOLD = 72;   // px of (dampened) pull that arms the refresh
const MAX_PULL = 110;

export function usePullToRefresh(scrollRef: React.RefObject<HTMLElement | null>, indicatorRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!isNativeApp()) return;
    const el = scrollRef.current;
    const ind = indicatorRef.current;
    if (!el || !ind) return;

    let startY = 0;
    let pull = 0;
    let tracking = false;
    let refreshing = false;

    const paint = () => {
      ind.style.opacity = pull > 6 ? String(Math.min(1, pull / THRESHOLD)) : '0';
      ind.style.transform = `translateX(-50%) translateY(${Math.min(pull, MAX_PULL) - 44}px) rotate(${pull * 2.4}deg)`;
      ind.classList.toggle('ptr-armed', pull >= THRESHOLD);
    };

    const onStart = (e: TouchEvent) => {
      if (refreshing) return;
      tracking = el.scrollTop <= 0;
      startY = e.touches[0].clientY;
      pull = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking || refreshing) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 0 && el.scrollTop <= 0) {
        e.preventDefault();               // take over from the webview bounce
        pull = Math.min(dy * 0.5, MAX_PULL); // dampened, native feel
        paint();
      } else if (dy <= 0) {
        pull = 0;
        paint();
      }
    };
    const onEnd = () => {
      if (!tracking || refreshing) return;
      tracking = false;
      if (pull >= THRESHOLD) {
        refreshing = true;
        ind.classList.add('ptr-spinning');
        ind.style.opacity = '1';
        ind.style.transform = 'translateX(-50%) translateY(28px)';
        setTimeout(() => window.location.reload(), 350);
      } else {
        pull = 0;
        ind.style.transition = 'transform 200ms, opacity 200ms';
        paint();
        setTimeout(() => { ind.style.transition = ''; }, 220);
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [scrollRef, indicatorRef]);
}

/** The floating indicator — render inside a relatively-positioned scroll parent. */
export function PullIndicator({ innerRef }: { innerRef: React.RefObject<HTMLDivElement | null> }) {
  if (!isNativeApp()) return null;
  return (
    <div
      ref={innerRef}
      className="ptr-indicator pointer-events-none absolute top-0 left-1/2 z-40 w-10 h-10 rounded-full bg-card border border-border shadow-lg flex items-center justify-center text-primary"
      style={{ opacity: 0, transform: 'translateX(-50%) translateY(-44px)' }}
    >
      <RefreshCw size={18} />
    </div>
  );
}
