import { InteractionManager, TextInput } from "react-native";

function waitForAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export async function settleActiveTextInput() {
  const focusedInput = TextInput.State.currentlyFocusedInput?.();
  focusedInput?.blur?.();

  await new Promise<void>((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });
  await waitForAnimationFrame();
  await waitForAnimationFrame();

  return !TextInput.State.currentlyFocusedInput?.();
}
