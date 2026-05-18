require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const { auth, requiresAuth } = require("express-openid-connect");
const { MongoClient } = require("mongodb");

const PORT = Number(process.env.PORT || 8000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const OIDC_SCOPE = process.env.OIDC_SCOPE || "openid profile email";
const OIDC_REDIRECT_URI = process.env.OIDC_REDIRECT_URI || `${BASE_URL}/callback`;
const OIDC_CORS_ORIGIN = process.env.OIDC_CORS_ORIGIN || "";
const USE_SECURE_COOKIES = BASE_URL.startsWith("https://");

const requiredEnv = [
  "SESSION_SECRET",
  "OIDC_ISSUER_BASE_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "MONGODB_URI",
];

const missing = requiredEnv.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const dbName = process.env.MONGODB_DB || "zen_sandbox";
const collectionName = process.env.MONGODB_COLLECTION || "sandbox_states";

let mongoClientPromise;
function getMongoClient() {
  if (!mongoClientPromise) {
    mongoClientPromise = new MongoClient(process.env.MONGODB_URI)
      .connect()
      .catch((error) => {
        // Reset cached promise so the next request can retry a fresh connection.
        mongoClientPromise = undefined;
        throw error;
      });
  }
  return mongoClientPromise;
}

async function getStatesCollection() {
  const client = await getMongoClient();
  return client.db(dbName).collection(collectionName);
}

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(express.json({ limit: "2mb" }));

// Dev workaround: some IdPs invoke redirect_uri via fetch, which requires CORS.
app.use((req, res, next) => {
  if (OIDC_CORS_ORIGIN && req.path === "/callback") {
    res.setHeader("Access-Control-Allow-Origin", OIDC_CORS_ORIGIN);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
  }
  next();
});

app.use(
  auth({
    authRequired: false,
    idpLogout: true,
    auth0Logout: false,
    issuerBaseURL: process.env.OIDC_ISSUER_BASE_URL,
    baseURL: BASE_URL,
    clientID: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
    secret: process.env.SESSION_SECRET,
    session: {
      cookie: {
        path: "/",
        sameSite: USE_SECURE_COOKIES ? "None" : "Lax",
        secure: USE_SECURE_COOKIES,
      },
    },
    transactionCookie: {
      name: "zen_sandbox_auth_verification",
      sameSite: USE_SECURE_COOKIES ? "None" : "Lax",
    },
    authorizationParams: {
      response_type: "code",
      scope: OIDC_SCOPE,
      redirect_uri: OIDC_REDIRECT_URI,
      audience: process.env.OIDC_AUDIENCE || undefined,
    },
    clientAuthMethod: "client_secret_post",
    routes: {
      login: "/login",
      logout: "/logout",
      callback: "/callback",
    },
  })
);

app.get("/api/me", (req, res) => {
  if (!req.oidc.isAuthenticated()) {
    return res.status(401).json({ authenticated: false });
  }

  const claims = req.oidc.user || {};
  res.json({
    authenticated: true,
    user: {
      sub: claims.sub,
      name: claims.name || claims.preferred_username || claims.email || "User",
      email: claims.email || null,
    },
  });
});

function validateStatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "State payload must be an object.";
  }

  if (typeof payload.simWidth !== "number" || typeof payload.simHeight !== "number") {
    return "State payload is missing simWidth/simHeight.";
  }

  const encodedKeys = [
    "cells",
    "life",
    "fireState",
    "waterSideAttempts",
    "waterSleepVersion",
  ];

  for (const key of encodedKeys) {
    if (typeof payload[key] !== "string" || payload[key].length === 0) {
      return `State payload is missing ${key}.`;
    }
  }

  if (payload.activeBalls != null && !Array.isArray(payload.activeBalls)) {
    return "activeBalls must be an array if provided.";
  }

  return null;
}

app.get("/api/state", requiresAuth(), async (req, res) => {
  try {
    const collection = await getStatesCollection();
    const userSub = req.oidc.user.sub;

    const doc = await collection.findOne(
      { userSub },
      { projection: { _id: 0, userSub: 0, updatedAt: 0 } }
    );

    if (!doc) {
      return res.status(404).json({ message: "No saved state found yet." });
    }

    return res.json(doc);
  } catch (error) {
    console.error("Failed to load state:", error);
    return res.status(500).json({ message: "Failed to load state." });
  }
});

app.put("/api/state", requiresAuth(), async (req, res) => {
  try {
    const validationError = validateStatePayload(req.body);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const collection = await getStatesCollection();
    const userSub = req.oidc.user.sub;

    const now = new Date();
    await collection.updateOne(
      { userSub },
      {
        $set: {
          userSub,
          version: Number(req.body.version || 1),
          simWidth: Number(req.body.simWidth),
          simHeight: Number(req.body.simHeight),
          cells: req.body.cells,
          life: req.body.life,
          fireState: req.body.fireState,
          waterSideAttempts: req.body.waterSideAttempts,
          waterSleepVersion: req.body.waterSleepVersion,
          activeBalls: Array.isArray(req.body.activeBalls) ? req.body.activeBalls : [],
          updatedAt: now,
        },
      },
      { upsert: true }
    );

    return res.json({ ok: true, savedAt: now.toISOString() });
  } catch (error) {
    console.error("Failed to save state:", error);
    return res.status(500).json({ message: "Failed to save state." });
  }
});

const frontendDir = path.join(__dirname, "..", "frontend");

app.use(express.static(frontendDir));

app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

async function ensureIndexes() {
  const collection = await getStatesCollection();
  await collection.createIndex({ userSub: 1 }, { unique: true });
}

const mongoRetryMs = Number(process.env.MONGODB_RETRY_MS || 30000);

async function initializeMongoIndexesWithRetry() {
  try {
    await ensureIndexes();
    console.log("MongoDB connected and indexes are ready.");
  } catch (error) {
    console.error("MongoDB initialization failed; retrying:", error);
    setTimeout(initializeMongoIndexesWithRetry, mongoRetryMs);
  }
}

app.listen(PORT, () => {
  console.log(`Zen Sandbox server running at ${BASE_URL}`);
  initializeMongoIndexesWithRetry();
});
