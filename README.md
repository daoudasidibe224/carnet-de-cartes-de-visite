# Carnet de cartes de visite

Créez vos cartes de visite, découvrez celles des autres membres et gardez les contacts utiles dans votre bibliothèque. Chaque carte contient un nom, une entreprise facultative, un email et un téléphone facultatif. L’export `.vcf` permet de l’importer dans un carnet de contacts compatible vCard 3.0.

## Fonctionnalités

- Inscription avec email et mot de passe, nom facultatif, visibilité du mot de passe et déconnexion qui révoque la session.
- Création de plusieurs cartes, modification et suppression par leur propriétaire, sans doublon sur un double envoi.
- Annuaire accessible aux membres connectés, recherche par nom, entreprise ou email et pagination de 12 cartes.
- Bibliothèque personnelle, ajout sans doublon et retrait d’une carte.
- Notes personnelles, jusqu’à 8 étiquettes par contact et favoris privés.
- Recherche dans les notes et étiquettes, filtres par étiquette et favoris dans la bibliothèque.
- Export JSON de toute la bibliothèque avec les coordonnées et vos annotations privées.
- Export vCard des cartes visibles, avec échappement des séparateurs et retours à la ligne.
- Formulaires avec erreurs ciblées, navigation mobile et confirmation de suppression au clavier.

## Stack et architecture

Node.js 22.16 ou supérieur, TypeScript strict, Express 5, Pug 3 et MongoDB avec Mongoose 9. Le client natif TypeScript gère le menu et la confirmation de suppression ; esbuild produit son script. Zod valide les formulaires. Les modèles définissent les données, les contrôleurs gèrent les parcours HTTP et les services regroupent les opérations transactionnelles sur les cartes et bibliothèques.

Les mots de passe sont hachés avec bcrypt. Les sessions restent dans MongoDB avec `connect-mongo` ; la connexion renouvelle l’identifiant de session et la déconnexion la révoque. Les formulaires utilisent un jeton CSRF, les tentatives de connexion sont limitées et les cookies sont HTTP-only.

## Installation locale

Vous avez besoin de Node.js et de Docker avec Compose, ou d’un MongoDB compatible déjà configuré en replica set. Les [transactions MongoDB](https://www.mongodb.com/docs/manual/core/transactions/) de publication, de suppression et d’ajout à la bibliothèque nécessitent un replica set ; une seule instance locale suffit.

```sh
npm ci
docker compose up -d
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copiez la valeur générée dans `SECRET` : elle doit contenir au moins 32 caractères. L’URI locale fournie dans `.env.example` pointe vers la base `carnet` du replica set `rs0`. Compose stocke les données dans un volume local et initialise ce replica set par son contrôle de santé. Attendez que `docker compose ps` indique un service sain.

```sh
npm run build
npm start
```

Ouvrez [http://localhost:5000](http://localhost:5000), créez un compte et connectez-vous. Un second compte permet de tester l’annuaire et la bibliothèque. Les cartes du compte connecté figurent dans « Mes cartes » ; « Découvrir » affiche celles des autres membres.

Pour arrêter la base en conservant les données :

```sh
docker compose down
```

Si le port 27017 est déjà occupé, utilisez votre instance locale compatible ou adaptez le port Compose et `MONGODB_URI`. Aucune base distante, aucun secret et aucun compte prédéfini ne sont fournis.

## Scripts et vérifications

| Commande | Usage |
| --- | --- |
| `npm run dev` | Relancer le serveur et recompiler le client lors des modifications |
| `npm run build` | Compiler le serveur et le client |
| `npm start` | Démarrer le serveur compilé |
| `npm run lint` | Vérifier le code TypeScript |
| `npm run typecheck` | Vérifier les types stricts |
| `npm run test:e2e` | Vérifier les parcours desktop et mobile dans Chromium |
| `npm test` | Exécuter les tests HTTP et MongoDB |
| `npm run check` | Exécuter lint, types, compilation et tests |

`npm run dev` surveille le serveur et les sources du client. Les tests lancent un vrai replica set MongoDB temporaire via `mongodb-memory-server`. Le premier lancement télécharge le binaire et nécessite un accès réseau. Ils couvrent auth et CSRF, renouvellement et révocation des sessions, accès au profil, hachage, propriété des cartes, bibliothèque idempotente, nettoyage transactionnel, publication concurrente sans doublon, conflit d’édition et de notes, isolation des annotations privées, filtres, export JSON personnel, recherche littérale, pagination, export et persistance dans une nouvelle instance du serveur. La CI lance les mêmes contrôles et les parcours navigateur sous Node.js 22.

## Publication et modifications concurrentes

Chaque formulaire de création porte un identifiant propre. Le serveur enregistre cet identifiant et la carte dans la même transaction. Deux envois du même formulaire publient une seule carte ; réutiliser cet identifiant avec d’autres coordonnées est refusé. La suppression conserve la trace de création pour qu’un ancien envoi ne recrée pas la carte. Un nouveau formulaire permet de publier une nouvelle carte. Ces traces restent dans la collection `cardcreations`.

Les annotations personnelles portent aussi une version. Deux onglets ne peuvent pas écraser leurs notes sans conflit explicite ; la note déjà enregistrée reste consultable et la saisie est conservée. L’enregistrement, le retrait d’un contact et la suppression d’une carte se coordonnent par transaction. Retirer une carte efface également ses notes privées et ses étiquettes.

La modification porte la version de la carte chargée. Si un autre onglet l’a déjà modifiée, le serveur affiche un conflit au lieu d’écraser ses changements. Les coordonnées saisies restent visibles pour être vérifiées avant une nouvelle tentative. L’ajout en bibliothèque utilise un ensemble sans doublon, et sa transaction se coordonne avec la suppression de la carte. Annuler la confirmation de suppression n’envoie aucune demande.

## Interface et fontes

Le carnet adopte un répertoire éditorial : masthead, index de recherche, cartes rectangulaires et liens de coordonnées soulignés. Cormorant Garamond et Figtree sont servis localement, avec leurs licences SIL Open Font License dans `public/fonts/`. Les fichiers proviennent du [répertoire officiel Google Fonts](https://github.com/google/fonts).

## Données et limites

Les cartes publiées sont visibles par tous les membres connectés. Le profil du compte reste privé. Modifier le profil ne modifie pas automatiquement les cartes déjà publiées. Les cartes enregistrées dans une bibliothèque restent liées à leur carte d’origine : une modification est visible à la prochaine consultation ; une suppression les retire des bibliothèques dans la même transaction.

Les notes, les étiquettes et les favoris ne sont accessibles qu’au compte qui les a enregistrés. Leur recherche reste limitée à sa bibliothèque. L’export `mon-carnet.json` contient toutes ses cartes conservées, avec ses propres annotations ; il ne contient aucun identifiant interne ni annotation d’un autre membre. Ce fichier peut servir à une sauvegarde ou à un traitement externe ; l’import JSON n’est pas proposé.

Comptes, cartes, annotations privées, bibliothèques et sessions persistent dans MongoDB et survivent au redémarrage du serveur. Une erreur de base affiche une page d’erreur et ne valide pas l’opération. Le serveur refuse de démarrer si la configuration manque ou si la base est inaccessible. L’application ne propose pas de réinitialisation de mot de passe, de validation d’email ou d’import de fichier vCard.

L’ancienne configuration de cluster et le secret JWT fixe ne sont plus utilisés. Le dépôt attend une base configurée explicitement par `MONGODB_URI` ; il ne migre ni ne contacte automatiquement l’ancien cluster.

`PORT` vaut 5000 par défaut. En production, utilisez HTTPS et `NODE_ENV=production`. `TRUST_PROXY=1` convient uniquement à un proxy de confiance qui contrôle les connexions entrantes ; les cookies de production exigent HTTPS. Le fichier Compose sert au développement local, sans exposer MongoDB hors de la machine.

Les tests navigateur démarrent leur propre serveur et MongoDB locale temporaire. Avant leur premier lancement : `npx playwright install chromium`. Ils utilisent un port libre et écrivent les captures dans `test-results/`.
