import {
  AudioModule,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
} from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';

import { reportBackgroundFailure } from './backgroundOperations';
import { operationalErrorDetails, recordOperationalDiagnostic } from './operationalDiagnostics';
import { setSpeechInputActive } from './speechInputFocus';
import { loadGroqApiKey } from './groqApiKey';
import { transcribeWithGroq } from './groqTranscription';
import { VoiceInput, type MicrophonePermission, type VoiceRecorder } from './voiceInput';

const FILE_PREFIX = 'voice-input-';

/** expo-audio writes Android recordings to `<cache>/Audio/<fileName>.m4a`. */
function recordingDirectory(): Directory {
  return new Directory(Paths.cache, 'Audio');
}

/** Whisper resamples to 16 kHz mono, so recording more would only add bytes. */
function recordingOptions(fileName: string) {
  return {
    extension: '.m4a',
    sampleRate: 16_000,
    numberOfChannels: 1,
    bitRate: 64_000,
    isMeteringEnabled: true,
    directory: 'cache' as const,
    fileName,
    outputFormat: 'mpeg4' as const,
    audioEncoder: 'aac' as const,
  };
}

class ExpoVoiceRecorder implements VoiceRecorder {
  private recorder: AudioRecorder | null = null;

  async requestPermission(): Promise<MicrophonePermission> {
    const result = await requestRecordingPermissionsAsync();
    if (result.granted) return 'granted';
    return result.canAskAgain ? 'denied' : 'blocked';
  }

  async start(): Promise<void> {
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    const recorder = new AudioModule.AudioRecorder(recordingOptions(`${FILE_PREFIX}${Date.now()}`));
    this.recorder = recorder;
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (error) {
      this.recorder = null;
      recorder.release();
      await setAudioModeAsync({ allowsRecording: false });
      throw error;
    }
  }

  async stop(): Promise<string | null> {
    const recorder = this.recorder;
    this.recorder = null;
    if (!recorder) return null;
    try {
      await recorder.stop();
      return recorder.uri;
    } finally {
      recorder.release();
      await setAudioModeAsync({ allowsRecording: false });
    }
  }

  level(): number | null {
    return this.recorder?.getStatus().metering ?? null;
  }
}

function deleteRecording(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (error) {
    recordOperationalDiagnostic('error', 'Application', 'voice-input-delete-failed', operationalErrorDetails(error));
  }
}

let cleaned = false;

/** A retained recording does not outlive the process that recorded it. */
function cleanUpOldRecordings(): void {
  if (cleaned) return;
  cleaned = true;
  try {
    const directory = recordingDirectory();
    if (!directory.exists) return;
    for (const entry of directory.list()) {
      if (entry instanceof File && entry.name.startsWith(FILE_PREFIX)) entry.delete();
    }
  } catch (error) {
    recordOperationalDiagnostic('error', 'Application', 'voice-input-cleanup-failed', operationalErrorDetails(error));
  }
}

export function createVoiceInput(): VoiceInput {
  cleanUpOldRecordings();
  return new VoiceInput({
    recorder: new ExpoVoiceRecorder(),
    loadKey: loadGroqApiKey,
    transcribe: request => transcribeWithGroq(request),
    deleteFile: deleteRecording,
    haptic: () => reportBackgroundFailure(
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
      'voice-input-haptic',
    ),
    microphone: async active => {
      if (!active) {
        setSpeechInputActive(false);
        return;
      }
      // Loaded on demand so the composer does not pull in read-aloud's native queue.
      const { suspendChatSpeechForInput } = await import('./chatSpeech');
      await suspendChatSpeechForInput();
    },
  });
}
