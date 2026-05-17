# AKA Printful Shop

Boutique simple : page de vente + backend Stripe Checkout + webhook Stripe qui crée la commande Printful.

## Important sécurité
Tu as partagé une clé Printful dans le chat. Révoque-la dans Printful et génère-en une nouvelle. Ne mets jamais les clés secrètes dans Odoo, GitHub ou le HTML.

## Installation locale
```bash
npm install
cp .env.example .env
npm run dev
```

Ouvre http://localhost:4242

## Variables à remplir
- `STRIPE_SECRET_KEY` : clé secrète Stripe `sk_live_...`
- `STRIPE_WEBHOOK_SECRET` : secret webhook Stripe `whsec_...`
- `PRINTFUL_TOKEN` : nouveau token Printful privé
- `PRINTFUL_SYNC_VARIANT_ID` : ID numérique du variant Printful de la gourde
- `PUBLIC_BASE_URL` : URL publique du backend
- `SUCCESS_URL` / `CANCEL_URL` : pages Odoo ou backend

## Déploiement
Héberge le backend sur Render, Railway, Fly.io, Vercel ou autre plateforme Node.
Ensuite, dans Odoo, ajoute un bloc HTML/iframe vers la page `/` du backend ou copie le HTML en modifiant `BACKEND_URL`.

## Stripe webhook
Dans Stripe Dashboard, crée un endpoint webhook vers :
`https://ton-backend.com/webhook/stripe`
Événement à écouter : `checkout.session.completed`.
