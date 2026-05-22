import { Alert, Platform } from "react-native";

type ConfirmDestructiveActionOptions = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => Promise<void> | void;
};

export async function confirmDestructiveAction({
  title,
  message,
  confirmText = "Delete",
  cancelText = "Cancel",
  onConfirm,
}: ConfirmDestructiveActionOptions) {
  if (Platform.OS === "web") {
    const webGlobal = globalThis as unknown as {
      confirm?: (message: string) => boolean;
    };

    const confirmed =
      typeof webGlobal.confirm === "function"
        ? webGlobal.confirm(`${title}\n\n${message}`)
        : false;

    if (confirmed) {
      await onConfirm();
    }

    return confirmed;
  }

  return await new Promise<boolean>((resolve) => {
    Alert.alert(title, message, [
      {
        text: cancelText,
        style: "cancel",
        onPress: () => resolve(false),
      },
      {
        text: confirmText,
        style: "destructive",
        onPress: () => {
          Promise.resolve(onConfirm())
            .then(() => resolve(true))
            .catch((error) => {
              console.log("confirmDestructiveAction failed", error);
              resolve(false);
            });
        },
      },
    ]);
  });
}
