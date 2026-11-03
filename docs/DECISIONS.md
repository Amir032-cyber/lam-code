# Décisions d'architecture (journal)

Chaque décision ambiguë prise pendant le développement est notée ici (cahier des charges, section 16).

## D1 — Node.js 22 LTS au lieu de Node 20
`ai@7`, `@ai-sdk/*@4` et `@supabase/supabase-js@2.118` déclarent `engines.node >= 22`, et Node 20 n'est plus
maintenu. Les workflows et le README utilisent donc Node 22 LTS.

## D2 — Versions épinglées
React reste en 18.3.1 (imposé). Vite 7.3 (dernière version mature compatible avec `@vitejs/plugin-react@5`),
TypeScript 5.9, Tailwind CSS 3.4 (le cahier des charges impose `tailwind.config.ts`), Capacitor 6.2 (imposé),
Tauri 2.12, AI SDK 7.
