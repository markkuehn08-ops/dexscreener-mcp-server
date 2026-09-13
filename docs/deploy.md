# Deploying to Cloud Run

This server speaks MCP over stdio by default (`build/index.js`), which is how
Claude Desktop, Gemini CLI, and other local MCP clients launch it. To run it as
a remote service on Cloud Run, a second entrypoint (`build/http.js`) exposes
the same tools over both modern and legacy MCP HTTP transports:

- `POST /mcp`, `GET /mcp`, `DELETE /mcp` — Streamable HTTP
- `GET /sse` — legacy SSE stream setup
- `POST /messages?sessionId=...` — legacy SSE client -> server JSON-RPC messages
- `GET /healthz` — plain health check

The `Dockerfile` builds the TypeScript project and runs `node build/http.js`,
listening on `$PORT` (Cloud Run sets this to `8080`).

Hosted MCP clients such as ChatGPT/OpenAI integrations and remote Gemini
setups should use the `/mcp` endpoint. Older SSE-based MCP clients can keep
using `/sse` and `/messages`.

By default the deployed service requires authenticated invocations (Cloud
Run's default). If you want it publicly reachable, add
`--allow-unauthenticated` via the `flags` input on the `deploy-cloudrun` step,
or run `gcloud run services add-iam-policy-binding` afterwards.

## 1. One-time GCP setup (run locally or in Cloud Shell)

```bash
export PROJECT_ID="<YOUR_GCP_PROJECT_ID>"
export REPO="opensvm/dexscreener-mcp-server"
export POOL_NAME="github-pool"
export PROVIDER_NAME="github-provider"
export SA_NAME="github-actions-deployer"
export REGION="us-central1"
export AR_REPOSITORY="dexscreener-mcp-images"

# Enable required APIs
gcloud services enable \
  iamcredentials.googleapis.com \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  --project="${PROJECT_ID}"

# Create a dedicated CI/CD service account
gcloud iam service-accounts create "${SA_NAME}" \
  --project="${PROJECT_ID}" \
  --display-name="GitHub Actions Deployer"

# Grant deployment roles to the service account
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.developer"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

# Create the Artifact Registry repository the workflow pushes images to
gcloud artifacts repositories create "${AR_REPOSITORY}" \
  --project="${PROJECT_ID}" \
  --repository-format=docker \
  --location="${REGION}"

# Optional: if Cloud Run should run as a non-default service account,
# create it and let the deployer impersonate it, then pass
# `service_account: <that-sa-email>` to the deploy-cloudrun step.
# gcloud iam service-accounts create dexscreener-cloudrun-sa \
#   --project="${PROJECT_ID}" \
#   --display-name="DexScreener MCP Cloud Run runtime SA"
#
# gcloud iam service-accounts add-iam-policy-binding \
#   "dexscreener-cloudrun-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
#   --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
#   --role="roles/iam.serviceAccountUser" \
#   --project="${PROJECT_ID}"

# Create Workload Identity Pool
gcloud iam workload-identity-pools create "${POOL_NAME}" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --display-name="GitHub Actions Pool"

export POOL_ID=$(gcloud iam workload-identity-pools describe "${POOL_NAME}" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --format="value(name)")

# Create OIDC Workload Identity Provider
gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_NAME}" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="${POOL_NAME}" \
  --display-name="GitHub Actions Provider" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository_owner == 'opensvm'"

# Bind the GitHub repository to the service account
gcloud iam service-accounts add-iam-policy-binding \
  "${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/${REPO}"
```

## 2. GitHub repository configuration

Settings -> Secrets and variables -> Actions:

- Repository variable `GCP_PROJECT_ID`: your GCP project id
- Repository variable or secret `GCP_WIF_PROVIDER`: `${POOL_ID}/providers/${PROVIDER_NAME}`
  (format: `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github-pool/providers/github-provider`)
- Repository variable or secret `GCP_WIF_SERVICE_ACCOUNT`: `${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com`

## 3. Workflow

`.github/workflows/deploy.yml` builds the image, pushes it to Artifact
Registry, and deploys it to Cloud Run on every push to `main` (or manually via
`workflow_dispatch`). If any required GitHub Actions configuration is missing,
the workflow logs a warning and skips deployment instead of failing during the
Google Cloud authentication step.
