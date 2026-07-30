# Contribuer à Vocaleez

Merci de votre intérêt ! Ce projet est un outil **local, mono-utilisateur et open-source**. Les contributions (bugs, fonctionnalités, docs) sont les bienvenues.

## Mise en route

```sh
git clone <votre-fork>
cd vocaleez-ai
npm install
npm run setup:piper   # optionnel (TTS local gratuit)
npm run dev
```

Voir le [README](./README.md) pour les prérequis système (Node 18+, `ffmpeg`, `yt-dlp`).

## Structure du projet

| Dossier | Rôle |
|---|---|
| `src/` | Frontend React + Vite (pages, composants, hooks) |
| `server/` | API Express (point d'entrée `server/index.ts`) |
| `server/services/` | Logique métier (transcription, traduction, TTS, podcast, YouTube…) |
| `server/services/llm/` | Routage multi-clés (providers, router, ledger, keystore) |
| `server/lib/` | Utilitaires serveur (crypto, auth, prisma, preflight) |
| `prisma/` | Schéma et base SQLite |

## Avant d'ouvrir une Pull Request

Assurez-vous que ces commandes passent :

```sh
npm run lint     # ESLint
npm run test     # Vitest
npm run build    # build de production
```

Ces mêmes vérifications sont exécutées par l'intégration continue (voir `.github/workflows/ci.yml`).

## Conventions

- **TypeScript** partout, en respectant le style existant du fichier modifié.
- Commits clairs et atomiques (format [Conventional Commits](https://www.conventionalcommits.org/) apprécié : `feat:`, `fix:`, `docs:`, `chore:`…).
- Une PR = un sujet. Décrivez le *pourquoi* autant que le *quoi*.

## Sécurité & secrets

- **Ne committez jamais** de fichier `.env`, de clé API ou le fichier `.encryption-key`. Ils sont ignorés par git — gardez-les locaux.
- Utilisez `.env.example` comme unique référence des variables.
- Pour signaler une faille de sécurité, ouvrez une issue sans y inclure de secret.

## Code de conduite

Ce projet suit le [Code de conduite](./CODE_OF_CONDUCT.md). En participant, vous vous engagez à le respecter.
