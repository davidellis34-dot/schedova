import { useCallback, useRef, useState } from "react";
import type {
  NativeSyntheticEvent,
  TextInputEndEditingEventData,
} from "react-native";

type TextInputEndEditingPayload =
  | NativeSyntheticEvent<TextInputEndEditingEventData>
  | { nativeEvent?: { text?: string | null } }
  | string
  | null
  | undefined;

function normalizeTextInputValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function readEndEditingText(
  payload: TextInputEndEditingPayload,
  currentValue: string,
) {
  if (typeof payload === "string") {
    return normalizeTextInputValue(payload);
  }

  const nativeText = payload?.nativeEvent?.text;

  if (typeof nativeText !== "string") {
    return currentValue;
  }

  const normalizedText = normalizeTextInputValue(nativeText);

  if (normalizedText === "" && currentValue !== "") {
    return currentValue;
  }

  return normalizedText;
}

export function createTextInputDraftTracker(initialValue = "") {
  let latestValue = normalizeTextInputValue(initialValue);

  return {
    getValue() {
      return latestValue;
    },
    setValue(nextValue: unknown) {
      latestValue = normalizeTextInputValue(nextValue);
      return latestValue;
    },
    handleChangeText(nextValue: string) {
      latestValue = normalizeTextInputValue(nextValue);
      return latestValue;
    },
    handleEndEditing(payload: TextInputEndEditingPayload) {
      latestValue = readEndEditingText(payload, latestValue);
      return latestValue;
    },
  };
}

export function useTrackedTextInputValue(initialValue = "") {
  const trackerRef = useRef(createTextInputDraftTracker(initialValue));
  const [value, setValueState] = useState(() => trackerRef.current.getValue());

  const setValue = useCallback((nextValue: unknown) => {
    const normalizedValue = trackerRef.current.setValue(nextValue);
    setValueState(normalizedValue);
    return normalizedValue;
  }, []);

  const handleChangeText = useCallback((nextValue: string) => {
    const normalizedValue = trackerRef.current.handleChangeText(nextValue);
    setValueState(normalizedValue);
    return normalizedValue;
  }, []);

  const handleEndEditing = useCallback(
    (payload: NativeSyntheticEvent<TextInputEndEditingEventData>) => {
      const normalizedValue = trackerRef.current.handleEndEditing(payload);
      setValueState(normalizedValue);
      return normalizedValue;
    },
    [],
  );

  const getValue = useCallback(() => trackerRef.current.getValue(), []);

  return {
    value,
    setValue,
    onChangeText: handleChangeText,
    onEndEditing: handleEndEditing,
    getValue,
  };
}
