import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

const PRODUCTS = [
  { id:"magnetic-phone-mount", name:"Magnetic Phone Mount", price:29.99 },
  { id:"wireless-charging-pad", name:"Wireless Charging Pad", price:32.99 },
  { id:"ergonomic-laptop-stand", name:"Ergonomic Laptop Stand", price:44.99 },
  { id:"portable-led-desk-lamp", name:"Portable LED Desk Lamp", price:36.99 },
  { id:"minimal-desk-organizer", name:"Minimal Desk Organizer", price:27.99 },
  { id:"reusable-water-bottle", name:"Reusable Water Bottle", price:24.99 },
  { id:"travel-organizer-set", name:"Travel Organizer Set", price:29.99 },
  { id:"travel-neck-pillow", name:"Travel Neck Pillow", price:26.99 },
  { id:"compact-travel-pouch", name:"Compact Travel Pouch", price:21.99 },
  { id:"portable-mini-fan", name:"Portable Mini Fan", price:31.99 },
  { id:"airtight-storage-set", name:"Airtight Storage Set", price:39.99 },
  { id:"foldable-shopping-bag", name:"Foldable Shopping Bag", price:19.99 }
];

const paypalBase = () =>
  (process.env.PAYPAL_ENVIRONMENT || "live").toLowerCase() === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";

async function paypalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials are not configured on the server.");
  }

  const response = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data.message || "Unable to authenticate with PayPal.");
  }
  return data.access_token;
}

function buildCart(cart) {
  if (!Array.isArray(cart) || !cart.length) throw new Error("Your cart is empty.");

  return cart.map(line => {
    const product = PRODUCTS.find(p => p.id === line.id);
    const quantity = Number(line.quantity);

    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      throw new Error("Invalid cart item.");
    }

    return { ...product, quantity };
  });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "gringa-store" });
});

app.get("/api/paypal/config", (_req, res) => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const environment = (process.env.PAYPAL_ENVIRONMENT || "live").toLowerCase();
  res.json({
    configured: Boolean(clientId),
    clientId: clientId || null,
    environment
  });
});

app.post("/api/paypal/create-order", async (req, res) => {
  try {
    const items = buildCart(req.body?.cart);
    const itemTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const total = itemTotal.toFixed(2);

    const token = await paypalAccessToken();

    const orderPayload = {
      intent: "CAPTURE",
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "GRINGA",
            landing_page: "LOGIN",
            user_action: "PAY_NOW",
            shipping_preference: "GET_FROM_FILE",
            return_url: "https://gringa.onrender.com/",
            cancel_url: "https://gringa.onrender.com/"
          }
        }
      },
      purchase_units: [{
        reference_id: "GRINGA-" + Date.now(),
        description: "GRINGA online store purchase",
        amount: {
          currency_code: "USD",
          value: total,
          breakdown: {
            item_total: {
              currency_code: "USD",
              value: total
            }
          }
        },
        items: items.map(item => ({
          name: item.name,
          quantity: String(item.quantity),
          unit_amount: {
            currency_code: "USD",
            value: item.price.toFixed(2)
          },
          category: "PHYSICAL_GOODS"
        }))
      }]
    };

    const response = await fetch(`${paypalBase()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify(orderPayload)
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("PayPal create order error:", JSON.stringify(data));
      return res.status(502).json({ error: data.message || "PayPal could not create the order." });
    }

    res.json({ id: data.id });
  } catch (error) {
    console.error("Create order error:", error);
    res.status(400).json({ error: error.message || "Unable to create checkout." });
  }
});

app.post("/api/paypal/capture-order", async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || "").trim();
    if (!/^[A-Z0-9-]{10,30}$/i.test(orderId)) {
      return res.status(400).json({ error: "Invalid PayPal order ID." });
    }

    const token = await paypalAccessToken();
    const response = await fetch(`${paypalBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: "{}"
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("PayPal capture error:", JSON.stringify(data));
      return res.status(502).json({ error: data.message || "PayPal could not complete the payment." });
    }

    const completed = data.status === "COMPLETED";
    res.status(completed ? 200 : 202).json({
      ok: completed,
      status: data.status,
      orderId: data.id,
      payer: data.payment_source?.paypal?.email_address || null,
      captureId: data.purchase_units?.[0]?.payments?.captures?.[0]?.id || null
    });
  } catch (error) {
    console.error("Capture order error:", error);
    res.status(400).json({ error: error.message || "Unable to capture payment." });
  }
});

app.get("*splat", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Store running on port " + PORT);
});
