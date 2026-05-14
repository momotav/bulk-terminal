'use client';

// Tweened-number display. Renders a number that smoothly animates
// when its `value` prop changes, instead of hard-snapping to the new
// value. Used on live-updating tiles (TPS, APS, Round) where the
// underlying data refreshes every few seconds — hard updates feel
// like flicker; smooth tweens feel like a live read.
//
// Implementation uses framer-motion's `useMotionValue` + `useSpring`
// rather than manual requestAnimationFrame loops. The spring physics
// give a natural settle even when values change rapidly.
//
// Limitations:
//   - Only animates between numeric values. Pass `value={null}` to
//     render a placeholder ("--") with no animation.
//   - The DOM text is updated on every animation frame via subscribe;
//     this is fine for a handful of tiles but don't render thousands.

import { useEffect, useRef } from 'react';
import { useMotionValue, useSpring, useTransform, type MotionValue } from 'framer-motion';

interface AnimatedNumberProps {
  value: number | null;
  // How to format the current frame's numeric value into the displayed
  // string. Lets the caller control thousands separators, units, decimal
  // places. The function receives the in-flight motion value, not the
  // target — so animation looks smooth.
  format: (n: number) => string;
  className?: string;
  // Spring stiffness/damping. Defaults are tuned for "snappy but
  // smooth"; bump stiffness for faster settles or damping for less
  // overshoot.
  stiffness?: number;
  damping?: number;
}

export function AnimatedNumber({
  value,
  format,
  className,
  stiffness = 80,
  damping = 24,
}: AnimatedNumberProps) {
  // Raw motion value tracks the current displayed number. Spring
  // smooths transitions to the target. We always feed valid numbers
  // into the motion value — null is handled at render time.
  const motionValue = useMotionValue(value ?? 0);
  const springValue = useSpring(motionValue, { stiffness, damping });

  // When the target value changes, push it into the motion value.
  // The spring picks it up and animates from current → target.
  useEffect(() => {
    if (value !== null && Number.isFinite(value)) {
      motionValue.set(value);
    }
  }, [value, motionValue]);

  if (value === null) {
    return <span className={className}>--</span>;
  }

  return <AnimatedNumberInner spring={springValue} format={format} className={className} />;
}

// Separate inner component so we can subscribe to the spring without
// putting an extra hook in the parent's render path.
function AnimatedNumberInner({
  spring,
  format,
  className,
}: {
  spring: MotionValue<number>;
  format: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  // useTransform lets us derive the formatted string. We also imperatively
  // update the DOM textContent on each motion frame to avoid React's
  // re-render cycle (which would make per-frame updates expensive).
  const formatted = useTransform(spring, (latest) => format(latest));

  useEffect(() => {
    const unsubscribe = formatted.on('change', (latest) => {
      if (ref.current) ref.current.textContent = latest;
    });
    // Set the initial value synchronously so first paint isn't empty.
    if (ref.current) ref.current.textContent = format(spring.get());
    return unsubscribe;
  }, [formatted, format, spring]);

  return <span ref={ref} className={className} />;
}
