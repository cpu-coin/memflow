# MemFlow on Google Cloud Run with MongoDB

This guide assumes you already have a MongoDB instance (Atlas or self-hosted on Compute Engine) and you want a Cloud Run service to talk to it reliably and securely.

The same connector settings used by internal developers also apply here:

- `MEMFLOW_CONNECTOR=mongodb`
- `MEMFLOW_MONGO_URI=...`
- `MEMFLOW_MONGO_DATABASE=...`

## 1) Prerequisites
- MongoDB reachable from GCP (private IP preferred). If it’s on Compute Engine, give it a private address and open a firewall rule allowing traffic from your Serverless VPC Access connector range.
- Cloud Run service image for MemFlow (e.g., `gcr.io/<project>/memflow:<tag>`).
- Serverless VPC Access connector (e.g., `us-west2/memflow-connector`) sized for your expected concurrency.

## 2) Required env vars
Set these on the Cloud Run service:
- `MEMFLOW_CONNECTOR=mongodb`
- `MEMFLOW_MONGO_URI=mongodb://<user>:<pass>@<host>:27017/<database>?retryWrites=true&directConnection=true`
  - Use `directConnection=true` when talking to a single-node VM over a private IP.
  - Add `authSource=<db>` if credentials aren’t on the target database.
- `MEMFLOW_MONGO_DATABASE=<database>` (matches the DB name in the URI)

Optional performance/network knobs:
- `MEMFLOW_MONGO_MAXPOOLSIZE=50` (default 20)
- `MEMFLOW_MONGO_CONNECT_TIMEOUT_MS=10000`
- `MEMFLOW_MONGO_SOCKET_TIMEOUT_MS=30000`
- `MEMFLOW_MONGO_WAIT_QUEUE_TIMEOUT_MS=5000`

## 3) Cloud Run deployment (example)
```bash
gcloud run deploy memflow-mcp \
  --image=gcr.io/$PROJECT_ID/memflow:<tag> \
  --region=us-west2 \
  --vpc-connector=memflow-connector \
  --vpc-egress=all \
  --set-env-vars MEMFLOW_CONNECTOR=mongodb \
  --set-env-vars MEMFLOW_MONGO_URI="mongodb://USER:PASSWORD@10.0.0.5:27017/memflow_default?retryWrites=true&directConnection=true" \
  --set-env-vars MEMFLOW_MONGO_DATABASE=memflow_default
```

Notes:
- Use `--vpc-egress=all` if MongoDB sits on a private address; restrict to `private-ranges-only` if the DB is reachable via VPC peering.
- If using Atlas with a public SRV URI, you can skip the VPC connector but must allow the Cloud Run egress IP range in Atlas’ allowlist.

## 4) Health + smoke test
After deploy, exec a one-off job or run locally with the same env vars:
```bash
memflow status --json | jq '.connector'
```
Expected: `"ok": true` with database, collection, and `pingMs` values. If you see `EPERM` or `ENETUNREACH`, the VPC connector or firewall isn’t permitting the connection.

## 5) Common fixes
- **EPERM / timeout:** VPC connector missing or firewall not allowing the connector CIDR (typically `10.8.0.0/28` range per connector). Add an ingress rule to MongoDB’s network for that range on TCP 27017.
- **Authentication failed:** Ensure the URI uses the right user/database and includes `authSource` when needed.
- **ReplicaSet errors:** Add `replicaSet=<name>` if you’re talking to a replica set; omit `directConnection=true` in that case.
- **Connection churn under load:** Raise `maxPoolSize`, and keep `minPoolSize` small (or unset) to avoid idle charges; Cloud Run instances are short-lived.

## 6) Operational tips
- Keep a lightweight Cloud Run min-instance (e.g., 1) if you need low latency; otherwise rely on on-demand scale.
- Run `memflow metrics` and `memflow savings` periodically to confirm shared store benefits.
- Back up MongoDB regularly; MemFlow stores checkpoints, cache, patterns, and profiles there.
