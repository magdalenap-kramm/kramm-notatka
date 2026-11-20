#!/bin/bash
# Jednorazowo: automatyczne wgrywanie z GitHuba bez kluczy (Workload Identity Federation)
set -e
P=calm-metric-514918-h8; N=696449098485; REPO=magdalenap-kramm/kramm-notatka
SA=github-wdrozenia@$P.iam.gserviceaccount.com
gcloud config set project $P -q
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com -q
gcloud iam service-accounts describe $SA >/dev/null 2>&1 || gcloud iam service-accounts create github-wdrozenia --display-name="GitHub - wgrywanie Asystentki"
for R in firebase.admin cloudfunctions.admin run.admin iam.serviceAccountUser cloudbuild.builds.editor artifactregistry.admin secretmanager.admin cloudscheduler.admin serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding $P --member=serviceAccount:$SA --role=roles/$R --condition=None -q >/dev/null && echo "rola $R"
done
gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 || gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"
gcloud iam workload-identity-pools providers describe github --location=global --workload-identity-pool=github >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='$REPO'"
gcloud iam service-accounts add-iam-policy-binding $SA --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$N/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" -q >/dev/null
echo "GOTOWE - automatyczne wgrywanie ustawione"
