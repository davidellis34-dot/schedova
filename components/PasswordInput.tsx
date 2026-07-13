import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  Pressable,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from "react-native";

type Props = TextInputProps & {
  containerStyle?: ViewStyle;
  iconColor?: string;
};

export function PasswordInput({
  autoCapitalize = "none",
  autoCorrect = false,
  containerStyle,
  iconColor = "#555555",
  style,
  ...inputProps
}: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
        },
        containerStyle,
      ]}
    >
      <TextInput
        {...inputProps}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        secureTextEntry={!visible}
        style={[{ flex: 1 }, style]}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={visible ? "Hide password" : "Show password"}
        onPress={() => setVisible((current) => !current)}
        hitSlop={10}
        style={{
          position: "absolute",
          right: 12,
          height: "100%",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Ionicons
          name={visible ? "eye-off-outline" : "eye-outline"}
          size={22}
          color={iconColor}
        />
      </Pressable>
    </View>
  );
}
