import { Pressable, Text, View } from "react-native";
import { CLIENT_TAGS, type ClientTag } from "../lib/clientTags";

type Colors = {
  card: string;
  text: string;
  border: string;
  primary: string;
};

type Props = {
  value: ClientTag;
  onChange: (value: ClientTag) => void;
  colors: Colors;
};

export function ClientTagPicker({ value, onChange, colors }: Props) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ color: colors.text, marginBottom: 8 }}>Client Tag</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {CLIENT_TAGS.map((tag) => {
          const selected = value === tag;

          return (
            <Pressable
              key={tag}
              onPress={() => onChange(tag)}
              style={{
                flex: 1,
                backgroundColor: selected ? colors.primary : colors.card,
                borderWidth: 1,
                borderColor: selected ? colors.primary : colors.border,
                borderRadius: 999,
                paddingVertical: 10,
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: selected ? "#FFFFFF" : colors.text,
                  fontWeight: "800",
                }}
              >
                {tag}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
