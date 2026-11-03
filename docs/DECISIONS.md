# Décisions d'architecture (journal)

Chaque décision ambiguë prise pendant le développement est notée ici (cahier des charges, section 16).

## D1 — Node.js 22 LTS au lieu de Node 20
`ai@7`, `@ai-sdk/*@4` et `@supabase/supabase-js@2.118` déclarent `engines.node >= 22`, et Node 20 n'est plus
maintenu. Les workflows et le README utilisent donc Node 22 LTS.

## D2 — Versions épinglées
React reste en 18.3.1 (imposé). Vite 7.3 (dernière version mature compatible avec `@vitejs/plugin-react@5`),
TypeScript 5.9, Tailwind CSS 3.4 (le cahier des charges impose `tailwind.config.ts`), Capacitor 6.2 (imposé),
Tauri 2.12, AI SDK 7.

## D3 — OpenRouter en plus de Groq et Gemini
Demande explicite du propriétaire du projet. OpenRouter passe par `@openrouter/ai-sdk-provider` ; aucune clé
n'est commitée : clé serveur `OPENROUTER_API_KEY` (Vercel) ou clé utilisateur saisie dans Réglages.

## D4 — Outils déclarés sans `execute` côté serveur
`api/chat.ts` ne fait que relayer le modèle : les appels d'outils sont exécutés par le client (VFS, WebContainer,
PowerShell via Tauri, sandbox distant) après approbation. Le serveur n'a donc jamais accès aux fichiers.

## D5 — Taille maximale d'une requête : 4 Mo
Les conversations contiennent les résultats d'outils (jusqu'à 20 000 caractères chacun) et les images jointes.
Le client tronque l'historique (`trimMessages`) pour rester sous 4 Mo, limite de corps des fonctions Vercel (4,5 Mo).

## D6 — Monaco servi localement
Monaco est importé depuis `monaco-editor` (workers Vite) au lieu du CDN : fonctionne hors ligne et avec
`Cross-Origin-Embedder-Policy: require-corp`. Contrepartie : un bundle de ~4 Mo (1 Mo gzip), chargé en différé.
Le build Vite utilise `--max-old-space-size=4096` pour éviter un manque de mémoire sur les petites machines.

## D7 — Mot « placeholder » dans le code
La vérification `grep -rniE "TODO|FIXME|placeholder"` remonte uniquement l'attribut HTML `placeholder=` des champs
de saisie et la clé i18n `placeholderPrompt` : ce sont des textes d'aide d'interface, pas du code inachevé.
Le workflow Web échoue sur tout `TODO` ou `FIXME`.

## D8 — Synchronisation Supabase
Projets et conversation sont envoyés 4 s après la dernière modification (dernier écrit gagne, par `updated_at`).
Les snapshots sont des archives zip dans un bucket privé `snapshots` (un dossier par utilisateur, RLS).
Les clés API ne quittent jamais l'appareil.

## D9 — Liste noire en double (TypeScript + Rust)
La politique de commandes est appliquée dans le client (`src/lib/agent/policy.ts`) et, sur Windows, une seconde
fois dans `src-tauri/src/policy.rs`, pour qu'un frontend compromis ne puisse pas la contourner.

## D10 — Android sans shell local
Android n'a pas de shell utilisable : `run_command` passe par un sandbox distant configurable (`POST /exec`)
ou renvoie une erreur explicite que l'agent explique à l'utilisateur.

## D11 — `tauri-action` sans `.msi`
Seul l'installeur NSIS est produit (installation par utilisateur, sans droits administrateur).
