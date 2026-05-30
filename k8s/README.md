# Kubernetes Deployment Example

This directory contains an environment-neutral Kubernetes example for `terraform-platform`.
Replace the image, domain, TLS secret, storage class, and admin key before applying it to a real cluster.

## Resources

- `namespace.yaml`: creates the `terraform-platform` namespace.
- `configmap.yaml`: runtime environment values such as `PORT`, `CONFIG_DIR`, `DATA_DIR`, and `TERRAFORM_BIN`.
- `secret.example.yaml`: example `ADMIN_API_KEY` Secret. It is not included in `kustomization.yaml`; create the real Secret separately.
- `persistentvolumeclaims.yaml`: persistent volumes for platform config and Terraform runtime data.
- `deployment.yaml`: single-replica Bun/Elysia app using the Docker image from this repository.
- `service.yaml`: internal `ClusterIP` service.
- `ingress.example.yaml`: public callback ingress example with path exposure notes in comments.

## Deploy

Build and publish an image first:

```bash
docker build -f dockerfile -t ghcr.io/your-org/terraform-platform:0.1.0 .
docker push ghcr.io/your-org/terraform-platform:0.1.0
```

Update `k8s/deployment.yaml` with your image tag:

```yaml
image: ghcr.io/your-org/terraform-platform:0.1.0
```

Create a real admin key Secret instead of using the placeholder value:

```bash
kubectl create namespace terraform-platform --dry-run=client -o yaml | kubectl apply -f -
kubectl -n terraform-platform create secret generic terraform-platform-secret \
  --from-literal=ADMIN_API_KEY='replace-with-a-long-random-value' \
  --dry-run=client -o yaml | kubectl apply -f -
```

If init-shell callbacks are needed, set `PUBLIC_CALLBACK_BASE_URL` in `k8s/configmap.yaml` to the public HTTPS origin reachable by deployed VMs:

```yaml
PUBLIC_CALLBACK_BASE_URL: "https://terraform-platform.example.com"
```

Apply the manifests:

```bash
kubectl apply -k k8s
kubectl -n terraform-platform rollout status deployment/terraform-platform
```

For first-time validation without changing the cluster:

```bash
kubectl kustomize k8s
kubectl apply --dry-run=client --validate=false -k k8s
```

Use server-side dry-run when a cluster is available:

```bash
kubectl apply --dry-run=server -k k8s
```

## Network Exposure

Security-first default: keep the admin service private. Expose only the callback path to the public internet when init-shell logs are enabled.

Public path:

- `/callbacks/init-shell/*`: signed one-time callback endpoint for VM init-shell logs. This must be reachable from deployed VMs when `PUBLIC_CALLBACK_BASE_URL` is configured.

Internal-only paths by default:

- `/`: admin UI entry point; unauthenticated users are redirected to `/login`.
- `/login`: login form and login submit endpoint.
- `/assets/*`: built SPA assets.
- `/ui/*`: admin UI API, protected by the signed session cookie.
- `/api/*`: automation/API routes, protected by `Authorization: Bearer <ADMIN_API_KEY>`.

Expose admin UI/API paths only after an explicit risk review, ideally through VPN, private load balancer, bastion access, zero-trust access proxy, or another internal-only control plane.

## Non-Public Paths

These are filesystem paths inside the container/PVCs, not HTTP routes, and must not be exposed by Ingress or static file serving:

- `/app/config`: mounted from the `terraform-platform-config` PVC. It stores provider metadata, provider key metadata and secret values, templates, shells, and published API metadata.
- `/app/data`: mounted from the `terraform-platform-data` PVC. It stores Terraform workdirs, `terraform.tfstate`, run metadata, and redacted logs.
- `/config` and `/data`: documented storage model paths from local/runtime usage; in Kubernetes they map to `/app/config` and `/app/data` via environment variables.

`/health` exists in the app but currently passes through the same authorization middleware as other protected routes. The deployment therefore uses TCP probes against port `3000` instead of an HTTP health probe.

## Production Notes

- Keep `Service` as `ClusterIP`; publish only through an Ingress or a private gateway you control.
- Use TLS for any public Ingress because admin sessions and bearer-token API calls traverse it.
- Adjust PVC sizes and add `storageClassName` if your cluster does not provide a suitable default StorageClass.
- Use an encrypted StorageClass and restrict storage backup access because `/app/config` and `/app/data` contain provider keys, Terraform state, and run data.
- Keep `replicas: 1` unless the storage and Terraform execution model is redesigned for concurrent writers.
- Store the real `ADMIN_API_KEY` in your secret manager or deployment pipeline, not in Git.
