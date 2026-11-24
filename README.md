# GAGNE CASH — MVP

Plateforme de missions rémunérées en FCFA : comptes, missions, soumissions de preuves, portefeuille comptable, demandes de retrait TMoney/Flooz/Mobile Money et validation par un administrateur.

## Important : ce projet n'est pas encore un service de paiement en production
- Les demandes de retrait sont enregistrées en attente. L'administrateur doit effectuer le paiement réel dans son compte marchand/opérateur, puis marquer la demande comme payée.
- Aucune API TMoney, Flooz ou autre opérateur n'est branchée : il faut obtenir les contrats, identifiants marchands et documentation officielle auprès des prestataires.
- Les missions et montants de démonstration doivent être remplacés par des missions financées et vérifiables. Ne promettez pas des gains non financés.
- Avant ouverture au public : politique de confidentialité, conditions d'utilisation, règles anti-fraude, vérification d'identité si nécessaire, obligations fiscales et légales au Togo, sauvegardes, supervision et audit de sécurité.

## Lancer en local
Prérequis : Node.js 20 ou plus récent.

```bash
npm install
```

Définissez des secrets forts (ne les publiez jamais) :
```bash
export SESSION_SECRET='une-cle-aleatoire-de-plus-de-32-caracteres'
export ADMIN_EMAIL='admin@votre-domaine.tg'
export ADMIN_PASSWORD='un-mot-de-passe-admin-long-et-unique'
export NODE_ENV='production'
npm start
```
Ouvrez `http://localhost:3000`.

Sur un hébergeur, utilisez HTTPS, un stockage persistant pour `gagne-cash.sqlite`, des variables d'environnement secrètes et une solution de session persistante adaptée (le stockage mémoire de session par défaut est uniquement adapté au test).

## Connexion administrateur
Le compte administrateur est défini par les variables `ADMIN_EMAIL` et `ADMIN_PASSWORD`. Connectez-vous depuis le formulaire avec ces identifiants. L'adresse administrateur ne peut pas être utilisée pour une inscription publique. Protégez ces secrets et changez-les immédiatement s'ils sont exposés.

## Paiements
Les méthodes TMoney, Flooz et Mobile Money sont enregistrées comme choix de retrait. La transaction réelle n'est pas déclenchée automatiquement dans cette version. Pour l'automatiser, intégrez uniquement l'API officielle du fournisseur contracté, avec webhooks signés, idempotence, rapprochement et journal d'audit. Ne stockez jamais de PIN ni de code secret Mobile Money.

## Parrainage
Chaque membre connecté dispose d'un lien `/?ref=CODE`. Une inscription effectuée avec ce lien crée un parrainage en attente. L'administrateur doit vérifier que l'inscription est réelle et unique, puis valider le parrainage : 1 000 FCFA sont alors ajoutés au portefeuille du parrain. Les clics seuls ne donnent pas droit à une rémunération dans cette version, car un clic peut être automatisé ou frauduleux et il faut un annonceur/partenaire qui finance la rémunération. Aucun paiement automatique n'est connecté.
