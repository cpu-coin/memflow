/**
 * Interface for discovering MemFlow tracking candidates via GitHub.
 * Allows MemFlow to automatically seed local tracking for teams by scanning
 * accessible repositories and organization team structures.
 */
export interface MemFlowGitHubBootstrapConnector {
  /**
   * Authenticates the bootstrap connector via OAuth or PAT
   */
  authenticate(token: string): Promise<boolean>;

  /**
   * Discovers repositories that contain MemFlow memory scopes (.memflow directories)
   */
  discoverRepositories(orgId?: string): Promise<{
    name: string;
    repo: string;
    url: string;
    defaultBranch: string;
  }[]>;

  /**
   * Syncs organization members into local persona definitions
   */
  importTeamProfiles(orgId: string, teamId: string): Promise<{
    userId: string;
    login: string;
    role: "admin" | "member";
  }[]>;
}
