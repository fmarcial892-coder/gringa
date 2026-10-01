# Northstar Goods

A standalone international storefront for physical goods. It is built as a Vite + React single-page app and deploys to Netlify with server-side Netlify Functions for payment and administration boundaries.

## Run locally

```bash
npm install
npm run dev
npm run build
```

## Netlify deployment

1. Push this independent directory to a new GitHub repository.
2. In Netlify, import that repository. The included `netlify.toml` sets `npm run build`, publishes `dist`, and deploys `netlify/functions`.
3. In **Site configuration → Environment variables**, add values from `.env.example`. Do not commit `.env`.
4. Configure a payment-provider adapter in `netlify/functions/create-payment.mjs` and matching signature verification in `payment-webhook.mjs` before accepting payments. The storefront currently does not expose a simulated payment method, and intentionally refuses payment calls until configured.
5. Set a strong `ADMIN_API_TOKEN`; use it as a Bearer token only from a protected server-side admin application. The `admin-orders` function is not linked into the public frontend.
6. Connect a persistent order store (for example, a database) before live use. On a verified gateway webhook, create/update the order with the immutable order number, items, shipping address, currency, subtotal, shipping, total, payment status and order status.

## Payment/security model

`PAYMENT_SECRET_KEY` and `PAYMENT_WEBHOOK_SECRET` are read only in Netlify Functions. The browser must submit checkout intent data to `/.netlify/functions/create-payment`; it must never receive a secret key or mark an order paid. A webhook must verify the provider signature and confirm payment server-side before an order becomes `paid`.

Order states supported by the integration contract: `pending`, `paid`, `processing`, `shipped`, `delivered`, `cancelled`, `refunded`.

## Internationalization

USD is the active currency. Product price formatting is centralized in `src/catalog.js`; add EUR, GBP and BRL conversion/pricing rules server-side before enabling currency selection. Shipping is separately represented in checkout and intentionally requires a shipping-provider integration to quote international delivery.

## Content notes

The catalog names real products and does not invent technical details or claimed prices. Images are optimized remote product-category photographs from Unsplash; production operations should replace them with licensed, SKU-specific product assets supplied by the authorized retailer or manufacturer.
