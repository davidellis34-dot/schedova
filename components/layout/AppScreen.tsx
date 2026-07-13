import { ReactNode, forwardRef } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  View,
  ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type AppScreenProps = Omit<ScrollViewProps, "contentContainerStyle"> & {
  children: ReactNode;
  backgroundColor: string;
  scroll?: boolean;
  keyboardAware?: boolean;
  horizontalPadding?: number;
  topPadding?: number;
  bottomPadding?: number;
  androidBottomPadding?: number;
  contentContainerStyle?: StyleProp<ViewStyle>;
};

type AppScreenPaddingOptions = {
  horizontalPadding?: number;
  topPadding?: number;
  bottomPadding?: number;
  androidBottomPadding?: number;
};

export function useAppScreenPadding({
  horizontalPadding = 20,
  topPadding = 20,
  bottomPadding = 40,
  androidBottomPadding,
}: AppScreenPaddingOptions = {}) {
  const insets = useSafeAreaInsets();
  const topSafeArea = Platform.OS === "web" ? 0 : insets.top;

  return {
    paddingHorizontal: horizontalPadding,
    paddingTop: topSafeArea + topPadding,
    paddingBottom:
      Platform.OS === "ios"
        ? insets.bottom + bottomPadding
        : androidBottomPadding ?? bottomPadding,
  };
}

export const AppScreen = forwardRef<ScrollView, AppScreenProps>(
  (
    {
      children,
      backgroundColor,
      scroll = false,
      keyboardAware = false,
      horizontalPadding = 20,
      topPadding = 20,
      bottomPadding = 40,
      androidBottomPadding,
      contentContainerStyle,
      style,
      keyboardShouldPersistTaps = "handled",
      ...scrollViewProps
    },
    ref,
  ) => {
    const safeContentStyle = useAppScreenPadding({
      horizontalPadding,
      topPadding,
      bottomPadding,
      androidBottomPadding,
    });

    const screenStyle = [{ flex: 1, backgroundColor }, style];

    const content = scroll ? (
      <ScrollView
        ref={ref}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustKeyboardInsets={keyboardAware && Platform.OS === "ios"}
        style={screenStyle}
        contentContainerStyle={[safeContentStyle, contentContainerStyle]}
        {...scrollViewProps}
      >
        {children}
      </ScrollView>
    ) : (
      <View style={[screenStyle, safeContentStyle, contentContainerStyle]}>
        {children}
      </View>
    );

    if (!keyboardAware) {
      return content;
    }

    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, backgroundColor }}
      >
        {content}
      </KeyboardAvoidingView>
    );
  },
);

AppScreen.displayName = "AppScreen";
