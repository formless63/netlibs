'use client';

import { useInsertionEffect, useRef, type RefObject } from 'react';

/** The newest value of a prop, for callbacks that outlive the render that made them. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  // Insertion effects commit before every other effect that might read it.
  useInsertionEffect(() => {
    ref.current = value;
  });
  return ref;
}
