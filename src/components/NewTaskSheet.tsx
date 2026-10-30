import { Layers3 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TabLaunchIntent } from '../lib/herdrCreationFlows';
import type { HerdrClient } from '../services/HerdrClient';
import { reportBackgroundFailure } from '../services/backgroundOperations';
import {
  loadNewTaskPreferences,
  rememberNewTask,
  type NewTaskAgent,
  type NewTaskChoice,
} from '../services/newTaskPreferences';
import type { WorkspaceInfo } from '../types';
import {
  ResourceEditorField,
  ResourceEditorSheet,
} from './ResourceEditorSheet';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Text } from './ui/text';

const defaults: Record<NewTaskAgent, NewTaskChoice> = {
  claude: { model: '', effort: 'high' },
  codex: { model: '', effort: 'high' },
};
const models: Record<NewTaskAgent, string[]> = {
  claude: ['sonnet', 'opus', 'haiku'],
  codex: ['gpt-5.4', 'gpt-5.3-codex'],
};
const efforts: Record<NewTaskAgent, string[]> = {
  claude: ['low', 'medium', 'high', 'max'],
  codex: ['minimal', 'low', 'medium', 'high', 'xhigh'],
};

interface Props {
  hostId: string;
  hostLabel: string;
  folders: string[];
  client?: HerdrClient;
  onClose: () => void;
  onCreate: (
    name: string,
    cwd: string,
    launch: TabLaunchIntent,
  ) => Promise<WorkspaceInfo>;
  onCreated: (workspace: WorkspaceInfo) => void;
}

export function NewTaskSheet({
  hostId,
  hostLabel,
  folders,
  client,
  onClose,
  onCreate,
  onCreated,
}: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [cwd, setCwd] = useState('');
  const [name, setName] = useState('');
  const nameEdited = useRef(false);
  const [kind, setKind] = useState<NewTaskAgent | 'shell'>('claude');
  const [choices, setChoices] = useState(defaults);
  const choiceEdited = useRef(new Set<NewTaskAgent>());
  const [recent, setRecent] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [browsePath, setBrowsePath] = useState('~');

  useEffect(() => {
    let current = true;
    loadNewTaskPreferences(hostId)
      .then(value => {
        if (!current) return;
        setRecent(value.folders);
        setChoices(previous => ({
          claude: choiceEdited.current.has('claude')
            ? previous.claude
            : (value.agents.claude ?? defaults.claude),
          codex: choiceEdited.current.has('codex')
            ? previous.codex
            : (value.agents.codex ?? defaults.codex),
        }));
      })
      .catch(reason => {
        if (current) setError(String(reason));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [hostId]);

  const chooseFolder = (path: string) => {
    setCwd(path);
    if (!nameEdited.current)
      setName(path.trim().replace(/\/+$/, '').split('/').pop() || '/');
  };
  const updateChoice = (field: keyof NewTaskChoice, value: string) => {
    if (kind === 'shell') return;
    choiceEdited.current.add(kind);
    setChoices(previous => ({
      ...previous,
      [kind]: { ...previous[kind], [field]: value },
    }));
  };
  const save = async () => {
    if (inFlight.current || loading) return;
    if (!cwd.trim()) {
      setError(t('newTask.folderRequired'));
      return;
    }
    if (step === 0 || (step === 1 && kind !== 'shell')) {
      setError('');
      setStep(step + 1);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const choice = kind === 'shell' ? undefined : choices[kind];
      const model = choice?.model.trim();
      const launch: TabLaunchIntent =
        kind === 'shell'
          ? { type: 'shell' }
          : {
              type: 'agent',
              kind,
              args:
                kind === 'claude'
                  ? [
                      ...(model ? ['--model', model] : []),
                      '--effort',
                      choices.claude.effort,
                    ]
                  : [
                      ...(model ? ['-m', model] : []),
                      '-c',
                      `model_reasoning_effort=${choices.codex.effort}`,
                    ],
            };
      const workspace = await onCreate(name.trim(), cwd.trim(), launch);
      // Persistence cannot turn a successful creation into a retry that duplicates it.
      reportBackgroundFailure(
        rememberNewTask(
          hostId,
          cwd.trim(),
          kind === 'shell' ? undefined : kind,
          choice,
        ),
        'new-task-preferences',
      );
      onCreated(workspace);
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  // Load the existing file manager only when browsing is requested.
  const FileManager =
    browsing && client
      ? (require('./RemoteFileManager') as typeof import('./RemoteFileManager'))
          .RemoteFileManager
      : null;
  const finalStep = step === 2 || (step === 1 && kind === 'shell');
  return (
    <>
      <ResourceEditorSheet
        busy={busy || loading}
        context={hostLabel}
        icon={Layers3}
        onClose={onClose}
        onSave={save}
        saveLabel={t(finalStep ? 'newTask.create' : 'newTask.next')}
        title={t('newTask.title')}
        visible={!browsing}
      >
        <ScrollView
          style={{ maxHeight: 380 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-3">
            <Text>
              {t(
                step === 0
                  ? 'newTask.folder'
                  : step === 1
                    ? 'newTask.kind'
                    : 'newTask.configuration',
              )}
            </Text>
            {step === 0 ? (
              <>
                {[...new Set([...folders, ...recent])].map(path => (
                  <Button
                    key={path}
                    accessibilityLabel={path}
                    variant={cwd === path ? 'default' : 'secondary'}
                    onPress={() => chooseFolder(path)}
                  >
                    <Text numberOfLines={1}>{path}</Text>
                  </Button>
                ))}
                <Button
                  accessibilityLabel={t('newTask.browse')}
                  variant="secondary"
                  disabled={!client}
                  onPress={() => {
                    setBrowsePath(cwd || '~');
                    setBrowsing(true);
                  }}
                >
                  <Text>{t('newTask.browse')}</Text>
                </Button>
                <ResourceEditorField label={t('newTask.folder')}>
                  <Input
                    accessibilityLabel={t('newTask.folder')}
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={cwd}
                    onChangeText={chooseFolder}
                    placeholder="~/project"
                    editable={!busy}
                  />
                </ResourceEditorField>
                <ResourceEditorField label={t('herd.labelOptional')}>
                  <Input
                    accessibilityLabel={t('herd.labelOptional')}
                    value={name}
                    editable={!busy}
                    onChangeText={value => {
                      nameEdited.current = true;
                      setName(value);
                    }}
                  />
                </ResourceEditorField>
              </>
            ) : step === 1 ? (
              <>
                {(['claude', 'codex', 'shell'] as const).map(value => {
                  const label =
                    value === 'claude'
                      ? 'Claude Code'
                      : value === 'codex'
                        ? 'Codex'
                        : t('newTask.shell');
                  return (
                    <Button
                      key={value}
                      accessibilityLabel={label}
                      variant={kind === value ? 'default' : 'secondary'}
                      onPress={() => setKind(value)}
                    >
                      <Text>{label}</Text>
                    </Button>
                  );
                })}
              </>
            ) : kind !== 'shell' ? (
              <>
                <Text>{t('newTask.model')}</Text>
                {['', ...models[kind]].map(model => (
                  <Button
                    key={model}
                    disabled={busy}
                    accessibilityLabel={model || t('newTask.defaultModel')}
                    variant={
                      choices[kind].model === model ? 'default' : 'secondary'
                    }
                    onPress={() => updateChoice('model', model)}
                  >
                    <Text>{model || t('newTask.defaultModel')}</Text>
                  </Button>
                ))}
                <Input
                  accessibilityLabel={t('newTask.model')}
                  value={choices[kind].model}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={t('newTask.customModel')}
                  onChangeText={value => updateChoice('model', value)}
                  editable={!busy}
                />
                <Text>{t('newTask.effort')}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {efforts[kind].map(effort => (
                    <Button
                      key={effort}
                      disabled={busy}
                      accessibilityLabel={effort}
                      variant={
                        choices[kind].effort === effort
                          ? 'default'
                          : 'secondary'
                      }
                      onPress={() => updateChoice('effort', effort)}
                    >
                      <Text>{effort}</Text>
                    </Button>
                  ))}
                </View>
              </>
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" className="text-destructive">
                {error}
              </Text>
            ) : null}
            {step > 0 ? (
              <Button
                accessibilityLabel={t('newTask.back')}
                disabled={busy}
                variant="ghost"
                onPress={() => setStep(step - 1)}
              >
                <Text>{t('newTask.back')}</Text>
              </Button>
            ) : null}
          </View>
        </ScrollView>
      </ResourceEditorSheet>
      {FileManager && client ? (
        <FileManager
          visible
          client={client}
          hostId={hostId}
          initialPath={browsePath}
          onPathChange={() => undefined}
          onClose={() => setBrowsing(false)}
          onSelectDirectory={path => {
            chooseFolder(path);
            setBrowsing(false);
          }}
        />
      ) : null}
    </>
  );
}
