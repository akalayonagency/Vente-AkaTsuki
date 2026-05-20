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
    variants: [
      5314638516, // White
      5318044313, // Dark Navy
    ],
  },

  sweatshirt: {
    name: "Pull AkaTsuki Organization",
    priceCents: 3290,
    variants: [
      5314630805, // Black S
      5314630806, // Black M
      5314630807, // Black L
      5314630808, // Black XL
      5314630809, // Black 2XL
      5314630810, // Black 3XL
      5314630811, // Black 4XL
      5314630812, // Black 5XL

      5318047646, // White S
      5318047647, // White M
      5318047648, // White L
      5318047649, // White XL
      5318047650, // White 2XL
      5318047651, // White 3XL
      5318047652, // White 4XL
      5318047653, // White 5XL
    ],
  },

  coaster: {
    name: "Sous-verre AkaTsuki",
    priceCents: 1190,
    variants: [
      5314630704,
    ],
  },

  mug: {
    name: "Mug AkaTsuki Organization",
    priceCents: 1490,
    variants: [
      5314630690,
    ],
  },

  magnet: {
    name: "Magnet AkaTsuki",
    priceCents: 1390,
    variants: [
      5314630686,
    ],
  },

  tshirt: {
    name: "T-Shirt AkaTsuki Organization",
    priceCents: 2090,
    variants: [
      5313991277, // White S
      5313991278, // White M
      5313991279, // White L
      5313991280, // White XL
      5313991281, // White 2XL
      5313991282, // White 3XL

      5318049010, // Black S
      5318049011, // Black M
      5318049012, // Black L
      5318049013, // Black XL
      5318049014, // Black 2XL
      5318049015, // Black 3XL
    ],
  },

  gourde: {
    name: "Gourde Métal 330ml AkaTsuki Organization",
    priceCents: 2990,
    variants: [
      5313644654, // Black
      5318050131, // White
    ],
  },
};

app.use(cors({ origin: true }));

// IMPORTANT : webhook Stripe avant express.json()
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

app.post("/create-checkout-session", async (req, res) => {
  try {
    const { quantity = 1, productKey, syncVariantId } = req.body || {};

    const product = PRODUCT_CATALOG[productKey];
    const safeQuantity = Math.max(1, Math.min(Number(quantity) || 1, 10));
    const variantId = Number(syncVariantId);

    if (!product) {
      return res.status(400).json({ error: "Produit inconnu." });
    }

    if (!product.variants.includes(variantId)) {
      return res.status(400).json({ error: "Variant Printful invalide." });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",

    success_url: "https://akalayonagency.github.io/Vente-AkaTsuki-1/success.html",
cancel_url: "https://aka-tsuki-organization.odoo.com/shop",

      billing_address_collection: "required",

      shipping_address_collection: {
        allowed_countries: ["FR", "BE", "CH", "LU", "DE", "ES", "IT"],
      },

      phone_number_collection: {
        enabled: true,
      },

      client_reference_id: `${productKey}-${Date.now()}`,

      metadata: {
        productKey,
        printful_sync_variant_id: String(variantId),
        quantity: String(safeQuantity),
      },

      line_items: [
        {
          quantity: safeQuantity,
          price_data: {
            currency: "eur",
            unit_amount: product.priceCents,
            product_data: {
              name: product.name,
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

  const syncVariantId = Number(session.metadata?.printful_sync_variant_id);
  const quantity = Number(session.metadata?.quantity || 1);

  if (!token) {
    throw new Error("PRINTFUL_TOKEN missing");
  }

  if (!syncVariantId) {
    throw new Error("syncVariantId missing");
  }

  if (!quantity) {
    throw new Error("quantity missing");
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
        quantity,
      },
    ],

    retail_costs: {
      currency: (session.currency || "eur").toUpperCase(),
      subtotal: ((session.amount_subtotal || 0) / 100).toFixed(2),
      total: ((session.amount_total || 0) / 100).toFixed(2),
    },
  };

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

// Debug : liste des produits Printful
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

// Debug : détail du T-shirt
app.get("/printful-debug-tshirt", async (req, res) => {
  try {
    const response = await fetch(
      "https://api.printful.com/store/products/433576852",
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

// Debug : détail de la gourde
app.get("/printful-debug-gourde", async (req, res) => {
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
app.get("/printful-all-variants", async (req, res) => {
  try {

    const response = await fetch(
      "https://api.printful.com/store/products",
      {
        headers: {
          Authorization: `Bearer ${process.env.PRINTFUL_TOKEN}`,
        },
      }
    );

    const data = await response.json();

    const products = data.result;

    let finalData = [];

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

      const variants = details.result.sync_variants;

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
          preview: variant.product.image,
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
