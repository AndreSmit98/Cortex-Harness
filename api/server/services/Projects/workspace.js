const { realpath, stat } = require('fs/promises');
const { isAbsolute } = require('path');
const { ProjectWorkspaceError } = require('@librechat/api');

function isProjectWorkspaceEnabled() {
  return process.env.LOCAL_PROJECT_WORKSPACES === 'true';
}

async function resolveProjectWorkspacePath(workspacePath) {
  if (!isAbsolute(workspacePath)) {
    throw new ProjectWorkspaceError('workspacePath must be an absolute path');
  }

  try {
    const resolvedPath = await realpath(workspacePath);
    const details = await stat(resolvedPath);
    if (!details.isDirectory()) {
      throw new ProjectWorkspaceError('workspacePath must point to a directory');
    }
    return resolvedPath;
  } catch (error) {
    if (error instanceof ProjectWorkspaceError) {
      throw error;
    }
    throw new ProjectWorkspaceError('workspacePath must point to an accessible directory');
  }
}

async function getProjectWorkspacePath(userId, projectId, getChatProject) {
  if (!isProjectWorkspaceEnabled() || !userId || !projectId) {
    return undefined;
  }
  const project = await getChatProject(userId, projectId);
  return project?.workspacePath || undefined;
}

module.exports = {
  getProjectWorkspacePath,
  isProjectWorkspaceEnabled,
  resolveProjectWorkspacePath,
};
