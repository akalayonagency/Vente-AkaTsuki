import "dotenv/config";
import express from "express";
import cors from "cors";
import Stripe from "stripe";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2024-06-20",
});

app.use(cors({ origin: true }));

// Webhook Stripe : accepte /webhook ET /webhook/stripe
async function stripeWebhookHandler(req, res) {
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    try {
      await createPrintfulOrderFromSession(session);
      console.log("Commande Printful créée pour :", session.id);
    } catch (err) {
      console.error("Erreur commande Printful :", err.message);
      return res.status(500).send("Printful order failed");
    }
  }

  res.json({ received: true });
}

app.post("/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);
app.post("/webhook/stripe", express.raw({ type: "application/json" }), stripeWebhookHandler);

app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.send("Boutique Akatsuki backend ON");
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/create-checkout-session", async (req, res) => {
  try {
    const { quantity = 1 } = req.body || {};
    const safeQuantity = Math.max(1, Math.min(Number(quantity) || 1, 10));

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url:
        process.env.SUCCESS_URL ||
        `${process.env.PUBLIC_BASE_URL}/success.html`,
      cancel_url:
        process.env.CANCEL_URL ||
        `${process.env.PUBLIC_BASE_URL}/`,
      billing_address_collection: "required",
      shipping_address_collection: {
        allowed_countries: ["FR", "BE", "CH", "LU", "DE", "ES", "IT"],
      },
      phone_number_collection: { enabled: true },
      client_reference_id: `aka-gourde-${Date.now()}`,
      metadata: {
        product: "gourde-akatsuki-organization",
        printful_sync_variant_id:
          process.env.PRINTFUL_SYNC_VARIANT_ID || "",
      },
      line_items: [
        {
          quantity: safeQuantity,
          price_data: {
            currency: process.env.PRODUCT_CURRENCY || "eur",
            unit_amount: Number(process.env.PRODUCT_PRICE_CENTS || 2490),
            product_data: {
              name: "Gourde Akatsuki Organization",
              description: "Gourde officielle AKA / TSUKI",
              images: [`${process.env.PUBLIC_BASE_URL}/logo.png`],
            },
          },
        },
      ],
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Erreur Stripe :", err.message);
    res.status(500).json({ error: "Impossible de créer le paiement." });
  }
});

async function createPrintfulOrderFromSession(session) {
  const token = process.env.PRINTFUL_TOKEN;
  const syncVariantId = Number(process.env.PRINTFUL_SYNC_VARIANT_ID);

  if (!token) throw new Error("PRINTFUL_TOKEN missing");
  if (!syncVariantId) {
    throw new Error("PRINTFUL_SYNC_VARIANT_ID missing or not numeric");
  }

  const customer = session.customer_details || {};
  const shipping = session.shipping_details?.address || customer.address || {};
  const name = session.shipping_details?.name || customer.name || "Client";

  const orderPayload = {
    recipient: {
      name,
      address1: shipping.line1,
      address2: shipping.line2 || "",
      city: shipping.city,
      state_code: shipping.state || "",
      country_code: shipping.country,
      zip: shipping.postal_code,
      email: customer.email,
      phone: customer.phone || "",
    },
    items: [
      {
        sync_variant_id: syncVariantId,
        quantity: 1,
      },
    ],
    retail_costs: {
      currency: (session.currency || "eur").toUpperCase(),
      subtotal: ((session.amount_subtotal || 0) / 100).toFixed(2),
      total: ((session.amount_total || 0) / 100).toFixed(2),
    },
  };

  const response = await fetch("https://api.printful.com/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(orderPayload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `Printful API error ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

// Debug produit Printful
app.get("/printful-debug", async (req, res) => {
  try {
    const response = await fetch("https://api.printful.com/store/products", {
      headers: {
        Authorization: `Bearer ${process.env.PRINTFUL_TOKEN}`,
      },
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Debug variant Printful
app.get("/printful-variant-direct", async (req, res) => {
  try {
    const response = await fetch(
      "https://api.printful.com/store/products/433515007",
      {
        headers: {
          Authorization: `Bearer ${process.env.PRINTFUL_TOKEN}`,
        },
      }
    );

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});
const API_URL = "https://vente-akatsuki.onrender.com";
