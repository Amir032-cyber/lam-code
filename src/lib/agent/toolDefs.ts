import { tool } from 'ai';
import { z } from 'zod';

export const readFileInput = z.object({
  path: z.string().min(1).describe('Chemin relatif à la racine du projet'),
});
export const writeFileInput = z.object({
  path: z.string().min(1).describe('Chemin relatif à la racine du projet'),
  content: z.string().describe('Contenu complet du fichier'),
});
export const listFilesInput = z.object({
  path: z.string().optional().describe('Dossier à lister (racine par défaut)'),
});
export const runCommandInput = z.object({
  cmd: z.string().min(1).describe('Commande shell à exécuter'),
  cwd: z.string().optional().describe('Sous-dossier du projet où exécuter la commande'),
});
export const askUserInput = z.object({
  question: z.string().min(1),
  options: z.array(z.string()).optional().describe('Réponses proposées (facultatif)'),
});
export const requestFileUploadInput = z.object({
  reason: z.string().min(1).describe('Pourquoi ce fichier est nécessaire'),
});

/**
 * Outils déclarés sans `execute` : le serveur renvoie l'appel, le client l'exécute
 * (après approbation pour write_file / run_command) puis renvoie le résultat au modèle.
 */
export const agentTools = {
  read_file: tool({
    description:
      'Lit un fichier du projet. Retourne le texte, ou les métadonnées et le texte extrait (PDF/image) pour un binaire.',
    inputSchema: readFileInput,
  }),
  write_file: tool({
    description:
      'Crée ou remplace un fichier (contenu complet). Crée les dossiers parents. Nécessite une approbation.',
    inputSchema: writeFileInput,
  }),
  list_files: tool({
    description: 'Affiche l’arborescence du projet (profondeur max 4).',
    inputSchema: listFilesInput,
  }),
  run_command: tool({
    description:
      'Exécute une commande dans le terminal du projet. Retourne { exitCode, stdout, stderr, durationMs }. Nécessite une approbation.',
    inputSchema: runCommandInput,
  }),
  ask_user: tool({
    description:
      'Pose une question à l’utilisateur et suspend le travail jusqu’à sa réponse (info manquante, choix ambigu, action risquée).',
    inputSchema: askUserInput,
  }),
  request_file_upload: tool({
    description: 'Demande à l’utilisateur de déposer un fichier (ouvre la zone de dépôt).',
    inputSchema: requestFileUploadInput,
  }),
};

export type AgentToolName = keyof typeof agentTools;
export const TOOL_NAMES = Object.keys(agentTools) as AgentToolName[];
export const APPROVAL_TOOLS: AgentToolName[] = ['write_file', 'run_command'];
export const AUTO_TOOLS: AgentToolName[] = ['read_file', 'list_files'];

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}
