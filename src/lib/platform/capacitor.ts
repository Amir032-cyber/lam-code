import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import type { ProjectMeta } from '../fs/persist';
import { makeFile, type ProjectFiles, type VFile } from '../fs/vfs';
import { isBinaryPath } from '../fs/paths';
import { RemoteSandbox } from '../sandbox/remote';
import { loadSettings } from '../settings';
import type { FileSystemAdapter, PlatformAdapter, SecretStore } from './types';

const root = (project: ProjectMeta) => `lamcode/${project.id}`;

/** Fichiers stockés dans le dossier privé de l'application (Directory.Data). */
class CapacitorFs implements FileSystemAdapter {
  async loadProject(project: ProjectMeta): Promise<ProjectFiles> {
    const files: VFile[] = [];
    const dirs: string[] = [];
    const walk = async (rel: string) => {
      const listing = await Filesystem.readdir({ directory: Directory.Data, path: rel ? `${root(project)}/${rel}` : root(project) });
      for (const entry of listing.files) {
        const path = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.type === 'directory') {
          dirs.push(path);
          await walk(path);
          continue;
        }
        const binary = isBinaryPath(path);
        const result = await Filesystem.readFile({
          directory: Directory.Data,
          path: `${root(project)}/${path}`,
          ...(binary ? {} : { encoding: Encoding.UTF8 }),
        });
        const data = typeof result.data === 'string' ? result.data : await result.data.text();
        files.push(makeFile(path, data, binary ? 'base64' : 'utf8'));
      }
    };
    try {
      await walk('');
    } catch {
      await Filesystem.mkdir({ directory: Directory.Data, path: root(project), recursive: true });
    }
    return { files, dirs };
  }

  async saveProject(project: ProjectMeta, data: ProjectFiles) {
    for (const dir of data.dirs) await this.mkdir(project, dir);
    for (const file of data.files) await this.writeFile(project, file);
  }

  async writeFile(project: ProjectMeta, file: VFile) {
    await Filesystem.writeFile({
      directory: Directory.Data,
      path: `${root(project)}/${file.path}`,
      data: file.content,
      recursive: true,
      ...(file.encoding === 'utf8' ? { encoding: Encoding.UTF8 } : {}),
    });
  }

  async remove(project: ProjectMeta, path: string) {
    const full = `${root(project)}/${path}`;
    const stat = await Filesystem.stat({ directory: Directory.Data, path: full });
    if (stat.type === 'directory') await Filesystem.rmdir({ directory: Directory.Data, path: full, recursive: true });
    else await Filesystem.deleteFile({ directory: Directory.Data, path: full });
  }

  async rename(project: ProjectMeta, from: string, to: string) {
    await Filesystem.rename({
      directory: Directory.Data,
      toDirectory: Directory.Data,
      from: `${root(project)}/${from}`,
      to: `${root(project)}/${to}`,
    });
  }

  async mkdir(project: ProjectMeta, path: string) {
    try {
      await Filesystem.mkdir({ directory: Directory.Data, path: `${root(project)}/${path}`, recursive: true });
    } catch (error) {
      if (!String(error).toLowerCase().includes('exist')) throw error;
    }
  }
}

/** Android Keystore via @aparajita/capacitor-secure-storage. */
class AndroidSecrets implements SecretStore {
  description = 'Android Keystore (stockage sécurisé)';
  async get(name: string) {
    const value = await SecureStorage.getItem(`lam_${name}`);
    return value ?? null;
  }
  set(name: string, value: string) {
    return SecureStorage.setItem(`lam_${name}`, value);
  }
  remove(name: string) {
    return SecureStorage.removeItem(`lam_${name}`);
  }
}

export function createCapacitorPlatform(): PlatformAdapter {
  const secrets = new AndroidSecrets();
  return {
    id: 'mobile',
    label: 'Android',
    badge: 'Cloud Sandbox',
    fs: new CapacitorFs(),
    secrets,
    getExec() {
      const url = loadSettings().sandboxUrl.trim();
      if (!url) return null;
      return new RemoteSandbox(url, () => secrets.get('sandbox'));
    },
    execUnavailableReason() {
      return 'Android n’a pas de shell local. Configurez un sandbox distant dans Réglages, ou exécutez le code sur un ordinateur.';
    },
  };
}
