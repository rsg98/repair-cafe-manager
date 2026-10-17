import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';

export interface UnsavedWorkContextValue {
  // True when one or more mounted station forms, modals, or confirmation screens hold unsaved state
  isDirty: boolean;
  // Register or clear a dirty token for a specific view/modal component ID
  setDirtyWork: (id: string, dirty: boolean) => void;
}

// Default no-op context value for components rendered outside UnsavedWorkProvider in isolated tests
const UnsavedWorkContext = createContext<UnsavedWorkContextValue>({
  isDirty: false,
  setDirtyWork: () => {},
});

/**
 * Top-level provider tracking whether any station view or modal currently holds unsaved
 * form input or an active post-submit confirmation/routing screen that must not be interrupted.
 */
export const UnsavedWorkProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Maintain a set of component IDs that currently report unsaved work
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(() => new Set());

  // Add or remove a component ID from the dirty set without triggering unnecessary re-renders
  const setDirtyWork = useCallback((id: string, dirty: boolean) => {
    setDirtyIds((prev) => {
      const hasId = prev.has(id);
      if (dirty && hasId) return prev;
      if (!dirty && !hasId) return prev;

      const next = new Set(prev);
      if (dirty) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  // Expose aggregate boolean flag alongside the registration callback
  const value = useMemo<UnsavedWorkContextValue>(
    () => ({
      isDirty: dirtyIds.size > 0,
      setDirtyWork,
    }),
    [dirtyIds.size, setDirtyWork]
  );

  return (
    <UnsavedWorkContext.Provider value={value}>
      {children}
    </UnsavedWorkContext.Provider>
  );
};

/**
 * Access the global unsaved work state (`isDirty`) and registration setter (`setDirtyWork`).
 */
export function useUnsavedWork(): UnsavedWorkContextValue {
  return useContext(UnsavedWorkContext);
}

/**
 * Convenience hook for station views and modals to declare whether they currently hold
 * unsaved user inputs or active confirmation screens. Automatically cleans up on unmount.
 */
export function useRegisterUnsavedWork(isDirty: boolean, id?: string): void {
  const generatedId = useId();
  const resolvedId = id ?? generatedId;
  const { setDirtyWork } = useUnsavedWork();

  // Synchronize this component's dirty flag whenever `isDirty` changes
  useEffect(() => {
    setDirtyWork(resolvedId, isDirty);
  }, [resolvedId, isDirty, setDirtyWork]);

  // Ensure the component's dirty token is always removed when the component unmounts
  useEffect(() => {
    return () => {
      setDirtyWork(resolvedId, false);
    };
  }, [resolvedId, setDirtyWork]);
}
