# Mes finances — Personal Finance Manager

Application web de gestion financière personnelle : revenus, dépenses (fixes, variables, exceptionnelles), épargne, budgets, historique et rapports PDF.
100 % locale : aucune donnée ne quitte le navigateur. Hébergeable gratuitement sur GitHub Pages.

## État d'avancement

| Lot | Contenu | État |
|---|---|---|
| 1 | Socle : montants en centimes, dates, validation, base IndexedDB, catégories | ✅ |
| 2 | Interface : navigation responsive, sélecteur de mois, thème clair/sombre, modales, notifications, recherche globale | ✅ |
| 3 | Revenus et dépenses : ajout, modification, duplication, suppression avec annulation, recherche, filtres, tri, totaux par catégorie et par type | ✅ |
| 4 | Épargne : comptes multiples, versements, retraits, transferts, intérêts, objectifs, contrôle des soldes | ✅ |
| 5 | Dépenses et revenus récurrents : mensuel, tous les N mois, annuel, hebdomadaire ; rattrapage automatique sans doublon ; pause ; « Répéter tous les mois » | ✅ |
| 6 | Dashboard complet : graphiques revenus vs dépenses (6/12 mois), répartition par catégorie, épargne et patrimoine, comparaison avec le mois précédent, indicateur de tendance | ✅ |
| 7 | Budgets global et par catégorie (par défaut ou propres à un mois), alertes 80 % / 100 % / dépassement, prévu vs réel, estimation de fin de mois | ✅ |
| 8 | Historique (synthèse mensuelle sur période personnalisée, opérations filtrables, comparaison de deux mois, calendrier financier, analyse et pistes d'amélioration) et simulateur d'épargne | ✅ |
| 9 | Rapports PDF mensuel et annuel (synthèse, résumé rédigé, graphiques, tableaux, comparaison, budgets, épargne, annexe) | ✅ |
| 10 | Sauvegarde JSON (export, import vérifié avec fusion ou remplacement), réinitialisation confirmée, rappel de sauvegarde, application installable et hors ligne (PWA) | ✅ |
| 11 | Déploiement GitHub Pages | à venir |

## Lancer l'application en local

Les modules JavaScript ne fonctionnent pas en ouvrant `index.html` par double-clic (`file://`). Il faut un petit serveur local, au choix :

- **VS Code** : extension *Live Server*, puis clic droit sur `index.html` → *Open with Live Server*.
- **Python** : dans ce dossier, `python -m http.server 8000`, puis ouvrir <http://localhost:8000>.
- **Node.js** : `npx serve .`

## Tests

Les calculs (montants, dates, agrégats, filtres, validation) sont des fonctions pures testées avec le lanceur intégré à Node.js (version 20 ou plus), sans aucune dépendance :

```bash
npm test
```

## Sauvegarde, import et mode hors ligne

- **Export** : un fichier `mes-finances-sauvegarde-AAAA-MM-JJ.json` contenant toutes les données.
- **Import** : le fichier est entièrement vérifié avant toute écriture (application d'origine, version, types, montants en centimes entiers, dates, références entre éléments, identifiants uniques, cohérence de l'épargne). En cas d'erreur, rien n'est modifié et les erreurs sont listées. Deux modes : **Fusionner** (ajoute ce qui manque, garde la version la plus récente d'un même élément) ou **Remplacer** (avec confirmation).
- **Réinitialisation** : efface tout après saisie du mot « EFFACER ».
- **Hors ligne** : un service worker (`sw.js`) met en cache tous les fichiers de l'application. À chaque nouvelle version publiée, **incrémenter `CACHE_VERSION` dans `sw.js`** ; l'application propose alors « Mettre à jour ». Le test `tests/pwa.test.js` vérifie que la liste des fichiers en cache est complète.

## Raccourcis clavier

| Touche | Action |
|---|---|
| `N` | Ajouter une transaction |
| `/` ou `Ctrl+K` | Rechercher dans toutes les transactions |
| `←` / `→` | Mois précédent / suivant |
| `Échap` | Fermer une fenêtre |

## Structure

```
index.html            coquille de l'application
manifest.webmanifest  description de l'application installable (PWA)
sw.js                 service worker : fonctionnement hors ligne
css/                  tokens (design system), base, mise en page, composants, pages
js/app.js             démarrage, navigation, thème, raccourcis
js/core/              utilitaires purs : montants (centimes), dates, validation, événements
js/data/              IndexedDB, schéma, migrations, accès aux données
js/domain/            logique métier pure : agrégats mensuels, épargne, filtres, tris, totaux
js/ui/                routeur, helpers DOM, icônes, composants (modale, formulaire, toast…)
js/pages/             une vue par section
js/reports/           données des rapports (pures, testées) et mise en page PDF
vendor/               bibliothèques tierces hébergées localement (Chart.js, jsPDF, AutoTable)
assets/               police Inter, icône
tests/                tests unitaires (node --test)
```

## Règles de calcul

- Tous les montants sont stockés en **centimes entiers** : aucune erreur d'arrondi (0,10 € + 0,20 € = 0,30 € exactement).
- Les dates sont stockées en `AAAA-MM-JJ`, sans heure ni fuseau.
- **Taux d'épargne** = (revenus − dépenses) / revenus. Sans revenu, il s'affiche « — ».
- **Solde disponible** = solde de départ du compte courant + revenus − dépenses − versements d'épargne + retraits d'épargne, depuis la date de ce solde.
- **Épargne réalisée** du mois = versements − retraits. Un versement n'est jamais une dépense, un retrait jamais un revenu.
- **Épargne totale** = soldes de départ des comptes d'épargne + versements − retraits + intérêts. Les transferts entre comptes d'épargne sont neutres ; les intérêts ne sont pas des revenus.
- Un compte d'épargne ne peut jamais devenir négatif, et aucun mouvement ne peut précéder sa date de départ : toute opération (ajout, modification, suppression) qui violerait ces règles est refusée.
- **Objectif** : progression = versements et intérêts affectés − retraits affectés ; effort mensuel = reste à épargner / mois restants (mois en cours inclus), arrondi au centime supérieur.
- **Récurrences** : chaque échéance devient une opération réelle dès que sa date est atteinte (au démarrage de l'application, au retour sur l'onglet, puis toutes les heures). Une clé unique par échéance empêche tout doublon ; une occurrence supprimée n'est jamais recréée ; un jour 29–31 est ramené au dernier jour des mois plus courts. Modifier une récurrence ne change que les échéances futures.
- **Tendance** : le mois est comparé à la moyenne des 3 mois précédents ayant des données. Trois signaux (taux d'épargne ±2 points, dépenses ±5 %, patrimoine en hausse ou en baisse) valent +1, 0 ou −1 ; un score ≥ 2 signifie « amélioration », ≤ −2 « dégradation », sinon « stable ». Le détail s'affiche au survol de l'indicateur.
- **Budgets** : toutes les dépenses comptent, exceptionnelles comprises. Un budget propre à un mois remplace le budget par défaut pour ce mois. États : < 80 % normal, ≥ 80 % attention, = 100 % atteint, > 100 % dépassé (montant du dépassement affiché).
- **Estimation de fin de mois** : estimation haute = revenus enregistrés + revenus récurrents à venir − dépenses enregistrées − échéances à venir ; estimation prudente = estimation haute − dépenses variables projetées (rythme des dépenses variables déjà faites × jours restants). Mois passé : résultat réel ; mois futur : récurrences et moyenne des dépenses variables des 3 derniers mois.
- **Taux d'épargne moyen** d'une période = Σ (revenus − dépenses) / Σ revenus (moyenne pondérée par les revenus).
- **Pistes d'amélioration** : règles fixes appliquées aux seules données saisies (catégorie > 25 % au-dessus de sa moyenne des 3 mois précédents et +20 € au moins, budget dépassé 3 mois de suite, dépenses fixes > 50 % des revenus, taux d'épargne à ±5 points de la moyenne, dépenses > revenus, abonnements actifs, dépenses exceptionnelles > 20 % du mois). Aucune piste sans historique suffisant.
- **Simulateur** : chaque mois, intérêts = solde × taux annuel / 12 (arrondis au centime), puis versement. Le taux est saisi par l'utilisateur.
- Les pourcentages de répartition utilisent la méthode du plus fort reste : leur somme fait toujours 100,0 %.

## Confidentialité

Les données sont enregistrées dans le navigateur (IndexedDB), sur cet appareil uniquement. Elles ne sont **pas synchronisées** entre appareils et sont effacées si l'on vide les données du navigateur : exportez-les régulièrement depuis **Paramètres → Sauvegarde et restauration** (un rappel apparaît sur le tableau de bord après 30 jours sans sauvegarde). Le même fichier permet de transférer les données vers un autre appareil (import → « Remplacer »). L'application ne demande ni ne stocke aucun identifiant bancaire.

## Licences tierces

- **Chart.js** 4.4.7 (licence MIT), copié dans `vendor/` — <https://www.chartjs.org>
- **jsPDF** 2.5.2 et **jsPDF-AutoTable** 3.8.4 (licence MIT), copiés dans `vendor/` — <https://github.com/parallax/jsPDF>

- Police **Inter** (SIL Open Font License 1.1) — <https://rsms.me/inter/>
- Icônes inspirées de **Lucide** (ISC) — <https://lucide.dev>
