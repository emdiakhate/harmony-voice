# Guide de test — Vocaleez

Parcours de test **étape par étape avec le résultat attendu**, du premier clone jusqu'aux fonctions avancées. Utilisable comme checklist par un nouvel utilisateur ou un contributeur.

> Rappels : en développement le frontend est sur **http://localhost:8080** (Vite) et l'API sur **3001** ; avec `npm start` (mono-port) tout est sur **http://localhost:3001**. Voir le [README](./README.md) pour les prérequis.

---

## Parcours 0 — Installation à froid (le nouvel utilisateur) ⭐

Le test le plus important : « est-ce qu'un inconnu peut lancer le projet ? ». À faire idéalement sur une machine/VM vierge.

1. **Prérequis système** — installer au préalable : Node 18+ (20 conseillé), **ffmpeg**, **yt-dlp** (si test YouTube), git.
   - Vérifier : `node -v`, `ffmpeg -version`, `yt-dlp --version` répondent.
2. **Cloner** : `git clone https://github.com/emdiakhate/harmony-voice.git && cd harmony-voice`
   - *Attendu :* le dossier contient `README.md`, `LICENSE`, `package.json` (name `vocaleez`).
3. **Installer** : `npm install`
   - *Attendu :* installation OK, `postinstall` génère le client Prisma sans erreur.
4. **(Optionnel) TTS local gratuit** : `npm run setup:piper` (ou `npm run setup:piper:win` sous Windows)
   - *Attendu :* binaire + voix téléchargés dans `server/piper/`.
5. **(Optionnel) Clés API** : `cp .env.example .env` puis renseigner au moins une clé (sinon mode gratuit).
6. **Lancer** : `npm run dev`
   - *Attendu :* `predev` fait `prisma db push` (crée `prisma/dev.db`) ; la console affiche `[Preflight] Dépendances système : ffmpeg OK / yt-dlp OK` ; Vite ouvre **http://localhost:8080**.
7. **Ouvrir l'UI** → page d'accueil « Vocaleez ».
   - *Attendu :* si ffmpeg/yt-dlp manquent, **bandeau orange d'alerte** en haut ; sinon aucun bandeau.
8. **Test alternatif mono-port** : `Ctrl+C`, puis `npm start` → ouvrir **http://localhost:3001**.
   - *Attendu :* build + serveur unique, l'app fonctionne à l'identique.

---

## Parcours 1 — Traduction de texte → audio (le plus simple, sans clé)

Valide le cœur (traduction gratuite + TTS local) sans dépendre de YouTube ni d'upload.

1. Onglet **Texte** → coller un paragraphe en anglais.
2. Langue source **Détection auto** → langue cible **Français**.
3. Cliquer **Générer l'audio**.
   - *Attendu :* étapes SSE défilent (Détection langue → Traduction → Génération de l'audio) ; sans clé, la traduction passe par Pollinations/LLM7, le TTS par Piper/Edge.
4. Le lecteur audio apparaît → **Play**.
   - *Attendu :* audio en français audible, contrôles vitesse/volume fonctionnels ; le texte traduit s'affiche.
5. **Télécharger l'audio (.mp3)**.
   - *Attendu :* fichier .mp3 valide qui se lit hors de l'app.

---

## Parcours 2 — Fichier média (audio/vidéo) → transcription + traduction + TTS

1. Onglet **Fichier** → glisser un `.mp3` ou `.mp4` court (< 5 min).
2. Mode **Les deux** (transcrire + traduire), langue cible **Français**.
3. **Générer l'audio**.
   - *Attendu :* Transcription Whisper (nécessite clé **Groq** ou **OpenAI**) → Traduction → Audio. Transcription ET traduction affichées.
4. Vérifier les 3 sorties : texte original, texte traduit, audio jouable.

> ⚠️ Point de test clé : **sans clé Groq/OpenAI**, la transcription doit échouer avec un message explicite (pas de tier gratuit pour Whisper). C'est le comportement attendu.

---

## Parcours 3 — Document (PDF / DOCX / TXT)

1. Onglet **Fichier** → déposer un **PDF de 30+ pages**.
   - *Attendu :* découpage auto en parties (12 pages/chunk), toast « PDF découpé… ».
2. **Générer l'audio** → traitement en **file d'attente** (un fichier après l'autre).
   - *Attendu :* barre de progression de queue ; bouton « Fichier suivant » entre les parties.
3. À la fin, **Recomposer l'audio complet** (visible dès 2 parties générées).
   - *Attendu :* un seul .mp3 assemblé, vitesse/durée correctes.
4. Refaire avec un `.docx` puis un `.txt`.

---

## Parcours 4 — YouTube (nécessite yt-dlp)

1. Onglet **Lien YouTube** → coller une URL de vidéo courte.
   - *Attendu :* aperçu vidéo (iframe).
2. Langue cible **Français** → **Générer l'audio**.
   - *Attendu :* Extraction audio (yt-dlp) → Transcription → Traduction → TTS.
3. *(Si yt-dlp absent)* → le bandeau d'alerte doit déjà prévenir, et l'étape échoue proprement.

---

## Parcours 5 — Podcast multi-voix

1. N'importe quel mode d'entrée avec du texte suffisant → activer le **mode Podcast** (2/3/4 voix).
2. Choisir un ton (**Formel / Décontracté / Humoristique**).
3. **Générer le podcast**.
   - *Attendu :* génération du **script** (LLM) puis **audio multi-voix** (Gemini > ElevenLabs > OpenAI). Le script s'affiche, l'audio alterne les voix.

---

## Parcours 6 — Génération de couverture (audiobook)

1. Après avoir généré un audio → **Générer une couverture**.
2. Remplir **Titre** (requis), Auteur, Sous-titre, choisir un **Style**.
3. *(Optionnel)* joindre une image de référence → **Générer la couverture**.
   - *Attendu :* image générée (OpenRouter nano-banana, repli **Pollinations gratuit**) ; prévisualisation ; couverture affichée dans le lecteur.

---

## Parcours 7 — Fusion vidéo traduite

1. Depuis un traitement **YouTube** (ou vidéo locale uploadée) avec audio traduit → **Télécharger la vidéo traduite (.mp4)**.
   - *Attendu :* ffmpeg fusionne vidéo + audio traduit (avec offset de parole) ; MP4 téléchargeable et synchronisé.

---

## Parcours 8 — Combiner des audios

1. Onglet **Combiner Audios** → déposer 2+ fichiers audio.
2. Réordonner par glisser-déposer ; régler vitesse / normalisation / silence entre pistes.
3. **Fusionner** → **Télécharger l'audio combiné**.
   - *Attendu :* un seul fichier propre (ré-échantillonné 44,1 kHz), ordre respecté.

---

## Parcours 9 — Bibliothèque & playlists

1. Après un traitement → **Enregistrer** dans la bibliothèque (titre auto).
2. Créer une **playlist**, y **ajouter** la vidéo, la retirer, la supprimer.
3. Page **/playlists** → vérifier lecture audio au survol, durée totale, suppression avec confirmation.

---

## Parcours 10 — Configuration des clés (optionnel)

1. Page **/settings** → choisir un fournisseur → coller une clé → **Tester**.
   - *Attendu :* retour valide/invalide ; la clé est **chiffrée côté serveur** (AES-256-GCM), jamais réaffichée en clair (seulement masquée).
2. Réordonner les priorités par tâche (transcription / traduction / TTS) par glisser-déposer.
   - *Attendu :* l'ordre est respecté au prochain traitement, avec bascule automatique si quota atteint.

---

## Parcours 11 — Robustesse / cas limites

- **Deps manquantes** : lancer sans ffmpeg → bandeau d'alerte + `GET /api/health` renvoie `ffmpeg:false`.
- **Fichier trop gros** : déposer un fichier > 200 Mo → **toast d'erreur immédiat** (bloqué côté client, pas d'upload).
- **Interruption** : lancer un long traitement, couper le backend (`Ctrl+C`) en plein stream → message « Connexion interrompue » + bandeau **« Reprendre la génération audio »** ; relancer le backend, cliquer Reprendre → reprise sans réimport.
- **Entrées invalides** : découpage PDF avec valeur non numérique / résumé sans texte → réponses **400** propres.
- **Persistance** : recharger la page en cours de travail → toast « Session précédente restaurée » (les sessions de plus de 7 jours sont purgées automatiquement).

---

## Vérifications développeur (avant une PR)

```sh
npm run lint     # ESLint (0 erreur attendu)
npm run test     # Vitest
npm run build    # build de production
```

Ces mêmes vérifications tournent en intégration continue (`.github/workflows/ci.yml`).
