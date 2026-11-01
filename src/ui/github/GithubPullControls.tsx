import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RuntimeGithubEntry, RuntimeGithubMutation, RuntimeGithubRepositoryDetails } from 'react-native-whip-ssh';
import { GithubButton } from './parts';
import { useGithubStyles } from './styles';

const MERGE_ACTIONS = ['mergePull', 'squashPull', 'rebasePull'] as const;
type MergeAction = typeof MERGE_ACTIONS[number];
export function GithubPullControls({ entry, details, disabled, onAction }: {
  entry: RuntimeGithubEntry; details?: RuntimeGithubRepositoryDetails; disabled: boolean;
  onAction: (action: RuntimeGithubMutation, expectedHead?: string) => void;
}) {
  const { s } = useGithubStyles();
  const { t } = useTranslation();
  const [method, setMethod] = useState<MergeAction>('mergePull');
  const [confirmation, setConfirmation] = useState<{ action: MergeAction; sha: string } | null>(null);
  const allowed = {
    mergePull: details?.allowMergeCommit !== false,
    squashPull: details?.allowSquashMerge !== false,
    rebasePull: details?.allowRebaseMerge !== false,
  };
  const selected = allowed[method] ? method : MERGE_ACTIONS.find(action => allowed[action]);
  const open = entry.state === 'open' || entry.state === 'draft';
  const canMerge = entry.state === 'open' && !!entry.pull?.headSha && entry.pull.mergeable !== false && !!selected;
  return <View style={s.section}>
    <Text style={s.strong}>{t('github.status')}</Text>
    {open && <>
      <Text style={s.muted}>{t(entry.state === 'draft' ? 'github.state.draft' : entry.pull?.mergeable === false ? 'github.mergeConflicts'
        : entry.pull?.mergeable ? 'github.noMergeConflicts' : 'github.mergeabilityUnknown')}</Text>
      <View style={s.row} accessibilityRole="tablist" accessibilityLabel={t('github.chooseMergeMethod')}>
        {MERGE_ACTIONS.map(action => <GithubButton key={action} label={t(`github.${action}`)} selected={selected === action}
          disabled={disabled || !allowed[action]} onPress={() => { setMethod(action); setConfirmation(null); }} />)}
      </View>
      <GithubButton label={t(selected ? 'github.prepareMerge' : 'github.mergeUnavailable')} disabled={disabled || !canMerge}
        onPress={() => { if (selected && entry.pull) setConfirmation({ action: selected, sha: entry.pull.headSha }); }} />
      {confirmation && <View style={s.stack}>
        <Text style={s.body}>{t('github.confirmMerge', { method: t(`github.${confirmation.action}`), number: entry.id })}</Text>
        <Text style={s.muted}>{t('github.headCommit', { sha: confirmation.sha.slice(0, 7) })}</Text>
        <View style={s.row}>
          <GithubButton label={t('github.confirmMergeAction')} disabled={disabled || !canMerge || !allowed[confirmation.action] || confirmation.sha !== entry.pull?.headSha}
            onPress={() => { onAction(confirmation.action, confirmation.sha); setConfirmation(null); }} />
          <GithubButton label={t('common.cancel')} disabled={disabled} onPress={() => setConfirmation(null)} />
        </View>
      </View>}
    </>}
    {entry.state !== 'merged' && <GithubButton label={t(open ? 'github.closePull' : 'github.reopenPull')} disabled={disabled}
      onPress={() => onAction(open ? 'closePull' : 'reopenPull')} />}
  </View>;
}
