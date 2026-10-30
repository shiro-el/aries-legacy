import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { AgentCatalog } from 'react-native-whip-ssh';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Text } from './ui/text';

export function AgentSkillSheet({
  catalog,
  status,
  onSelect,
  onClose,
}: {
  catalog?: AgentCatalog;
  status: 'loading' | 'ready' | 'unavailable' | 'failed';
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const skills =
    catalog?.skills.filter(skill =>
      `${skill.name} ${skill.description}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    ) ?? [];
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <Pressable
          accessibilityLabel={t('common.close')}
          className="flex-1"
          onPress={onClose}
        />
        <View
          accessibilityViewIsModal
          className="max-h-[75%] rounded-t-3xl bg-background px-4 pb-8 pt-4"
        >
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-lg font-bold">{t('terminal.skills')}</Text>
            <Button variant="ghost" onPress={onClose}>
              <Text>{t('common.close')}</Text>
            </Button>
          </View>
          <Input
            accessibilityLabel={t('terminal.searchSkills')}
            placeholder={t('terminal.searchSkills')}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
          {status !== 'ready' && (
            <Text
              accessibilityLiveRegion="polite"
              className="py-3 text-muted-foreground"
            >
              {t(`terminal.skillsStatus.${status}`)}
            </Text>
          )}
          <ScrollView keyboardShouldPersistTaps="always" className="shrink">
            {skills.map(skill => (
              <Pressable
                key={skill.name}
                accessibilityRole="button"
                accessibilityLabel={skill.name}
                className="border-b border-border py-3"
                onPress={() => onSelect(skill.name)}
              >
                <Text className="font-semibold">{skill.name}</Text>
                <Text className="text-sm text-muted-foreground">
                  {skill.description}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {t(`terminal.skillSource.${skill.source || 'unknown'}`)}
                </Text>
              </Pressable>
            ))}
            {status === 'ready' && skills.length === 0 && (
              <Text className="py-4 text-muted-foreground">
                {t(
                  query.trim()
                    ? 'terminal.skillsNoMatches'
                    : 'terminal.skillsEmpty',
                )}
              </Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
