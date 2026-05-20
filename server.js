import "dotenv/config";
import express from "express";
import cors from "cors";
import Stripe from "stripe";

const app = express();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2024-06-20",
});

const PRODUCT_CATALOG = {
  casquette: {
    name: "Casquette AkaTsuki Organization",
    priceCents: 1990,
  },

  sweatshirt: {
    name: "Pull AkaTsuki Organization",
    priceCents: 3290,
  },

  tshirt: {
    name: "T-Shirt AkaTsuki Organization",
    priceCents: 2090,
  },

  gourde: {
    name: "Gourde Métal AkaTsuki",
    priceCents: 2990,
  },

  mug: {
    name: "Mug AkaTsuki Organization",
    priceCents: 1490,
  },

  coaster: {
    name: "Sous-verre AkaTsuki",
    priceCents: 1190,
  },

  magnet: {
    name: "Magnet AkaTsuki",
    priceCents: 1390,
  },
};

app.use(cors({ origin: true }));

app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler
);

app.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler
);

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
    console.log("BODY REÇU :", JSON.stringify(req.body, null, 2));

    const { cart } = req.body || {};

    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: "Panier vide." });
    }

    const safeCart = cart.map((item) => {
      const productKey = item.productKey;
      const product = PRODUCT_CATALOG[productKey];
      const syncVariantId = Number(item.syncVariantId);
      const quantity = Math.max(1, Math.min(Number(item.quantity) || 1, 10));

      console.log("CHECK ITEM :", {
        productKey,
        syncVariantId,
        quantity,
        productFound: !!product,
      });

      if (!product) {
        throw new Error(`Produit inconnu : ${productKey}`);
      }

      if (!syncVariantId) {
        throw new Error(`syncVariantId invalide : ${syncVariantId}`);
      }

      return {
        productKey,
        syncVariantId,
        quantity,
        name: product.name,
        priceCents: product.priceCents,
      };
    });

    const line_items = safeCart.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: "eur",
        unit_amount: item.priceCents,
        product_data: {
          name: item.name,
        },
      },
    }));

    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      success_url:
        "https://akalayonagency.github.io/Vente-AkaTsuki-1/success.html",
      cancel_url: "https://aka-tsuki-organization.odoo.com/shop",

      billing_address_collection: "required",

      shipping_address_collection: {
        allowed_countries: ["FR", "BE", "CH", "LU", "DE", "ES", "IT"],
      },

      phone_number_collection: {
        enabled: true,
      },

      client_reference_id: `cart-${Date.now()}`,

      metadata: {
        cart: JSON.stringify(
          safeCart.map((item) => ({
            productKey: item.productKey,
            syncVariantId: item.syncVariantId,
            quantity: item.quantity,
          }))
        ),
      },

      line_items,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Erreur Stripe :", err.message);

    res.status(500).json({
      error: err.message || "Impossible de créer le paiement.",
    });
  }
});

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
      console.log("Commande Printful créée :", session.id);
    } catch (err) {
      console.error("Erreur commande Printful :", err.message);
      return res.status(500).send("Printful order failed");
    }
  }

  res.json({ received: true });
}

async function createPrintfulOrderFromSession(session) {
  const token = process.env.PRINTFUL_TOKEN;

  if (!token) {
    throw new Error("PRINTFUL_TOKEN missing");
  }

  const rawCart = session.metadata?.cart;

  if (!rawCart) {
    throw new Error("Cart metadata missing");
  }

  const cart = JSON.parse(rawCart);

  if (!Array.isArray(cart) || cart.length === 0) {
    throw new Error("Cart invalid");
  }

  const items = cart.map((item) => ({
    sync_variant_id: Number(item.syncVariantId),
    quantity: Number(item.quantity),
  }));

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

    items,

    retail_costs: {
      currency: (session.currency || "eur").toUpperCase(),
      subtotal: ((session.amount_subtotal || 0) / 100).toFixed(2),
      total: ((session.amount_total || 0) / 100).toFixed(2),
    },
  };

  console.log("PRINTFUL ORDER PAYLOAD :", JSON.stringify(orderPayload, null, 2));

  const response = await fetch("https://api.printful.com/orders?confirm=true", {
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

app.get("/printful-all-variants", async (req, res) => {
  try {
    const response = await fetch("https://api.printful.com/store/products", {
      headers: {
        Authorization: `Bearer ${process.env.PRINTFUL_TOKEN}`,
      },
    });

    const data = await response.json();
    const products = data.result || [];

    const finalData = [];

    for (const product of products) {
      const detailsResponse = await fetch(
        `https://api.printful.com/store/products/${product.id}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PRINTFUL_TOKEN}`,
          },
        }
      );

      const details = await detailsResponse.json();
      const variants = details.result?.sync_variants || [];

      variants.forEach((variant) => {
        finalData.push({
          product_name: product.name,
          sync_product_id: product.id,
          sync_variant_id: variant.id,
          variant_id: variant.variant_id,
          color: variant.color,
          size: variant.size,
          retail_price: variant.retail_price,
          sku: variant.sku,
          preview: variant.product?.image,
        });
      });
    }

    res.json(finalData);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});
