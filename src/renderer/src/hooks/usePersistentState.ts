import { useCallback, useState } from "react";

// Preferência local do usuário (nome, volume). O storage pode estar indisponível;
// nesse caso o valor vive só na memória.
export function usePersistentState<T>(key: string, initial: () => T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) return JSON.parse(stored) as T;
    } catch {
      // Ignora storage bloqueado ou JSON inválido.
    }
    return initial();
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Idem.
      }
    },
    [key],
  );

  return [value, update] as const;
}
