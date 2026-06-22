import { Ionicons } from "@expo/vector-icons";
import { forwardRef, useState } from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useAppTheme } from "../../lib/useAppTheme";
import { createSchedovaUiTheme } from "./theme";

type AppTextInputProps = TextInputProps & {
  label?: string;
  helperText?: string;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
};

export const AppTextInput = forwardRef<TextInput, AppTextInputProps>(
  (
    {
      label,
      helperText,
      error,
      containerStyle,
      inputStyle,
      placeholderTextColor,
      multiline,
      secureTextEntry,
      style,
      ...textInputProps
    },
    ref,
  ) => {
    const { colors: appColors } = useAppTheme();
    const theme = createSchedovaUiTheme(appColors);
    const { colors, spacing, radii, typography, borders } = theme;
    const message = error || helperText;
    const hasPasswordToggle = secureTextEntry === true;
    const [passwordVisible, setPasswordVisible] = useState(false);

    return (
      <View style={[{ marginBottom: spacing.lg }, containerStyle]}>
        {label ? (
          <Text
            style={{
              color: colors.text,
              fontWeight: typography.weights.bold,
              marginBottom: spacing.sm,
            }}
          >
            {label}
          </Text>
        ) : null}

        <View>
          <TextInput
            ref={ref}
            multiline={multiline}
            placeholderTextColor={placeholderTextColor || colors.mutedText}
            secureTextEntry={hasPasswordToggle ? !passwordVisible : secureTextEntry}
            style={[
              {
                minHeight: multiline ? 112 : 54,
                borderWidth: borders.width,
                borderColor: error ? colors.destructive : colors.border,
                borderRadius: radii.lg,
                backgroundColor: colors.card,
                color: colors.text,
                paddingHorizontal: spacing.lg,
                paddingRight: hasPasswordToggle ? 52 : spacing.lg,
                paddingVertical: multiline ? spacing.md : 0,
                fontSize: typography.sizes.bodyLarge,
                textAlignVertical: multiline ? "top" : "center",
              },
              inputStyle,
              style,
            ]}
            {...textInputProps}
          />

          {hasPasswordToggle ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={passwordVisible ? "Hide password" : "Show password"}
              hitSlop={10}
              onPress={() => setPasswordVisible((current) => !current)}
              style={{
                bottom: 0,
                justifyContent: "center",
                position: "absolute",
                right: 14,
                top: 0,
              }}
            >
              <Ionicons
                name={passwordVisible ? "eye-off-outline" : "eye-outline"}
                size={22}
                color={colors.mutedText}
              />
            </Pressable>
          ) : null}
        </View>

        {message ? (
          <Text
            style={{
              color: error ? colors.destructive : colors.mutedText,
              fontSize: typography.sizes.helper,
              lineHeight: typography.lineHeights.helper,
              marginTop: spacing.sm,
            }}
          >
            {message}
          </Text>
        ) : null}
      </View>
    );
  },
);

AppTextInput.displayName = "AppTextInput";
