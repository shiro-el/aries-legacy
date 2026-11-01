import type { RuntimeGithubRepository } from 'react-native-whip-ssh';
import type { RemoteGitConnection } from '../../services/remoteGitQueries';

export type GithubSection = 'issues' | 'pullRequests';
export interface GithubRequest {
  connection: RemoteGitConnection;
  repository: RuntimeGithubRepository;
  active: boolean;
}
